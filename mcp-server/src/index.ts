import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHash } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, resolveProfileStorage } from "./config.js";
import { EnvFile } from "./env-file.js";
import { createServer } from "./server.js";
import { TokenRateLimiter } from "./rate-limiter.js";
import { instrumentFetch } from "./observability.js";
import { VkAdsClient } from "./vk-client.js";
import { VkAdsTokenManager } from "./vk-ads-token.js";
import { VkCommunityClient } from "./vk-community-client.js";

/** Профиль выбирается только при запуске; MCP не может подменить credential. */
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const startupProfile = process.env.VK_ADS_PROFILE?.trim() || "default";
const profileStorage = resolveProfileStorage(packageDirectory, startupProfile);
process.env.VK_ADS_PROFILE = startupProfile;
loadDotenv({ path: profileStorage.envFile, override: false, quiet: true });

const config = loadConfig();
const envFile = new EnvFile(profileStorage.envFile);
const tokenManager = config.clientCredentials
  ? new VkAdsTokenManager({
      credentials: config.clientCredentials,
      envFile,
      getAccessToken: config.tokenProvider,
      getRefreshToken: () => process.env.VK_ADS_REFRESH_TOKEN?.trim() || undefined,
      getTokenExpiresAt: () => process.env.VK_ADS_TOKEN_EXPIRES_AT?.trim() || undefined,
      setAccessToken: config.setAccessToken,
      timeoutMs: config.timeoutMs,
    })
  : undefined;
// Имя coordination-файла получает только необратимый SHA-256, не токен или credential.
const credentialFingerprint = createHash("sha256")
  .update(`${config.clientCredentials?.clientId ?? ""}\n${config.tokenProvider()}`)
  .digest("hex");
// Лимит действует на все запросы одного credential, включая параллельные MCP-процессы.
const rateLimiter = new TokenRateLimiter({ credentialFingerprint });
const coreVkCredentialFingerprint = createHash("sha256")
  .update(process.env.VK_API_TOKEN?.trim() ?? "")
  .digest("hex");
const coreVkRateLimiter = new TokenRateLimiter({ credentialFingerprint: coreVkCredentialFingerprint });
const client = new VkAdsClient({
  tokenProvider: config.tokenProvider,
  ...(tokenManager ? { tokenRefresher: () => tokenManager.refresh() } : {}),
  timeoutMs: config.timeoutMs,
  fetchImplementation: instrumentFetch(fetch, process.env.VK_ADS_LOG === "1"),
  waitForRequest: () => coreVkRateLimiter.wait(),
});
// Core VK API использует только отдельный VK_API_TOKEN, никогда credential VK Ads.
const communityClient = new VkCommunityClient({
  tokenProvider: () => process.env.VK_API_TOKEN?.trim() ?? "",
  timeoutMs: config.timeoutMs,
  fetchImplementation: instrumentFetch(fetch, process.env.VK_ADS_LOG === "1"),
  waitForRequest: () => rateLimiter.wait(),
  ...(process.env.VK_API_AD_ACCOUNT_ID?.trim() ? { adsAccountId: Number(process.env.VK_API_AD_ACCOUNT_ID) } : {}),
});
// Не принимаем MCP-запросы с почти истёкшим токеном; ошибки OAuth останавливают старт.
await tokenManager?.renewOnStartup();
const server = createServer(client, config.mode, {
  communityClient,
  connectionId: config.connectionId,
  profileName: config.profileName,
  previewTtlMs: config.previewTtlMs,
  requireWriteConfirmation: config.requireWriteConfirmation,
  ...(config.uploadDir ? { uploadDir: config.uploadDir } : {}),
  ...(config.piiUploadDir ? { piiUploadDir: config.piiUploadDir } : {}),
  allowPiiUploads: config.allowPiiUploads,
  allowAgencyWrites: config.allowAgencyWrites,
  allowProfileWrites: config.allowProfileWrites,
  allowSharingKeyRevoke: config.allowSharingKeyRevoke,
  ...(config.externalSharingKey ? { externalSharingKey: config.externalSharingKey } : {}),
  allowSkAdNetworkWrites: config.allowSkAdNetworkWrites,
  skAdNetworkTestAppIds: config.skAdNetworkTestAppIds,
  allowInAppEventCategoryWrites: config.allowInAppEventCategoryWrites,
  inAppEventTestAppIds: config.inAppEventTestAppIds,
  allowRemarketingCounterWrites: config.allowRemarketingCounterWrites,
  remarketingCounterTestIds: config.remarketingCounterTestIds,
  ...(tokenManager ? { tokenRecovery: { recover: () => tokenManager.recoverTokenLimit() } } : {}),
  auditFile: process.env.VK_ADS_AUDIT_FILE ? config.auditFile : profileStorage.auditFile,
});

await server.connect(new StdioServerTransport());
