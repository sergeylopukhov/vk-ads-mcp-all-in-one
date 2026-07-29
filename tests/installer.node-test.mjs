// Этот набор запускается через node:test отдельно от Vitest.
import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  applyEnvValues,
  codexSkillDirectory,
  DEFAULT_AUTH_ENV_TEMPLATE,
  DEFAULT_COMMUNITY_LEGACY_CLIENT_ID,
  defaultInstallDirectory,
  installCodexSkill,
  parseEnvValues,
  parseInstalledVersion,
  requiresConfiguration,
  resolveRef,
  selectServerFiles,
} from "../install.mjs";

const repositoryRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
);

test("selectServerFiles keeps only runtime build inputs", () => {
  const files = selectServerFiles([
    { type: "blob", path: "README.md" },
    { type: "blob", path: ".env.example" },
    { type: "blob", path: "package.json" },
    { type: "blob", path: "src/index.ts" },
    { type: "blob", path: "tests/server.test.ts" },
    { type: "tree", path: "src" },
  ]);

  assert.deepEqual(files, [
    "package.json",
    "src/index.ts",
  ]);
});

test("selectServerFiles includes the Codex skill", () => {
  const files = selectServerFiles([
    { type: "blob", path: "codex-skill/SKILL.md" },
    { type: "blob", path: "codex-skill/references/workflow.md" },
  ]);

  assert.deepEqual(files, [
    "codex-skill/SKILL.md",
    "codex-skill/references/workflow.md",
  ]);
});

test("Codex skill keeps the current blocked tool set synchronized", async () => {
  const [catalog, routing] = await Promise.all([
    readFile(join(repositoryRoot, "docs", "tools.md"), "utf8"),
    readFile(
      join(
        repositoryRoot,
        "codex-skill",
        "references",
        "tool-routing.md",
      ),
      "utf8",
    ),
  ]);

  const catalogNames = [
    ...catalog.matchAll(
      /^\| `(vk_[^`]+)` \| `(?:read|write)` \| .* \| ⛔️ \|$/gmu,
    ),
  ].map((match) => match[1]).sort();
  const blockedSection = routing.split("## Current `⛔️` tools\n")[1];
  assert.ok(blockedSection, "missing current blocked tools section");
  const routingNames = [
    ...blockedSection.matchAll(/^- `(vk_[^`]+)`$/gmu),
  ].map((match) => match[1]).sort();

  assert.deepEqual(routingNames, catalogNames);
});

test("package exposes install.mjs as its only executable", async () => {
  const packageJson = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );

  assert.deepEqual(packageJson.bin, {
    "vk-ads-mcp": "install.mjs",
  });
  assert.equal(packageJson.files.includes("install.sh"), false);
  assert.equal(packageJson.files.includes("install.ps1"), false);
});

test("installCodexSkill replaces the complete managed skill", async () => {
  const root = await mkdtemp(
    join(tmpdir(), "vk-ads-mcp-installer-test-"),
  );

  try {
    const installDirectory = join(root, "server");
    const home = join(root, "home");
    await mkdir(join(installDirectory, "codex-skill", "references"), {
      recursive: true,
    });
    await writeFile(
      join(installDirectory, "codex-skill", "SKILL.md"),
      "# VK Ads MCP\n",
    );
    await writeFile(
      join(
        installDirectory,
        "codex-skill",
        "references",
        "workflows.md",
      ),
      "# Workflows\n",
    );

    const destination = await installCodexSkill(
      installDirectory,
      home,
    );
    assert.equal(
      destination,
      join(home, ".codex", "skills", "vk-ads-mcp", "SKILL.md"),
    );
    assert.equal(
      codexSkillDirectory(home),
      join(home, ".codex", "skills", "vk-ads-mcp"),
    );
    assert.equal(await readFile(destination, "utf8"), "# VK Ads MCP\n");
    assert.equal(
      await readFile(
        join(
          codexSkillDirectory(home),
          "references",
          "workflows.md",
        ),
        "utf8",
      ),
      "# Workflows\n",
    );

    await writeFile(
      join(codexSkillDirectory(home), "obsolete.md"),
      "remove me\n",
    );
    await writeFile(
      join(installDirectory, "codex-skill", "SKILL.md"),
      "# VK Ads MCP v2\n",
    );
    await installCodexSkill(installDirectory, home);

    assert.equal(
      await readFile(destination, "utf8"),
      "# VK Ads MCP v2\n",
    );
    await assert.rejects(
      readFile(join(codexSkillDirectory(home), "obsolete.md"), "utf8"),
      { code: "ENOENT" },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("applyEnvValues fills credentials and preserves the template", () => {
  const result = applyEnvValues(
    "VK_ADS_CLIENT_ID=\nVK_ADS_CLIENT_SECRET=\nVK_ADS_TOKEN=\n",
    {
      VK_ADS_CLIENT_ID: "123",
      VK_ADS_CLIENT_SECRET: "secret value",
    },
  );

  assert.match(result, /^VK_ADS_CLIENT_ID=123$/mu);
  assert.match(
    result,
    /^VK_ADS_CLIENT_SECRET="secret value"$/mu,
  );
  assert.match(result, /^VK_ADS_TOKEN=$/mu);
});

test("parseEnvValues reads active values and quoted strings", () => {
  assert.deepEqual(
    parseEnvValues(
      '# comment\nVK_ADS_CLIENT_ID=123\nVK_ADS_CLIENT_SECRET="secret value"\n',
    ),
    {
      VK_ADS_CLIENT_ID: "123",
      VK_ADS_CLIENT_SECRET: "secret value",
    },
  );
});

test("community search defaults to the built-in VK application", () => {
  const defaults = parseEnvValues(DEFAULT_AUTH_ENV_TEMPLATE);

  assert.equal(DEFAULT_COMMUNITY_LEGACY_CLIENT_ID, "6270012");
  assert.equal(defaults.VK_API_TOKEN_TYPE, "legacy");
  assert.equal(
    defaults.VK_API_CLIENT_ID,
    DEFAULT_COMMUNITY_LEGACY_CLIENT_ID,
  );
});

test("installer recognises versions and required credentials", () => {
  assert.equal(
    parseInstalledVersion('{"ref":"v0.1.0"}'),
    "v0.1.0",
  );
  assert.equal(parseInstalledVersion("not json"), undefined);
  assert.equal(
    requiresConfiguration({
      VK_ADS_CLIENT_ID: "id",
      VK_ADS_CLIENT_SECRET: "secret",
    }),
    false,
  );
  assert.equal(
    requiresConfiguration({ VK_ADS_CLIENT_ID: "id" }),
    true,
  );
});

test("defaultInstallDirectory is platform aware", () => {
  assert.equal(
    defaultInstallDirectory("win32", "C:\\Users\\test", {
      LOCALAPPDATA: "C:\\Data",
    }),
    "C:\\Data\\VK Ads MCP",
  );
  assert.equal(
    defaultInstallDirectory("darwin", "/Users/test", {}),
    "/Users/test/Library/Application Support/VK Ads MCP",
  );
  assert.equal(
    defaultInstallDirectory("linux", "/home/test", {}),
    "/home/test/.local/share/vk-ads-mcp",
  );
});

test("resolveRef prefers a release and supports an explicit source", async () => {
  assert.equal(
    await resolveRef(undefined, async () => ({
      tag_name: "v0.1.1",
    })),
    "v0.1.1",
  );
  assert.equal(
    await resolveRef(undefined, async () => undefined),
    "main",
  );
  assert.equal(await resolveRef("feature"), "feature");
});
