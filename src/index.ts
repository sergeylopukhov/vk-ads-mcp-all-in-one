import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { config as loadDotenv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./config.js";
import { createServer } from "./server.js";
import { TokenRateLimiter } from "./rate-limiter.js";
import { VkAdsClient } from "./vk-client.js";

/** .env лежит рядом с package.json, независимо от текущей папки MCP-клиента. */
const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
loadDotenv({ path: resolve(packageDirectory, ".env"), override: false, quiet: true });

const config = loadConfig();
// Лимит действует на все read-запросы одного локального подключения, включая повтор после 401.
const rateLimiter = new TokenRateLimiter();
const client = new VkAdsClient({
  tokenProvider: config.tokenProvider,
  timeoutMs: config.timeoutMs,
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
});

await server.connect(new StdioServerTransport());
