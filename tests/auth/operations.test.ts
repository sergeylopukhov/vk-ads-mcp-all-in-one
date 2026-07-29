import { describe, expect, it, vi } from "vitest";

import type { VkAdsCredentialStore } from "../../src/auth/env-store.js";
import { DefaultVkAdsOAuthOperations } from "../../src/auth/operations.js";

function createStore(): VkAdsCredentialStore {
  return {
    load: vi.fn(async () => ({
      clientId: "client-id",
      clientSecret: "client-secret",
      accessToken: "access-token",
      refreshToken: "refresh-token",
    })),
    saveTokens: vi.fn(async () => undefined),
    clearTokens: vi.fn(async () => undefined),
    withRefreshLock: vi.fn(
      async (operation: () => Promise<unknown>) =>
        await operation(),
    ) as unknown as VkAdsCredentialStore["withRefreshLock"],
  };
}

describe("DefaultVkAdsOAuthOperations", () => {
  it("returns only safe authorization-code metadata", async () => {
    const store = createStore();
    const oauthClient = {
      getAuthorizationCodeInfo: vi.fn(async () => ({
        userTypes: ["advert"],
      })),
      deleteCurrentUserTokens: vi.fn(async () => undefined),
      issueClientCredentialsToken: vi.fn(),
      refreshAccessToken: vi.fn(),
    };
    const operations = new DefaultVkAdsOAuthOperations(
      store,
      oauthClient,
    );

    await expect(
      operations.inspectAuthorizationCode("one-time-code"),
    ).resolves.toEqual({
      userTypes: ["advert"],
    });
    expect(oauthClient.getAuthorizationCodeInfo).toHaveBeenCalledWith(
      "client-id",
      "client-secret",
      "one-time-code",
    );
  });

  it("deletes provider tokens and clears local tokens under the lock", async () => {
    const store = createStore();
    const oauthClient = {
      getAuthorizationCodeInfo: vi.fn(),
      deleteCurrentUserTokens: vi.fn(async () => undefined),
      issueClientCredentialsToken: vi.fn(),
      refreshAccessToken: vi.fn(),
    };
    const operations = new DefaultVkAdsOAuthOperations(
      store,
      oauthClient,
    );

    await operations.deleteCurrentUserTokens();

    expect(vi.mocked(store.withRefreshLock)).toHaveBeenCalledTimes(1);
    expect(oauthClient.deleteCurrentUserTokens).toHaveBeenCalledWith(
      "client-id",
      "client-secret",
    );
    expect(store.clearTokens).toHaveBeenCalledTimes(1);
    expect(
      oauthClient.deleteCurrentUserTokens.mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(store.clearTokens).mock.invocationCallOrder[0]!,
    );
  });

  it("refreshes the current token pair under the lock", async () => {
    const store = createStore();
    const oauthClient = {
      getAuthorizationCodeInfo: vi.fn(),
      deleteCurrentUserTokens: vi.fn(),
      issueClientCredentialsToken: vi.fn(),
      refreshAccessToken: vi.fn(async () => ({
        accessToken: "replacement-access",
        refreshToken: "replacement-refresh",
        expiresInSeconds: 3_600,
      })),
    };
    const operations = new DefaultVkAdsOAuthOperations(
      store,
      oauthClient,
    );
    const before = Date.now();

    const result = await operations.refreshCurrentTokens();

    expect(vi.mocked(store.withRefreshLock)).toHaveBeenCalledTimes(1);
    expect(oauthClient.refreshAccessToken).toHaveBeenCalledWith(
      "client-id",
      "client-secret",
      "refresh-token",
    );
    expect(store.saveTokens).toHaveBeenCalledWith({
      accessToken: "replacement-access",
      refreshToken: "replacement-refresh",
      expiresAt: expect.any(Number),
    });
    expect(result.expiresAt).toBeGreaterThanOrEqual(
      before + 3_600_000,
    );
  });
});
