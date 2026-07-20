import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { CoreVkAuth, CoreVkClient } from "./core-vk.js";
import { createServer } from "./server.js";
import { TokenRateLimiter } from "./rate-limiter.js";
import { VkAdsOAuth } from "./vk-ads-oauth.js";
import { VkAdsClient } from "./vk-client.js";

const config = loadConfig();
const coreVkAuth = new CoreVkAuth({
  clientId: config.coreVkClientId,
  profileName: config.profileName,
  secretStore: config.secretStore,
  timeoutMs: config.timeoutMs,
});
const coreVkClient = new CoreVkClient(coreVkAuth, config.timeoutMs);
const vkAdsOAuth = new VkAdsOAuth({
  credentials: config.adsOAuthCredentials,
  redirectUri: config.adsOAuthRedirectUri,
  profileName: config.profileName,
  secretStore: config.secretStore,
  timeoutMs: config.timeoutMs,
});
// Лимит действует на все read-запросы одного локального подключения, включая повтор после 401.
const rateLimiter = new TokenRateLimiter();
const client = new VkAdsClient({
  tokenProvider: config.tokenProvider,
  timeoutMs: config.timeoutMs,
  waitForRequest: () => rateLimiter.wait(),
  ...(config.tokenRefresher ? { tokenRefresher: config.tokenRefresher } : {}),
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
  coreVkAuth,
  coreVkClient,
  vkAdsOAuth,
});

await server.connect(new StdioServerTransport());
