import { describe, expect, it } from "vitest";

import { EnvFile } from "../src/env-file.js";
import { VkAdsTokenManager } from "../src/vk-ads-token.js";

describe("VkAdsTokenManager", () => {
  it("после подтверждённого recovery удаляет токены и сохраняет один новый с refresh_token", async () => {
    const saved: Array<Record<string, string>> = [];
    const requests: Array<{ url: string; body: string }> = [];
    let accessToken = "old-access-token";
    const manager = new VkAdsTokenManager({
      credentials: { clientId: "client-id", clientSecret: "client-secret" },
      envFile: { set: async (values: Record<string, string>) => { saved.push(values); } } as unknown as EnvFile,
      getAccessToken: () => accessToken,
      getRefreshToken: () => undefined,
      getTokenExpiresAt: () => undefined,
      setAccessToken: (token) => { accessToken = token; },
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), body: String(init?.body) });
        if (String(url).endsWith("/oauth2/token/delete.json")) return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ access_token: "new-access-token", refresh_token: "new-refresh-token", expires_in: 86_400 }), { status: 200 });
      },
    });

    await expect(manager.recoverTokenLimit()).resolves.toMatchObject({ token_reissued: true, refresh_token_saved: true, expires_at: expect.any(String) });
    expect(requests.map((request) => request.url)).toEqual([
      "https://ads.vk.com/api/v2/oauth2/token/delete.json",
      "https://ads.vk.com/api/v2/oauth2/token.json",
    ]);
    expect(requests[0]!.body).toContain("client_id=client-id");
    expect(requests[0]!.body).not.toContain("old-access-token");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ VK_ADS_TOKEN: "new-access-token", VK_ADS_REFRESH_TOKEN: "new-refresh-token" });
    expect(accessToken).toBe("new-access-token");
  });

  it("не сохраняет replacement token без обязательного refresh_token", async () => {
    const saved: Array<Record<string, string>> = [];
    const manager = new VkAdsTokenManager({
      credentials: { clientId: "client-id", clientSecret: "client-secret" },
      envFile: { set: async (values: Record<string, string>) => { saved.push(values); } } as unknown as EnvFile,
      getAccessToken: () => "old-access-token",
      getRefreshToken: () => undefined,
      getTokenExpiresAt: () => undefined,
      setAccessToken: () => undefined,
      timeoutMs: 1_000,
      fetchImplementation: async (url) => String(url).endsWith("/oauth2/token/delete.json")
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify({ access_token: "new-access-token", expires_in: 86_400 }), { status: 200 }),
    });

    await expect(manager.recoverTokenLimit()).rejects.toThrow("не вернул refresh_token");
    expect(saved).toEqual([]);
  });

  it("не обращается к OAuth, когда токен истекает более чем через час", async () => {
    const requests: string[] = [];
    const manager = createManager({
      expiresAt: "2026-07-21T03:00:01.000Z",
      fetchImplementation: async (url) => {
        requests.push(String(url));
        return new Response("unexpected", { status: 500 });
      },
    });

    await expect(manager.renewOnStartup()).resolves.toBeUndefined();
    expect(requests).toEqual([]);
  });

  it("за час до истечения обновляет токен через refresh_token", async () => {
    const saved: Array<Record<string, string>> = [];
    const requests: Array<{ url: string; body: string }> = [];
    const manager = createManager({
      expiresAt: "2026-07-21T01:00:00.000Z",
      saved,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), body: String(init?.body) });
        return new Response(JSON.stringify({ access_token: "renewed-access-token", refresh_token: "renewed-refresh-token", expires_in: 86_400 }), { status: 200 });
      },
    });

    await manager.renewOnStartup();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://ads.vk.com/api/v2/oauth2/token.json");
    expect(requests[0]!.body).toContain("grant_type=refresh_token");
    expect(requests[0]!.body).toContain("refresh_token=old-refresh-token");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ VK_ADS_TOKEN: "renewed-access-token", VK_ADS_REFRESH_TOKEN: "renewed-refresh-token", VK_ADS_TOKEN_EXPIRES_AT: "2026-07-22T00:00:00.000Z" });
  });

  it("после token_limit_exceeded отзывает токены и выпускает один новый", async () => {
    const saved: Array<Record<string, string>> = [];
    const requests: Array<{ url: string; body: string }> = [];
    const manager = createManager({
      expiresAt: "2026-07-21T00:30:00.000Z",
      saved,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), body: String(init?.body) });
        if (requests.length === 1) return new Response(JSON.stringify({ error: "token_limit_exceeded" }), { status: 403 });
        if (String(url).endsWith("/oauth2/token/delete.json")) return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ access_token: "replacement-access-token", refresh_token: "replacement-refresh-token", expires_in: 86_400 }), { status: 200 });
      },
    });

    await manager.renewOnStartup();
    expect(requests.map((request) => request.url)).toEqual([
      "https://ads.vk.com/api/v2/oauth2/token.json",
      "https://ads.vk.com/api/v2/oauth2/token/delete.json",
      "https://ads.vk.com/api/v2/oauth2/token.json",
    ]);
    expect(requests[2]!.body).toContain("grant_type=client_credentials");
    expect(requests[2]!.body).not.toContain("refresh_token=");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ VK_ADS_TOKEN: "replacement-access-token", VK_ADS_REFRESH_TOKEN: "replacement-refresh-token" });
  });

  it("при отсутствующем или некорректном сроке обновляет токен только через refresh_token", async () => {
    for (const expiresAt of [undefined, "not-a-date"]) {
      const requests: Array<{ url: string; body: string }> = [];
      const manager = createManager({
        expiresAt,
        fetchImplementation: async (url, init) => {
          requests.push({ url: String(url), body: String(init?.body) });
          return new Response(JSON.stringify({ access_token: "renewed-access-token", refresh_token: "renewed-refresh-token", expires_in: 86_400 }), { status: 200 });
        },
      });

      await manager.renewOnStartup();
      expect(requests).toHaveLength(1);
      expect(requests[0]!.body).toContain("grant_type=refresh_token");
    }
  });

  it("не создаёт токен на старте без refresh_token и неизвестном сроке", async () => {
    const requests: string[] = [];
    const manager = createManager({
      expiresAt: undefined,
      refreshToken: null,
      fetchImplementation: async (url) => {
        requests.push(String(url));
        return new Response("unexpected", { status: 500 });
      },
    });

    await manager.renewOnStartup();
    expect(requests).toEqual([]);
  });

  it("при ошибке обновления завершает запуск, не меняя локальный файл", async () => {
    const saved: Array<Record<string, string>> = [];
    const manager = createManager({
      expiresAt: "2026-07-21T00:30:00.000Z",
      saved,
      fetchImplementation: async () => new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    });

    await expect(manager.renewOnStartup()).rejects.toThrow("invalid_grant");
    expect(saved).toEqual([]);
  });
});

function createManager(options: {
  expiresAt?: string;
  refreshToken?: string | null;
  saved?: Array<Record<string, string>>;
  fetchImplementation: typeof fetch;
}): VkAdsTokenManager {
  let accessToken = "old-access-token";
  return new VkAdsTokenManager({
    credentials: { clientId: "client-id", clientSecret: "client-secret" },
    envFile: { set: async (values: Record<string, string>) => { options.saved?.push(values); } } as unknown as EnvFile,
    getAccessToken: () => accessToken,
    getRefreshToken: () => options.refreshToken === undefined ? "old-refresh-token" : options.refreshToken ?? undefined,
    getTokenExpiresAt: () => options.expiresAt,
    setAccessToken: (token) => { accessToken = token; },
    timeoutMs: 1_000,
    fetchImplementation: options.fetchImplementation,
    now: () => Date.parse("2026-07-21T00:00:00.000Z"),
  });
}
