import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EnvFileVkAdsCredentialStore } from "../../src/auth/env-store.js";
import {
  VkAdsTokenLimitError,
  VkAdsTokenRefreshError,
  VkAdsTokenUnavailableError,
} from "../../src/auth/errors.js";
import { VkAdsTokenManager } from "../../src/auth/token-manager.js";

const NOW = Date.parse("2026-07-27T12:00:00.000Z");
const temporaryDirectories: string[] = [];

async function createAuthEnv(
  tokenLines: readonly string[],
): Promise<{ path: string; store: EnvFileVkAdsCredentialStore }> {
  const directory = await mkdtemp(join(tmpdir(), "vk-ads-token-manager-"));
  const path = join(directory, "auth.env");
  temporaryDirectories.push(directory);
  await writeFile(
    path,
    [
      "VK_ADS_CLIENT_ID=test-client",
      "VK_ADS_CLIENT_SECRET=test-secret",
      ...tokenLines,
      "",
    ].join("\n"),
    { encoding: "utf8", mode: 0o600 },
  );

  return {
    path,
    store: new EnvFileVkAdsCredentialStore(path),
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

describe("VkAdsTokenManager", () => {
  it("reuses a token that is valid beyond the refresh window", async () => {
    const { store } = await createAuthEnv([
      "VK_ADS_TOKEN=current-access",
      "VK_ADS_REFRESH_TOKEN=current-refresh",
      `VK_ADS_TOKEN_EXPIRES_AT=${new Date(NOW + 31 * 60_000).toISOString()}`,
    ]);
    const oauthClient = {
      issueClientCredentialsToken: vi.fn(),
      refreshAccessToken: vi.fn(),
    };
    const manager = new VkAdsTokenManager(store, oauthClient, {
      now: () => NOW,
    });

    await expect(manager.getAccessToken()).resolves.toBe("current-access");
    expect(oauthClient.issueClientCredentialsToken).not.toHaveBeenCalled();
    expect(oauthClient.refreshAccessToken).not.toHaveBeenCalled();
  });

  it("refreshes expiring credentials once and persists the newest pair", async () => {
    const { path, store } = await createAuthEnv([
      "VK_ADS_TOKEN=old-access",
      "VK_ADS_REFRESH_TOKEN=old-refresh",
      `VK_ADS_TOKEN_EXPIRES_AT=${new Date(NOW + 5 * 60_000).toISOString()}`,
    ]);
    const oauthClient = {
      issueClientCredentialsToken: vi.fn(),
      refreshAccessToken: vi.fn(async () => ({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresInSeconds: 86_400,
      })),
    };
    const manager = new VkAdsTokenManager(store, oauthClient, {
      now: () => NOW,
    });

    await expect(
      Promise.all([manager.getAccessToken(), manager.getAccessToken()]),
    ).resolves.toEqual(["new-access", "new-access"]);
    expect(oauthClient.refreshAccessToken).toHaveBeenCalledTimes(1);
    expect(oauthClient.refreshAccessToken).toHaveBeenCalledWith(
      "test-client",
      "test-secret",
      "old-refresh",
    );

    const text = await readFile(path, "utf8");
    expect(text).toContain("VK_ADS_TOKEN=new-access");
    expect(text).toContain("VK_ADS_REFRESH_TOKEN=new-refresh");
    expect(text).toContain(
      'VK_ADS_TOKEN_EXPIRES_AT="2026-07-28T12:00:00.000Z"',
    );
  });

  it("coordinates refresh across separate manager instances", async () => {
    const { store } = await createAuthEnv([
      "VK_ADS_TOKEN=old-access",
      "VK_ADS_REFRESH_TOKEN=old-refresh",
      `VK_ADS_TOKEN_EXPIRES_AT=${new Date(NOW - 1).toISOString()}`,
    ]);
    const oauthClient = {
      issueClientCredentialsToken: vi.fn(),
      refreshAccessToken: vi.fn(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 20);
        });

        return {
          accessToken: "shared-access",
          refreshToken: "shared-refresh",
          expiresInSeconds: 86_400,
        };
      }),
    };
    const firstManager = new VkAdsTokenManager(store, oauthClient, {
      now: () => NOW,
    });
    const secondManager = new VkAdsTokenManager(
      new EnvFileVkAdsCredentialStore(store.path),
      oauthClient,
      { now: () => NOW },
    );

    await expect(
      Promise.all([
        firstManager.getAccessToken(),
        secondManager.getAccessToken(),
      ]),
    ).resolves.toEqual(["shared-access", "shared-access"]);
    expect(oauthClient.refreshAccessToken).toHaveBeenCalledTimes(1);
  });

  it("creates one initial token only when no stored token exists", async () => {
    const { store } = await createAuthEnv([
      "VK_ADS_TOKEN=",
      "VK_ADS_REFRESH_TOKEN=",
      "VK_ADS_TOKEN_EXPIRES_AT=",
    ]);
    const oauthClient = {
      issueClientCredentialsToken: vi.fn(async () => ({
        accessToken: "initial-access",
        refreshToken: "initial-refresh",
        expiresInSeconds: 86_400,
      })),
      refreshAccessToken: vi.fn(),
    };
    const manager = new VkAdsTokenManager(store, oauthClient, {
      now: () => NOW,
    });

    await expect(manager.getAccessToken()).resolves.toBe("initial-access");
    expect(oauthClient.issueClientCredentialsToken).toHaveBeenCalledTimes(1);
  });

  it("does not create another token after a refresh rejection", async () => {
    const { path, store } = await createAuthEnv([
      "VK_ADS_TOKEN=old-access",
      "VK_ADS_REFRESH_TOKEN=old-refresh",
      `VK_ADS_TOKEN_EXPIRES_AT=${new Date(NOW - 1).toISOString()}`,
    ]);
    const before = await readFile(path, "utf8");
    const oauthClient = {
      issueClientCredentialsToken: vi.fn(),
      refreshAccessToken: vi.fn(async () => {
        throw new VkAdsTokenRefreshError("invalid_token", 401);
      }),
    };
    const manager = new VkAdsTokenManager(store, oauthClient, {
      now: () => NOW,
    });

    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(
      VkAdsTokenRefreshError,
    );
    expect(oauthClient.issueClientCredentialsToken).not.toHaveBeenCalled();
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("preserves auth.env when the provider reports the token limit", async () => {
    const { path, store } = await createAuthEnv([
      "VK_ADS_TOKEN=",
      "VK_ADS_REFRESH_TOKEN=",
      "VK_ADS_TOKEN_EXPIRES_AT=",
    ]);
    const before = await readFile(path, "utf8");
    const oauthClient = {
      issueClientCredentialsToken: vi.fn(async () => {
        throw new VkAdsTokenLimitError();
      }),
      refreshAccessToken: vi.fn(),
    };
    const manager = new VkAdsTokenManager(store, oauthClient, {
      now: () => NOW,
    });

    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(
      VkAdsTokenLimitError,
    );
    expect(oauthClient.issueClientCredentialsToken).toHaveBeenCalledTimes(1);
    expect(await readFile(path, "utf8")).toBe(before);
  });

  it("refuses to duplicate a token when refresh credentials are missing", async () => {
    const { store } = await createAuthEnv([
      "VK_ADS_TOKEN=expired-access",
      "VK_ADS_REFRESH_TOKEN=",
      `VK_ADS_TOKEN_EXPIRES_AT=${new Date(NOW - 1).toISOString()}`,
    ]);
    const oauthClient = {
      issueClientCredentialsToken: vi.fn(),
      refreshAccessToken: vi.fn(),
    };
    const manager = new VkAdsTokenManager(store, oauthClient, {
      now: () => NOW,
    });

    await expect(manager.getAccessToken()).rejects.toBeInstanceOf(
      VkAdsTokenUnavailableError,
    );
    expect(oauthClient.issueClientCredentialsToken).not.toHaveBeenCalled();
  });

  it("refreshes a provider-rejected token without creating a new one", async () => {
    const { path, store } = await createAuthEnv([
      "VK_ADS_TOKEN=rejected-access",
      "VK_ADS_REFRESH_TOKEN=current-refresh",
      `VK_ADS_TOKEN_EXPIRES_AT=${new Date(NOW + 60 * 60_000).toISOString()}`,
    ]);
    const oauthClient = {
      issueClientCredentialsToken: vi.fn(),
      refreshAccessToken: vi.fn(async () => ({
        accessToken: "replacement-access",
        refreshToken: "replacement-refresh",
        expiresInSeconds: 86_400,
      })),
    };
    const manager = new VkAdsTokenManager(store, oauthClient, {
      now: () => NOW,
    });

    await expect(
      manager.refreshAfterAuthenticationFailure("rejected-access"),
    ).resolves.toBe("replacement-access");
    expect(oauthClient.refreshAccessToken).toHaveBeenCalledWith(
      "test-client",
      "test-secret",
      "current-refresh",
    );
    expect(oauthClient.issueClientCredentialsToken).not.toHaveBeenCalled();
    expect(await readFile(path, "utf8")).toContain(
      "VK_ADS_TOKEN=replacement-access",
    );
  });

  it("reuses a token already replaced by another process", async () => {
    const { store } = await createAuthEnv([
      "VK_ADS_TOKEN=newer-access",
      "VK_ADS_REFRESH_TOKEN=newer-refresh",
      `VK_ADS_TOKEN_EXPIRES_AT=${new Date(NOW + 60 * 60_000).toISOString()}`,
    ]);
    const oauthClient = {
      issueClientCredentialsToken: vi.fn(),
      refreshAccessToken: vi.fn(),
    };
    const manager = new VkAdsTokenManager(store, oauthClient, {
      now: () => NOW,
    });

    await expect(
      manager.refreshAfterAuthenticationFailure("older-access"),
    ).resolves.toBe("newer-access");
    expect(oauthClient.refreshAccessToken).not.toHaveBeenCalled();
  });
});
