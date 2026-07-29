import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createVkAdsMcpServer } from "./server.js";
import { createDefaultVkCommunityRuntime } from "./community/runtime.js";

const communityRuntime = await createDefaultVkCommunityRuntime();
await communityRuntime.renewOnStartup();
const server = createVkAdsMcpServer(
  undefined,
  undefined,
  undefined,
  communityRuntime,
);
let isShuttingDown = false;

async function shutdown(): Promise<void> {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  try {
    await server.close();
  } catch {
    process.stderr.write("VK Ads MCP failed to shut down cleanly.\n");
    process.exitCode = 1;
  }
}

process.once("SIGINT", () => {
  void shutdown();
});

process.once("SIGTERM", () => {
  void shutdown();
});

try {
  await server.connect(new StdioServerTransport());
} catch {
  process.stderr.write("VK Ads MCP failed to start.\n");
  process.exitCode = 1;
}
