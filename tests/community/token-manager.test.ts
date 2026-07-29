import { describe, expect, it } from "vitest";

import { VkCommunityTokenManager } from "../../src/community/token-manager.js";

describe("community token manager", () => {
  it("refreshes only Core VK values", async () => {
    const saved: Array<Record<string, string>> = [];
    let token = "old-access";
    const manager = new VkCommunityTokenManager({
      clientId: "123",
      deviceId: "device",
      getAccessToken: () => token,
      getRefreshToken: () => "old-refresh",
      getExpiresAt: () => "2026-07-22T00:01:00.000Z",
      setAccessToken: (value) => {
        token = value;
      },
      save: async (values) => {
        saved.push(values);
      },
      timeoutMs: 1_000,
      now: () => Date.parse("2026-07-22T00:00:00.000Z"),
      fetchImplementation: async (url, init) => {
        expect(String(url)).toBe("https://id.vk.ru/oauth2/auth");
        expect(String(init?.body)).toContain(
          "grant_type=refresh_token",
        );
        return new Response(
          JSON.stringify({
            access_token: "new-access",
            refresh_token: "new-refresh",
            expires_in: 3_600,
          }),
        );
      },
    });

    await manager.renewOnStartup();
    expect(token).toBe("new-access");
    expect(saved).toEqual([
      expect.objectContaining({
        VK_API_TOKEN: "new-access",
        VK_API_REFRESH_TOKEN: "new-refresh",
        VK_API_TOKEN_EXPIRES_AT: "2026-07-22T01:00:00.000Z",
      }),
    ]);
  });
});
