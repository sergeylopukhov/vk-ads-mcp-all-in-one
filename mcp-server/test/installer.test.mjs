import assert from "node:assert/strict";
import test from "node:test";

import { defaultInstallDirectory, fillCredentials, selectServerFiles } from "../../install.mjs";

test("selectServerFiles keeps only files required to build the server", () => {
  const files = selectServerFiles([
    { type: "blob", path: "README.md" },
    { type: "blob", path: "mcp-server/package.json" },
    { type: "blob", path: "mcp-server/src/index.ts" },
    { type: "blob", path: "mcp-server/test/config.test.ts" },
    { type: "tree", path: "mcp-server/src" },
  ]);
  assert.deepEqual(files, ["mcp-server/package.json", "mcp-server/src/index.ts"]);
});

test("fillCredentials replaces blank values without changing the rest of env", () => {
  const result = fillCredentials("VK_ADS_CLIENT_ID=\nVK_ADS_CLIENT_SECRET=\nVK_ADS_MODE=readonly\n", "123", "secret");
  assert.equal(result, "VK_ADS_CLIENT_ID=123\nVK_ADS_CLIENT_SECRET=secret\nVK_ADS_MODE=readonly\n");
});

test("defaultInstallDirectory is platform aware", () => {
  assert.equal(defaultInstallDirectory("win32", "C:\\Users\\test", { LOCALAPPDATA: "C:\\Data" }), "C:\\Data\\VK Ads MCP");
  assert.equal(defaultInstallDirectory("darwin", "/Users/test", {}), "/Users/test/Library/Application Support/VK Ads MCP");
  assert.equal(defaultInstallDirectory("linux", "/home/test", {}), "/home/test/.local/share/vk-ads-mcp");
});
