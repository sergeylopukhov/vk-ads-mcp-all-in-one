import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  EnvFileVkAdsCredentialStore,
  parseExpiresAt,
} from "../../src/auth/env-store.js";

const temporaryDirectories: string[] = [];

async function createAuthEnv(contents: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "vk-ads-auth-store-"));
  const path = join(directory, "auth.env");
  temporaryDirectories.push(directory);
  await writeFile(path, contents, { encoding: "utf8", mode: 0o600 });
  return path;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("EnvFileVkAdsCredentialStore", () => {
  it("loads credentials without requiring token values", async () => {
    const path = await createAuthEnv(
      [
        "VK_ADS_PROFILE=default",
        "VK_ADS_CLIENT_ID=test-client",
        "VK_ADS_CLIENT_SECRET=test-secret",
        "VK_ADS_TOKEN=",
        "VK_ADS_REFRESH_TOKEN=",
        "VK_ADS_TOKEN_EXPIRES_AT=",
        "",
      ].join("\n"),
    );

    await expect(
      new EnvFileVkAdsCredentialStore(path).load(),
    ).resolves.toEqual({
      clientId: "test-client",
      clientSecret: "test-secret",
    });
  });

  it("atomically updates only managed token variables", async () => {
    const path = await createAuthEnv(
      [
        "# local credentials",
        "VK_ADS_PROFILE=default",
        "VK_ADS_CLIENT_ID=test-client",
        "VK_ADS_CLIENT_SECRET=test-secret",
        "VK_ADS_TOKEN=old-access",
        "VK_ADS_REFRESH_TOKEN=old-refresh",
        "VK_ADS_TOKEN_EXPIRES_AT=1700000000",
        "",
      ].join("\n"),
    );
    const store = new EnvFileVkAdsCredentialStore(path);

    await store.saveTokens({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: Date.parse("2030-01-01T00:00:00.000Z"),
    });

    const text = await readFile(path, "utf8");
    expect(text).toContain("VK_ADS_PROFILE=default");
    expect(text).toContain("VK_ADS_CLIENT_ID=test-client");
    expect(text).toContain("VK_ADS_CLIENT_SECRET=test-secret");
    expect(text).toContain("VK_ADS_TOKEN=new-access");
    expect(text).toContain("VK_ADS_REFRESH_TOKEN=new-refresh");
    expect(text).toContain(
      'VK_ADS_TOKEN_EXPIRES_AT="2030-01-01T00:00:00.000Z"',
    );
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("atomically clears only managed token variables", async () => {
    const path = await createAuthEnv(
      [
        "VK_ADS_PROFILE=default",
        "VK_ADS_CLIENT_ID=test-client",
        "VK_ADS_CLIENT_SECRET=test-secret",
        "VK_ADS_TOKEN=old-access",
        "VK_ADS_REFRESH_TOKEN=old-refresh",
        "VK_ADS_TOKEN_EXPIRES_AT=2030-01-01T00:00:00.000Z",
        "",
      ].join("\n"),
    );
    const store = new EnvFileVkAdsCredentialStore(path);

    await store.clearTokens();

    const text = await readFile(path, "utf8");
    expect(text).toContain("VK_ADS_CLIENT_ID=test-client");
    expect(text).toContain("VK_ADS_CLIENT_SECRET=test-secret");
    expect(text).toContain('VK_ADS_TOKEN=""');
    expect(text).toContain('VK_ADS_REFRESH_TOKEN=""');
    expect(text).toContain('VK_ADS_TOKEN_EXPIRES_AT=""');
    await expect(store.load()).resolves.toEqual({
      clientId: "test-client",
      clientSecret: "test-secret",
    });
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("accepts ISO dates plus Unix seconds and milliseconds", () => {
    expect(parseExpiresAt("2030-01-01T00:00:00.000Z")).toBe(
      Date.parse("2030-01-01T00:00:00.000Z"),
    );
    expect(parseExpiresAt("1700000000")).toBe(1_700_000_000_000);
    expect(parseExpiresAt("1700000000000")).toBe(1_700_000_000_000);
  });
});
