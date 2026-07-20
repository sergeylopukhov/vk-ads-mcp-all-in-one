import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createHash } from "node:crypto";
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";
import { EnvFile } from "./env-file.js";
import { createServer } from "./server.js";
import { TokenRateLimiter } from "./rate-limiter.js";
import { instrumentFetch } from "./observability.js";
import { VkAdsClient } from "./vk-client.js";
import { VkAdsTokenManager } from "./vk-ads-token.js";

/** .env лежит рядом с package.json, независимо от текущей папки MCP-клиента. */
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadDotenv({ path: resolve(packageDirectory, ".env"), override: false, quiet: true });

const config = loadConfig();
const envFile = new EnvFile(resolve(packageDirectory, ".env"));
const tokenManager = config.clientCredentials
  ? new VkAdsTokenManager({
      credentials: config.clientCredentials,
      envFile,
      getAccessToken: config.tokenProvider,
      getRefreshToken: () => process.env.VK_ADS_REFRESH_TOKEN?.trim() || undefined,
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
const client = new VkAdsClient({
  tokenProvider: config.tokenProvider,
  ...(tokenManager ? { tokenRefresher: () => tokenManager.refresh() } : {}),
  timeoutMs: config.timeoutMs,
  fetchImplementation: instrumentFetch(fetch, process.env.VK_ADS_LOG === "1"),
  waitForRequest: () => rateLimiter.wait(),
});
const server = createServer(client, config.mode, {
  connectionId: config.connectionId,
  profileName: config.profileName,
  ...(config.uploadDir ? { uploadDir: config.uploadDir } : {}),
  ...(config.piiUploadDir ? { piiUploadDir: config.piiUploadDir } : {}),
  allowPiiUploads: config.allowPiiUploads,
  allowAgencyWrites: config.allowAgencyWrites,
  allowSharingKeyRevoke: config.allowSharingKeyRevoke,
  allowSkAdNetworkWrites: config.allowSkAdNetworkWrites,
  skAdNetworkTestAppIds: config.skAdNetworkTestAppIds,
  allowInAppEventCategoryWrites: config.allowInAppEventCategoryWrites,
  inAppEventTestAppIds: config.inAppEventTestAppIds,
  allowRemarketingCounterWrites: config.allowRemarketingCounterWrites,
  remarketingCounterTestIds: config.remarketingCounterTestIds,
  auditFile: config.auditFile,
});

await server.connect(new StdioServerTransport());
