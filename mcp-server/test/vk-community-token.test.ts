import { describe, expect, it } from "vitest";

import { EnvFile } from "../src/env-file.js";
import { VkCommunityTokenManager } from "../src/vk-community-token.js";

describe("VkCommunityTokenManager", () => {
  it("обновляет только Core VK API токен через VK ID и сохраняет заменённый refresh_token", async () => {
    const saved: Array<Record<string, string>> = [];
    let token = "old-access";
    const manager = new VkCommunityTokenManager({
      clientId: "123", deviceId: "device", timeoutMs: 1_000,
      envFile: { set: async (values: Record<string, string>) => { saved.push(values); } } as unknown as EnvFile,
      getAccessToken: () => token,
      getRefreshToken: () => "old-refresh",
      getExpiresAt: () => "2026-07-22T00:01:00.000Z",
      setAccessToken: (value) => { token = value; },
      now: () => Date.parse("2026-07-22T00:00:00.000Z"),
      fetchImplementation: async (url, init) => {
        expect(String(url)).toBe("https://id.vk.ru/oauth2/auth");
        expect(String(init?.body)).toContain("grant_type=refresh_token");
        expect(String(init?.body)).toContain("client_id=123");
        expect(String(init?.body)).toContain("device_id=device");
        return new Response(JSON.stringify({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }));
      },
    });

    await manager.renewOnStartup();
    expect(token).toBe("new-access");
    expect(saved).toEqual([expect.objectContaining({ VK_API_TOKEN: "new-access", VK_API_REFRESH_TOKEN: "new-refresh", VK_API_TOKEN_EXPIRES_AT: "2026-07-22T01:00:00.000Z" })]);
  });

  it("не выполняет сетевой вызов для ещё действующего токена", async () => {
    const manager = new VkCommunityTokenManager({
      clientId: "123", deviceId: "device", timeoutMs: 1_000,
      envFile: { set: async () => undefined } as unknown as EnvFile,
      getAccessToken: () => "access", getRefreshToken: () => "refresh",
      getExpiresAt: () => "2026-07-22T01:00:00.000Z", setAccessToken: () => undefined,
      now: () => Date.parse("2026-07-22T00:00:00.000Z"),
      fetchImplementation: async () => { throw new Error("unexpected"); },
    });
    await expect(manager.renewOnStartup()).resolves.toBeUndefined();
  });
});
