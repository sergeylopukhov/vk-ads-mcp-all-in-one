import assert from "node:assert/strict";
import test from "node:test";

import { applyEnvValues, defaultInstallDirectory, fillCredentials, parseEnvValues, resolveRef, selectServerFiles } from "../../install.mjs";

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

test("applyEnvValues adds every configured option and quotes unsafe values", () => {
  const result = applyEnvValues("VK_ADS_MODE=readonly\n# VK_ADS_UPLOAD_DIR=\n", {
    VK_ADS_MODE: "write",
    VK_ADS_UPLOAD_DIR: "/tmp/media files",
    VK_ADS_ALLOW_PII_UPLOADS: "1",
  });
  assert.match(result, /^VK_ADS_MODE=write$/m);
  assert.match(result, /^VK_ADS_UPLOAD_DIR="\/tmp\/media files"$/m);
  assert.match(result, /^VK_ADS_ALLOW_PII_UPLOADS=1$/m);
});

test("parseEnvValues reads active values and ignores comments", () => {
  assert.deepEqual(parseEnvValues("# VK_ADS_MODE=write\nVK_ADS_MODE=readonly\nVK_ADS_UPLOAD_DIR=\"/tmp/media files\"\n"), {
    VK_ADS_MODE: "readonly",
    VK_ADS_UPLOAD_DIR: "/tmp/media files",
  });
});

test("defaultInstallDirectory is platform aware", () => {
  assert.equal(defaultInstallDirectory("win32", "C:\\Users\\test", { LOCALAPPDATA: "C:\\Data" }), "C:\\Data\\VK Ads MCP");
  assert.equal(defaultInstallDirectory("darwin", "/Users/test", {}), "/Users/test/Library/Application Support/VK Ads MCP");
  assert.equal(defaultInstallDirectory("linux", "/home/test", {}), "/home/test/.local/share/vk-ads-mcp");
});

test("resolveRef uses main unless the user explicitly selects a source", async () => {
  assert.equal(await resolveRef(undefined), "main");
  assert.equal(await resolveRef("v0.1.0"), "v0.1.0");
});
