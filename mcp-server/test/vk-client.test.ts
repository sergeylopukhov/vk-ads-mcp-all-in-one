import { describe, expect, it } from "vitest";

import { VkAdsApiError, VkAdsClient } from "../src/vk-client.js";

describe("VkAdsClient", () => {
  it("использует только фиксированный VK Ads host и Bearer token", async () => {
    let receivedUrl = "";
    let authorization = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return new Response(JSON.stringify({ count: 1, offset: 0, items: [{ id: 1, name: "A" }] }), { status: 200 });
      },
    });

    await expect(client.listAdPlans(0, 1)).resolves.toEqual({ count: 1, offset: 0, items: [{ id: 1, name: "A" }] });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/ad_plans.json?offset=0&limit=1");
    expect(authorization).toBe("Bearer test-token");
  });

  it("читает detail счётчика ремаркетинга только через документированный fixed path", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ id: 7, name: "Счётчик" }), { status: 200 });
      },
    });

    await expect(client.getRemarketingCounter(7)).resolves.toEqual({ id: 7, name: "Счётчик" });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/remarketing/counters/7.json");
  });

  it("перечитывает и обновляет metadata Apple и Google приложений только документированными fixed paths", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ id: 7, title: "Public app", category_id: 4 }), { status: 200 });
      },
    });

    await expect(client.getAppleApp(535176909)).resolves.toMatchObject({ id: 7 });
    await expect(client.refreshAppleAppMetadata(535176909)).resolves.toMatchObject({ id: 7 });
    await expect(client.getGoogleApp("com.example.app")).resolves.toMatchObject({ id: 7 });
    await expect(client.refreshGoogleAppMetadata("com.example.app")).resolves.toMatchObject({ id: 7 });
    await expect(client.refreshGoogleAppMetadata("../unsafe")).rejects.toThrow("недопустимые символы");
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/apple_apps/535176909.json", method: "GET", body: "" },
      { url: "https://ads.vk.com/api/v2/apple_apps/535176909.json", method: "POST", body: "{}" },
      { url: "https://ads.vk.com/api/v2/google_apps/com.example.app.json", method: "GET", body: "" },
      { url: "https://ads.vk.com/api/v2/google_apps/com.example.app.json", method: "POST", body: "{}" },
    ]);
  });

  it("создаёт v3-подписку только с документированными ресурсом и callback body", async () => {
    let request: { url: string; method: string; body: string } | undefined;
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        request = { url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") };
        return new Response(JSON.stringify({ id: 123 }), { status: 200 });
      },
    });

    await expect(client.createSubscription({ resource: "BANNER", callbackUrl: "https://callback.example.test/vk" })).resolves.toEqual({ id: 123 });
    expect(request).toEqual({ url: "https://ads.vk.com/api/v3/subscription.json", method: "POST", body: '{"resource":"BANNER","callback_url":"https://callback.example.test/vk"}' });
  });

  it("изменяет и удаляет доступный счётчик фиксированными путями", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        if (init?.method === "POST") return new Response(JSON.stringify({ id: 7, name: "__MCP_TEST__ renamed" }), { status: 200 });
        return new Response(JSON.stringify({ id: 7, name: "__MCP_TEST__ counter" }), { status: 200 });
      },
    });

    await expect(client.renameTestRemarketingCounter(7, "__MCP_TEST__ renamed")).resolves.toMatchObject({ id: 7 });
    await expect(client.createTestCounterGoal({ counterId: 7, name: "__MCP_TEST__ purchase", substr: "order_accepted", condition: "jse", goalType: "purchase", value: 45 })).resolves.toMatchObject({ id: 7 });
    await expect(client.deleteTestRemarketingCounter(7)).resolves.toEqual({});
    await expect(client.deleteTestRemarketingCounterV2(7)).resolves.toEqual({});
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/remarketing/counters/7.json", method: "POST", body: '{"name":"__MCP_TEST__ renamed"}' },
      { url: "https://ads.vk.com/api/v2/remarketing/counters/7/goals.json", method: "POST", body: '{"substr":"order_accepted","condition":"jse","name":"__MCP_TEST__ purchase","goal_type":"purchase","value":45}' },
      { url: "https://ads.vk.com/api/v1/remarketing_counters/7.json", method: "DELETE", body: "" },
      { url: "https://ads.vk.com/api/v2/remarketing/counters/7.json", method: "DELETE", body: "" },
    ]);
  });

  it("вызывает опубликованные HTTP DELETE для группы, баннера и подписки", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "GET" });
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        if (String(url).includes("subscription.json")) return new Response(JSON.stringify({ count: 1, offset: 0, items: [{ id: 9 }] }), { status: 200 });
        return new Response(JSON.stringify({ id: 7, name: "__MCP_TEST__ object" }), { status: 200 });
      },
    });

    await expect(client.deleteAdGroupHttp(7)).resolves.toEqual({});
    await expect(client.deleteBannerHttp(8)).resolves.toEqual({});
    await expect(client.deleteSubscription(9)).resolves.toEqual({});
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/ad_groups/7.json", method: "GET" },
      { url: "https://ads.vk.com/api/v2/ad_groups/7.json", method: "DELETE" },
      { url: "https://ads.vk.com/api/v2/banners/8.json", method: "GET" },
      { url: "https://ads.vk.com/api/v2/banners/8.json", method: "DELETE" },
      { url: "https://ads.vk.com/api/v3/subscription.json?offset=0&limit=200", method: "GET" },
      { url: "https://ads.vk.com/api/v3/subscription/9.json", method: "DELETE" },
    ]);
  });

  it("обновляет и удаляет связь manager-client только фиксированными URL", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        if (init?.method === "POST") return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ count: 1, offset: 0, items: [{ id: 7, manager_id: 3, client_id: 9 }] }), { status: 200 });
      },
    });

    await expect(client.updateAgencyManagerClient({ managerId: 3, clientId: 9, accessType: "readonly" })).resolves.toEqual({});
    await expect(client.deleteAgencyManagerClient(3, 9)).resolves.toEqual({});
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v3/manager/clients.json", method: "GET", body: "" },
      { url: "https://ads.vk.com/api/v2/agency/managers/3/clients/9.json", method: "POST", body: '{"access_type":"readonly"}' },
      { url: "https://ads.vk.com/api/v3/manager/clients.json", method: "GET", body: "" },
      { url: "https://ads.vk.com/api/v2/agency/managers/3/clients/9.json", method: "DELETE", body: "" },
    ]);
  });

  it("обновляет и удаляет связь agency-client только фиксированными URL", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
        if (init?.method === "DELETE" || init?.method === "POST") return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ items: [{ id: 9, access_type: "full_access" }] }), { status: 200 });
      },
    });

    await expect(client.updateAgencyClient({ clientId: 9, isVkads: true, accessType: "full_access", additionalEmails: ["ops@example.test"], additionalInfo: { clientName: "Test client", clientInfo: "Test note" } })).resolves.toEqual({});
    await expect(client.deleteAgencyClient(9)).resolves.toEqual({});
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/agency/clients.json", method: "GET", body: "" },
      { url: "https://ads.vk.com/api/v2/agency/clients/9.json", method: "POST", body: '{"is_vkads":true,"access_type":"full_access","user":{"additional_emails":["ops@example.test"],"additional_info":{"client_name":"Test client","client_info":"Test note"}}}' },
      { url: "https://ads.vk.com/api/v2/agency/clients.json", method: "GET", body: "" },
      { url: "https://ads.vk.com/api/v2/agency/clients/9.json", method: "DELETE", body: "" },
    ]);
  });

  it("подключает существующий счётчик ремаркетинга без пароля только фиксированным URL", async () => {
    let receivedUrl = "";
    let receivedBody = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        receivedBody = String(init?.body);
        return new Response(null, { status: 204 });
      },
    });

    await expect(client.connectExistingRemarketingCounter({ counterId: 77, name: "Existing counter", flags: ["cookie_sync"] })).resolves.toEqual({});
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/remarketing/counters.json");
    expect(JSON.parse(receivedBody)).toEqual({ counter_id: 77, name: "Existing counter", flags: ["cookie_sync"] });
  });

  it("обновляет профиль только фиксированными v2 и v3 endpoint", async () => {
    const requests: Array<{ url: string; body: string }> = [];
    const client = new VkAdsClient({ tokenProvider: () => "test-token", timeoutMs: 1_000, fetchImplementation: async (url, init) => {
      requests.push({ url: String(url), body: String(init?.body) });
      return new Response(null, { status: 204 });
    } });
    await expect(client.updateUserProfile("v2", { language: "ru" })).resolves.toEqual({});
    await expect(client.updateUserProfile("v3", { language: "en" })).resolves.toEqual({});
    expect(requests).toEqual([{ url: "https://ads.vk.com/api/v2/user.json", body: '{"language":"ru"}' }, { url: "https://ads.vk.com/api/v3/user.json", body: '{"language":"en"}' }]);
  });

  it("отправляет ORD и billing writes только на документированные пути", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
        if (String(url).includes("subagents/42")) return new Response(JSON.stringify({ id: 42, name: "Контрагент" }), { status: 200 });
        if (String(url).includes("acts/2026-07-01/7")) return new Response(JSON.stringify({ id: 7, acts_count: 1 }), { status: 200 });
        if (String(url).includes("pads/7")) return new Response(null, { status: 204 });
        if (String(url).includes("subagents.json")) return new Response(JSON.stringify({ id: 42, name: "Контрагент" }), { status: 201 });
        if (String(url).includes("transactions/to/9")) return new Response(JSON.stringify({ amount: "10.00" }), { status: 200 });
        return new Response(JSON.stringify({ id: 7 }), { status: 200 });
      },
    });

    await expect(client.updateOrdPartnerActs("2026-07-01", 7, [{ contract_id: 1, act_date: "2026-06-01", amount: "10.00", has_vat: false }])).resolves.toMatchObject({ id: 7 });
    await expect(client.updateOrdPartnerPad(7, { name: "new" })).resolves.toEqual({});
    await expect(client.createOrdPartnerSubagent({ user_type: "juridical", role: ["publisher"], name: "Контрагент" })).resolves.toMatchObject({ id: 42 });
    await expect(client.updateOrdPartnerSubagent(42, { name: "Новое имя" })).resolves.toMatchObject({ id: 42 });
    await expect(client.transferToClient(9, "10.00")).resolves.toMatchObject({ amount: "10.00" });
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v1/ord/partner/acts/2026-07-01/7.json", method: "POST", body: '{"acts":[{"contract_id":1,"act_date":"2026-06-01","amount":"10.00","has_vat":false}]}' },
      { url: "https://ads.vk.com/api/v1/ord/partner/pads/7.json", method: "POST", body: '{"name":"new"}' },
      { url: "https://ads.vk.com/api/v1/ord/partner/subagents.json", method: "POST", body: '{"user_type":"juridical","role":["publisher"],"name":"Контрагент"}' },
      { url: "https://ads.vk.com/api/v1/ord/partner/subagents/42.json", method: "POST", body: '{"name":"Новое имя"}' },
      { url: "https://ads.vk.com/api/v2/billing/transactions/to/9.json", method: "POST", body: '{"amount":"10.00"}' },
    ]);
  });

  it("изменяет найденную цель счётчика фиксированным detail path", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
        if (init?.method === "POST") return new Response(JSON.stringify({ id: 12, name: "__MCP_TEST__ goal", value: 3, goal_type: "purchase" }), { status: 200 });
        if (String(url).endsWith("/goals.json")) return new Response(JSON.stringify({ items: [{ id: 12, name: "__MCP_TEST__ goal" }] }), { status: 200 });
        return new Response(JSON.stringify({ id: 7, name: "__MCP_TEST__ counter" }), { status: 200 });
      },
    });

    await expect(client.updateTestCounterGoal({ counterId: 7, goalId: 12, name: "__MCP_TEST__ goal", value: 3, goalType: "purchase" })).resolves.toMatchObject({ id: 12 });
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/remarketing/counters/7/goals.json", method: "GET", body: "" },
      { url: "https://ads.vk.com/api/v2/remarketing/counters/7/goals/12.json", method: "POST", body: '{"name":"__MCP_TEST__ goal","value":3,"goal_type":"purchase"}' },
    ]);
  });

  it("запрашивает rich-поля plan и group только из живого allowlist", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ count: 0, offset: 0, items: [] }), { status: 200 });
      },
    });

    await client.listAdPlans(0, 1, ["id", "budget_limit"]);
    await client.listAdGroups(0, 1, ["id", "targetings"]);
    expect(urls).toEqual([
      "https://ads.vk.com/api/v2/ad_plans.json?offset=0&limit=1&fields=id%2Cbudget_limit",
      "https://ads.vk.com/api/v2/ad_groups.json?offset=0&limit=1&fields=id%2Ctargetings",
    ]);
    await expect(client.listAdGroups(0, 1, ["patterns"])).rejects.toThrow("неподтверждённое поле ad_group");
  });

  it("не принимает неразрешённый размер страницы", async () => {
    const client = new VkAdsClient({ tokenProvider: () => "test-token", timeoutMs: 1_000, fetchImplementation: fetch });
    await expect(client.listBanners(0, 201)).rejects.toThrow("limit должен быть целым числом от 1 до 200");
  });

  it("фильтрует banners только по подтверждённой группе и полям", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ count: 0, offset: 0, items: [] }), { status: 200 });
      },
    });

    await expect(client.listBanners(0, 1, { adGroupId: 42, fields: ["id", "content", "urls"] })).resolves.toMatchObject({ count: 0 });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/banners.json?offset=0&limit=1&_ad_group_id__in=42&fields=id%2Ccontent%2Curls");
    await expect(client.listBanners(0, 1, { fields: ["patterns"] })).rejects.toThrow("неподтверждённое поле banner");
  });

  it("добавляет _user_id только как положительный ручной read-scope", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ count: 0, offset: 0, items: [] }), { status: 200 });
      },
    });
    await client.listCampaigns(0, 1, 42);
    await client.listAdGroups(0, 1, ["id"], 42);
    await client.listBanners(0, 1, { userId: 42, fields: ["id"] });
    expect(urls).toEqual([
      "https://ads.vk.com/api/v2/campaigns.json?offset=0&limit=1&_user_id=42",
      "https://ads.vk.com/api/v2/ad_groups.json?offset=0&limit=1&fields=id&_user_id=42",
      "https://ads.vk.com/api/v2/banners.json?offset=0&limit=1&fields=id&_user_id=42",
    ]);
    await expect(client.listCampaigns(0, 1, 0)).rejects.toThrow("положительным");
  });

  it("запрашивает подтверждённый v2 endpoint статистики", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ items: [{ id: 1, total: { base: { clicks: 2 }, uniques: { reach: 0, total: 12 } } }], total: { base: { clicks: 2 }, uniques: { reach: 0, total: 12 } } }), { status: 200 });
      },
    });

    await expect(client.getStatistics({ objectType: "banners", period: "summary", ids: [1], metrics: "base" })).resolves.toEqual({ items: [{ id: 1, total: { base: { clicks: 2 }, uniques: { total: 12 } } }], total: { base: { clicks: 2 }, uniques: { total: 12 } } });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/statistics/banners/summary.json?metrics=base&id=1");
  });

  it("поддерживает raw campaigns как отдельный статистический объект", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ items: [], total: {} }), { status: 200 });
      },
    });
    await expect(client.getStatistics({ objectType: "campaigns", period: "summary" })).resolves.toMatchObject({ items: [] });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/statistics/campaigns/summary.json?metrics=base");
  });

  it("читает v3-дневную статистику только по документированному пути и полям", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ items: [{ id: 8, total: { uniques: { reach: 0, total: 9 } } }], total: { uniques: { reach: 0, total: 9 } } }), { status: 200 });
      },
    });

    await expect(client.getStatistics({ apiVersion: "v3", objectType: "ad_groups", period: "day", ids: [8], dateFrom: "2026-07-01", dateTo: "2026-07-02", metrics: "uniques" })).resolves.toEqual({ items: [{ id: 8, total: { uniques: { total: 9 } } }], total: { uniques: { total: 9 } } });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v3/statistics/ad_groups/day.json?fields=uniques&id=8&date_from=2026-07-01&date_to=2026-07-02");
    await expect(client.getStatistics({ apiVersion: "v3", objectType: "campaigns", period: "day", dateFrom: "2026-07-01", dateTo: "2026-07-02" })).rejects.toThrow("objectType=campaigns");
    await expect(client.getStatistics({ apiVersion: "v3", objectType: "banners", period: "summary" })).rejects.toThrow("period=day");
  });

  it("поддерживает агрегированную статистику кабинета users", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ items: [{ id: 1, total: { base: {} } }], total: { base: {} } }), { status: 200 });
      },
    });
    await expect(client.getStatistics({ objectType: "users", period: "day", dateFrom: "2026-07-01", dateTo: "2026-07-18" })).resolves.toMatchObject({ items: [{ id: 1 }] });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/statistics/users/day.json?metrics=base&date_from=2026-07-01&date_to=2026-07-18");
  });

  it("читает in-app статистику только по документированным entity и датам", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ items: [], total: {} }), { status: 200 });
      },
    });
    await expect(client.getInAppStatistics({ objectType: "users", dateFrom: "2026-07-01", dateTo: "2026-07-18", attribution: "conversion", conversionType: "total" })).resolves.toMatchObject({ items: [] });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/statistics/inapp/users/day.json?date_from=2026-07-01&date_to=2026-07-18&attribution=conversion&conversion_type=total");
  });

  it("читает офлайн-конверсии и faststat только через фиксированные контракты", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        urls.push(String(url));
        if (String(url).includes("offline_conversions")) return new Response(JSON.stringify({ items: [{ id: 1 }] }), { status: 200 });
        return new Response(JSON.stringify({ banners: [] }), { status: 200 });
      },
    });
    await expect(client.getOfflineConversionStatistics({ objectType: "ad_groups", ids: [1], dateFrom: "2026-07-01", dateTo: "2026-07-18" })).resolves.toEqual({ items: [{ id: 1 }] });
    await expect(client.getFastStatistics("users")).resolves.toEqual({ banners: [] });
    expect(urls).toEqual([
      "https://ads.vk.com/api/v2/statistics/offline_conversions/ad_groups/day.json?id=1&date_from=2026-07-01&date_to=2026-07-18",
      "https://ads.vk.com/api/v3/statistics/faststat/users.json",
    ]);
  });

  it("требует диапазон дат для дневной статистики", async () => {
    const client = new VkAdsClient({ tokenProvider: () => "test-token", timeoutMs: 1_000, fetchImplementation: fetch });
    await expect(client.getStatistics({ objectType: "campaigns", period: "day" })).rejects.toThrow("period=day");
  });

  it("не удаляет подписку, если её нет в свежем v3 списке", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "GET" });
        return new Response(JSON.stringify({ count: 0, offset: 0, items: [] }), { status: 200 });
      },
    });

    await expect(client.deleteSubscription(9)).rejects.toThrow("только для v3-подписки");
    expect(requests).toEqual([{ url: "https://ads.vk.com/api/v3/subscription.json?offset=0&limit=200", method: "GET" }]);
  });

  it("читает каталог packages без произвольного URL", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ items: [{ id: 10, objective: ["traffic"] }] }), { status: 200 });
      },
    });

    await expect(client.listPackages()).resolves.toEqual([{ id: 10, objective: ["traffic"] }]);
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/packages.json");
  });

  it("разрешает только известные detail, URL и remarketing read-пути", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        urls.push(String(url));
        if (String(url).includes("remarketing")) return new Response(JSON.stringify({ count: 0, offset: 0, items: [] }), { status: 200 });
        return new Response(JSON.stringify({ id: 42, name: "Object" }), { status: 200 });
      },
    });

    await expect(client.getBanner(42)).resolves.toMatchObject({ id: 42 });
    await expect(client.getUrl(43)).resolves.toMatchObject({ id: 42 });
    await expect(client.listRemarketingCounters()).resolves.toEqual([]);
    expect(urls).toEqual([
      "https://ads.vk.com/api/v2/banners/42.json",
      "https://ads.vk.com/api/v2/urls/43.json",
      "https://ads.vk.com/api/v2/remarketing/counters.json",
    ]);
  });

  it("читает подтверждённые справочники и лимиты только с фиксированного host", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        urls.push(String(url));
        if (String(url).includes("targetings_tree") || String(url).includes("throttling")) return new Response(JSON.stringify({ sample: {} }), { status: 200 });
        if (String(url).includes("banner_fields")) return new Response(JSON.stringify({ count: 0, offset: 0, items: [] }), { status: 200 });
        return new Response(JSON.stringify({ items: [{ id: 1 }] }), { status: 200 });
      },
    });

    await expect(client.getTargetingsTree()).resolves.toMatchObject({ sample: {} });
    await expect(client.listMobileTypes()).resolves.toEqual([{ id: 1 }]);
    await expect(client.listBannerPatterns()).resolves.toEqual([{ id: 1 }]);
    await expect(client.listBannerFormats()).resolves.toEqual([{ id: 1 }]);
    await expect(client.listBannerFieldDefinitions()).resolves.toEqual({ count: 0, offset: 0, items: [] });
    await expect(client.listPackagePads()).resolves.toEqual([{ id: 1 }]);
    await expect(client.getThrottling()).resolves.toMatchObject({ sample: {} });
    expect(urls).toEqual([
      "https://ads.vk.com/api/v2/targetings_tree.json",
      "https://ads.vk.com/api/v2/mobile_types.json",
      "https://ads.vk.com/api/v2/banner_patterns.json",
      "https://ads.vk.com/api/v2/banner_formats.json",
      "https://ads.vk.com/api/v2/banner_fields.json?offset=0&limit=100",
      "https://ads.vk.com/api/v2/packages_pads.json",
      "https://ads.vk.com/api/v2/throttling.json",
    ]);
  });

  it("читает in-app события только через фиксированную пагинацию", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ count: 0, offset: 5, items: [] }), { status: 200 });
      },
    });
    await expect(client.listInAppEvents(5, 10)).resolves.toEqual({ count: 0, offset: 5, items: [] });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/remarketing/inapp_events.json?offset=5&limit=10");
  });

  it("читает сегменты и локальные гео только через подтверждённые audience endpoints", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        urls.push(String(url));
        if (String(url).includes("relations")) return new Response(JSON.stringify({ items: [{ id: 3 }] }), { status: 200 });
        if (String(url).endsWith("/segments/1.json")) return new Response(JSON.stringify({ id: 1, name: "Segment" }), { status: 200 });
        if (String(url).includes("segments")) return new Response(JSON.stringify({ count: 1, offset: 4, items: [{ id: 1 }] }), { status: 200 });
        return new Response(JSON.stringify({ items: [{ id: 2 }] }), { status: 200 });
      },
    });
    await expect(client.listSegments(4, 10)).resolves.toEqual({ count: 1, offset: 4, items: [{ id: 1 }] });
    await expect(client.getSegment(1)).resolves.toEqual({ id: 1, name: "Segment" });
    await expect(client.listSegmentRelations(1)).resolves.toEqual([{ id: 3 }]);
    await expect(client.listLocalGeo()).resolves.toEqual([{ id: 2 }]);
    expect(urls).toEqual([
      "https://ads.vk.com/api/v2/remarketing/segments.json?offset=4&limit=10",
      "https://ads.vk.com/api/v2/remarketing/segments/1.json",
      "https://ads.vk.com/api/v2/remarketing/segments/1/relations.json",
      "https://ads.vk.com/api/v2/remarketing/local_geo.json",
    ]);
  });

  it("читает только paged metadata прайс-листов и v2/v3 списков ремаркетинга, включая v3 detail", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        const value = String(url);
        urls.push(value);
        if (value.includes("offline_goals")) return new Response(JSON.stringify({ items: [{ id: 1 }] }), { status: 200 });
        if (value.includes("pricelists")) return new Response(JSON.stringify({ count: 1, offset: 2, items: [{ id: 2 }] }), { status: 200 });
        if (value.includes("/api/v2/remarketing/users_lists.json")) return new Response(JSON.stringify({ count: 1, offset: 4, items: [{ id: 4, entries_count: 0 }] }), { status: 200 });
        if (value.endsWith("/remarketing/users_lists/3.json")) return new Response(JSON.stringify({ id: 3, name: "metadata only", entries_count: 0 }), { status: 200 });
        return new Response(JSON.stringify({ count: 1, offset: 3, items: [{ id: 3, entries_count: 0 }] }), { status: 200 });
      },
    });

    await expect(client.listOfflineGoals()).resolves.toEqual([{ id: 1 }]);
    await expect(client.listPricelists(2, 10)).resolves.toEqual({ count: 1, offset: 2, items: [{ id: 2 }] });
    await expect(client.listRemarketingUserLists(3, 10)).resolves.toEqual({ count: 1, offset: 3, items: [{ id: 3, entries_count: 0 }] });
    await expect(client.listRemarketingUserListsV2(4, 10)).resolves.toEqual({ count: 1, offset: 4, items: [{ id: 4, entries_count: 0 }] });
    await expect(client.getRemarketingUserListV3(3)).resolves.toEqual({ id: 3, name: "metadata only", entries_count: 0 });
    expect(urls).toEqual([
      "https://ads.vk.com/api/v2/remarketing/offline_goals.json",
      "https://ads.vk.com/api/v2/remarketing/pricelists.json?offset=2&limit=10",
      "https://ads.vk.com/api/v3/remarketing/users_lists.json?offset=3&limit=10",
      "https://ads.vk.com/api/v2/remarketing/users_lists.json?offset=4&limit=10",
      "https://ads.vk.com/api/v3/remarketing/users_lists/3.json",
    ]);
  });

  it("получает v1 технический URL ID только по публичному HTTPS-адресу", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ id: 42, url_types: ["external"], postback_trackers: ["private"] }), { status: 200 });
      },
    });

    await expect(client.resolveUrlIdV1("https://example.test/path?a=1")).resolves.toMatchObject({ id: 42 });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v1/urls/?url=https%3A%2F%2Fexample.test%2Fpath%3Fa%3D1");
    await expect(client.resolveUrlIdV1("http://example.test/")).rejects.toThrow("HTTPS");
  });

  it("создаёт пустой blocked test-прайслист без URL и credentials", async () => {
    let receivedUrl = "";
    let receivedBody = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        receivedBody = String(init?.body ?? "");
        return new Response(JSON.stringify({ id: 22 }), { status: 201 });
      },
    });

    await expect(client.createTestPricelist("__MCP_TEST__ empty catalogue")).resolves.toEqual({ id: 22 });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/remarketing/pricelists.json");
    expect(receivedBody).toBe(JSON.stringify({ name: "__MCP_TEST__ empty catalogue", status: "blocked", remove_utm_tags: true, source_type: "api" }));
  });

  it("читает цели счётчика только через документированный detail endpoint", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ items: [{ id: 8, name: "Покупка" }] }), { status: 200 });
      },
    });

    await expect(client.listRemarketingCounterGoals(7)).resolves.toEqual([{ id: 8, name: "Покупка" }]);
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/remarketing/counters/7/goals.json");
  });

  it("использует фиксированные v1, v2 и v3 контракты дополнительных read-only списков", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        const value = String(url);
        urls.push(value);
        if (value.includes("inapp_event_categories")) return new Response(JSON.stringify({ count: 1, items: [{ id: 1, name: "Category" }] }), { status: 200 });
        if (value.includes("mobile_app_users")) return new Response(JSON.stringify({ count: 1, offset: 3, items: [{ app_name: "com.example.app", users: [{ email: "private@example.test" }] }] }), { status: 200 });
        if (value.includes("lead_forms")) return new Response(JSON.stringify({ count: 1, offset: 2, items: [{ id: 2 }] }), { status: 200 });
        if (value.includes("survey_forms")) return new Response(JSON.stringify({ count: 1, offset: 6, items: [{ id: 6 }] }), { status: 200 });
        if (value.includes("search_phrases")) return new Response(JSON.stringify({ items: [{ id: 3 }] }), { status: 200 });
        if (value.includes("subscription")) return new Response(JSON.stringify({ count: 1, offset: 4, items: [{ id: 4 }] }), { status: 200 });
        return new Response(JSON.stringify({ count: 1, offset: 5, items: [{ id: 5 }] }), { status: 200 });
      },
    });

    await expect(client.listInAppEventCategories()).resolves.toEqual([{ id: 1, name: "Category" }]);
    await expect(client.listMobileAppUsers(3, 10)).resolves.toEqual({ count: 1, offset: 3, items: [{ app_name: "com.example.app", users: [{ email: "private@example.test" }] }] });
    await expect(client.listLeadForms(2, 10)).resolves.toEqual({ count: 1, offset: 2, items: [{ id: 2 }] });
    await expect(client.listSurveyForms(6, 10)).resolves.toEqual({ count: 1, offset: 6, items: [{ id: 6 }] });
    await expect(client.listSearchPhrases()).resolves.toEqual([{ id: 3 }]);
    await expect(client.listSubscriptions(4, 10)).resolves.toEqual({ count: 1, offset: 4, items: [{ id: 4 }] });
    await expect(client.listTransactionGroups(5, 10)).resolves.toEqual({ count: 1, offset: 5, items: [{ id: 5 }] });
    expect(urls).toEqual([
      "https://ads.vk.com/api/v1/inapp_event_categories.json",
      "https://ads.vk.com/api/v1/mobile_app_users.json?offset=3&limit=10",
      "https://ads.vk.com/api/v1/lead_ads/lead_forms.json?offset=2&limit=10",
      "https://ads.vk.com/api/v1/lead_ads/survey_forms.json?offset=6&limit=10",
      "https://ads.vk.com/api/v3/search_phrases.json",
      "https://ads.vk.com/api/v3/subscription.json?offset=4&limit=10",
      "https://ads.vk.com/api/v2/billing/transaction_groups.json?offset=5&limit=10",
    ]);
  });

  it("читает лиды только через фиксированный v1 endpoint с allowlist-фильтрами", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ count: 1, offset: 0, items: [{ id: 1, phone: "+79990000000" }] }), { status: 200 });
      },
    });

    await expect(client.listLeads(0, 10, { formIds: [7], createdAtGte: "2026-07-01 00:00:00" })).resolves.toMatchObject({ count: 1 });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v1/lead_ads/leads.json?offset=0&limit=10&_form_ids__in=7&_created_at__gte=2026-07-01+00%3A00%3A00");
  });

  it("читает респондентов только через фиксированный v1 endpoint с allowlist-фильтрами", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ count: 1, offset: 0, items: [{ id: 2, email: "private@example.test" }] }), { status: 200 });
      },
    });

    await expect(client.listRespondents(0, 10, { formIds: [7], createdAtLte: "2026-07-20 12:00:00" })).resolves.toMatchObject({ count: 1 });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v1/lead_ads/respondents.json?offset=0&limit=10&_form_ids__in=7&_created_at__lte=2026-07-20+12%3A00%3A00");
  });

  it("использует только разрешённые detail-пути лид- и опросных форм", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ id: 7, name: "Форма" }), { status: 200 });
      },
    });

    await expect(client.getLeadFormDetail(7)).resolves.toMatchObject({ id: 7 });
    await expect(client.getSurveyFormDetail(8)).resolves.toMatchObject({ id: 7 });
    expect(urls).toEqual([
      "https://ads.vk.com/api/v1/lead_ads/lead_forms/7.json",
      "https://ads.vk.com/api/v1/lead_ads/survey_forms/8.json",
    ]);
  });

  it("копирует только test-лид-форму или test-опрос через фиксированный v1 POST", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        const value = String(url);
        requests.push({ url: value, method: init?.method ?? "GET", body: String(init?.body ?? "") });
        if (init?.method === "POST") return new Response(JSON.stringify({ id: 9, name: "__MCP_TEST__ copy" }), { status: 200 });
        return new Response(JSON.stringify({ id: 7, name: "__MCP_TEST__ source" }), { status: 200 });
      },
    });

    await expect(client.copyTestLeadForm(7, "__MCP_TEST__ lead copy")).resolves.toMatchObject({ id: 9 });
    await expect(client.copyTestSurveyForm(8, "__MCP_TEST__ survey copy")).resolves.toMatchObject({ id: 9 });
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v1/lead_ads/lead_forms/7.json", method: "GET", body: "" },
      { url: "https://ads.vk.com/api/v1/lead_ads/lead_forms/7/copy", method: "POST", body: '{"name":"__MCP_TEST__ lead copy"}' },
      { url: "https://ads.vk.com/api/v1/lead_ads/survey_forms/8.json", method: "GET", body: "" },
      { url: "https://ads.vk.com/api/v1/lead_ads/survey_forms/8/copy", method: "POST", body: '{"name":"__MCP_TEST__ survey copy"}' },
    ]);
  });

  it("не копирует форму без test-префикса", async () => {
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async () => new Response(JSON.stringify({ id: 7, name: "Рабочая форма" }), { status: 200 }),
    });
    await expect(client.copyTestLeadForm(7, "__MCP_TEST__ copy")).rejects.toThrow("__MCP_TEST__");
  });

  it("переименовывает только test-лид-форму фиксированным v1 POST без замены секций", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
        if (init?.method === "POST") return new Response(JSON.stringify({ id: 7, name: "__MCP_TEST__ renamed" }), { status: 200 });
        return new Response(JSON.stringify({ id: 7, name: "__MCP_TEST__ source", contact_fields: ["phone"] }), { status: 200 });
      },
    });

    await expect(client.renameTestLeadForm(7, "__MCP_TEST__ renamed")).resolves.toMatchObject({ id: 7, name: "__MCP_TEST__ renamed" });
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v1/lead_ads/lead_forms/7.json", method: "GET", body: "" },
      { url: "https://ads.vk.com/api/v1/lead_ads/lead_forms/7.json", method: "POST", body: '{"name":"__MCP_TEST__ renamed"}' },
    ]);
  });

  it("изменяет только категорию одного in-app события по документированному v2 пути", async () => {
    let receivedUrl = "";
    let receivedBody = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        receivedBody = String(init?.body ?? "");
        return new Response(null, { status: 204 });
      },
    });

    await expect(client.updateInAppEventCategory({ appId: 65, trackerId: 1, eventId: 7, categoryId: 2 })).resolves.toBeUndefined();
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/remarketing/inapp_events/65/trackers/1/events/7.json");
    expect(receivedBody).toBe('{"inapp_event_category_id":2}');
  });

  it("архивирует только test-формы фиксированным batch-контрактом", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        urls.push(`${init?.method ?? "GET"} ${String(url)}`);
        if (init?.method === "POST") return new Response(JSON.stringify([{ id: 7, status: 2 }]), { status: 200 });
        return new Response(JSON.stringify({ id: 7, name: "__MCP_TEST__ source" }), { status: 200 });
      },
    });
    await expect(client.archiveTestLeadForms([7], "archive")).resolves.toEqual([{ id: 7, status: 2 }]);
    expect(urls).toEqual([
      "GET https://ads.vk.com/api/v1/lead_ads/lead_forms/7.json",
      "POST https://ads.vk.com/api/v1/lead_ads/lead_forms/archive?_form_ids__in=7",
    ]);
  });

  it("создаёт batch-задачу offer только в обнаруженном test-прайс-листе", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
        if (init?.method === "POST") return new Response(JSON.stringify([{ task_id: 9 }]), { status: 200 });
        return new Response(JSON.stringify({ count: 1, offset: 0, items: [{ id: 7, name: "__MCP_TEST__ price list" }] }), { status: 200 });
      },
    });

    await expect(client.createTestPricelistBatchTask({ pricelistId: 7, offerId: "offer-1", productType: "product", title: "Тестовый товар", link: "https://example.test/item", imageLink: "https://example.test/image.png", price: "100.00 RUB" })).resolves.toEqual([{ task_id: 9 }]);
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/remarketing/pricelists.json?offset=0&limit=50", method: "GET", body: "" },
      { url: "https://ads.vk.com/api/v2/remarketing/pricelists/7/batch.json", method: "POST", body: '[{"method":"PUT","data":{"id":"offer-1","product_type":"product","title":"Тестовый товар","link":"https://example.test/item","image_link":"https://example.test/image.png","price":"100.00 RUB"}}]' },
    ]);
  });

  it("экспортирует лиды только через фиксированный form endpoint", async () => {
    let receivedUrl = "";
    let receivedAccept = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        receivedAccept = new Headers(init?.headers).get("accept") ?? "";
        return new Response("id,name\n1,Test\n", { status: 200, headers: { "content-type": "text/csv", "content-length": "15" } });
      },
    });

    const exported = await client.exportLeadFormLeads({ formId: 7, format: "csv", bannerIds: [8], createdAtLte: "2026-07-20 12:00:00" });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v1/lead_ads/lead_forms/7/leads.csv?_banner_id__in=8&_created_at__lte=2026-07-20+12%3A00%3A00");
    expect(receivedAccept).toBe("text/csv");
    expect(new TextDecoder().decode(exported.bytes)).toBe("id,name\n1,Test\n");
  });

  it("экспортирует ответы опроса только через фиксированный XLSX endpoint", async () => {
    let receivedUrl = "";
    let receivedAccept = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        receivedAccept = new Headers(init?.headers).get("accept") ?? "";
        return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-length": "3" } });
      },
    });

    const exported = await client.exportSurveyFormRespondents(7);
    expect(receivedUrl).toBe("https://ads.vk.com/api/v1/lead_ads/survey_forms/7/respondents.xlsx");
    expect(receivedAccept).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect([...exported.bytes]).toEqual([1, 2, 3]);
  });

  it("загружает logo лид-формы только в фиксированный v1 endpoint", async () => {
    let receivedUrl = "";
    let receivedMethod = "";
    let receivedFileType = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        receivedMethod = init?.method ?? "GET";
        const form = init?.body as FormData;
        const file = form.get("file") as File;
        receivedFileType = file.type;
        return new Response(JSON.stringify({ id: 12 }), { status: 200 });
      },
    });

    await expect(client.uploadLeadFormLogo({ filename: "logo.png", mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) })).resolves.toEqual({ id: 12 });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v1/lead_ads/upload_image/logo");
    expect(receivedMethod).toBe("POST");
    expect(receivedFileType).toBe("image/png");
  });

  it("запрашивает ОРД-акты партнёра только с первым днём месяца и фиксированным ID площадки", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ id: 42, contracts: [{ number: "private" }] }), { status: 200 });
      },
    });

    await expect(client.listOrdPartnerActs("2026-07-01")).resolves.toMatchObject({ id: 42 });
    await expect(client.getOrdPartnerActStatByPad("2026-07-01", 7)).resolves.toMatchObject({ id: 42 });
    expect(urls).toEqual([
      "https://ads.vk.com/api/v1/ord/partner/acts/2026-07-01.json",
      "https://ads.vk.com/api/v1/ord/partner/acts/2026-07-01/7.json",
    ]);
    await expect(client.listOrdPartnerActs("2026-07")).rejects.toThrow("YYYY-MM-01");
  });

  it("запрашивает ОРД-акты и статусы агентства только с обязательным месяцем", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ count: 0, offset: 0, items: [] }), { status: 200 });
      },
    });

    await client.listOrdAgencyActs("2026-07-01", 10, 20);
    await client.getOrdAgencyClientActs(7, "2026-07-01");
    await client.listOrdAgencyReports("2026-07-01");
    await client.listOrdAgencyStatus("2026-07-01", 0, 50);
    expect(urls).toEqual([
      "https://ads.vk.com/api/v2/ord/agency/acts.json?offset=10&limit=20&_month=2026-07-01",
      "https://ads.vk.com/api/v2/ord/agency/7/acts.json?offset=0&limit=100&_month=2026-07-01",
      "https://ads.vk.com/api/v2/ord/agency/report.json?offset=0&limit=100&_month=2026-07-01",
      "https://ads.vk.com/api/v2/ord/agency/status.json?offset=0&limit=50&_month=2026-07-01",
    ]);
    await expect(client.listOrdAgencyActs("2026-07", 0, 20)).rejects.toThrow("YYYY-MM-01");
  });

  it("строит прогноз только по фиксированному v3 endpoint и валидирует источник прогноза", async () => {
    let request: RequestInit | undefined;
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        request = init;
        return new Response(JSON.stringify({ cr_ctr: [], histograms: [] }), { status: 200 });
      },
    });

    await expect(client.getReachForecast({ packageIds: [2860], targetings: { pads: [2064426], age: [25, 26] } })).resolves.toEqual({ cr_ctr: [], histograms: [] });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v3/projection.json");
    expect(request).toMatchObject({ method: "POST", headers: expect.objectContaining({ "Content-Type": "application/json" }) });
    expect(JSON.parse(String(request?.body))).toEqual({ package_ids: [2860], targetings: { pads: [2064426], age: [25, 26] } });
    await expect(client.getReachForecast({ packageIds: [1], campaignId: 2, targetings: { pads: [1] } })).rejects.toThrow("packageIds или campaignId");
  });

  it("проверяет audit pixel только через фиксированный v3 endpoint", async () => {
    let receivedUrl = "";
    let request: RequestInit | undefined;
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        request = init;
        return new Response(JSON.stringify({ audit_pixel: "https://example.test/pixel", generated_audit_pixels: [] }), { status: 200 });
      },
    });
    await expect(client.checkAuditPixel("https://example.test/pixel")).resolves.toMatchObject({ generated_audit_pixels: [] });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v3/audit_pixel.json?fields=audit_pixel%2Cgenerated_audit_pixels");
    expect(request).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(request?.body))).toEqual({ audit_pixel: "https://example.test/pixel" });
    await expect(client.checkAuditPixel("http://example.test/pixel")).rejects.toThrow("Разрешён только абсолютный HTTPS URL");
  });

  it("читает несколько зарегистрированных URL только по списку положительных ID", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ items: [{ id: 10 }, { id: 20 }] }), { status: 200 });
      },
    });
    await expect(client.getUrls([10, 20])).resolves.toEqual([{ id: 10 }, { id: 20 }]);
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/urls/10,20.json");
    await expect(client.getUrls([10])).rejects.toThrow("от 2 до 50 ID");
    await expect(client.getUrls([10, 0])).rejects.toThrow("ID должен быть положительным");
  });

  it("читает iOS и Android приложения только через allowlist путей", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ id: 1, name: "Application" }), { status: 200 });
      },
    });
    await expect(client.getMobileApp({ platform: "ios", appId: 535176909 })).resolves.toMatchObject({ id: 1 });
    await expect(client.getMobileApp({ platform: "android", packageName: "com.bscotch.quadropus" })).resolves.toMatchObject({ id: 1 });
    expect(urls).toEqual([
      "https://ads.vk.com/api/v2/apple_apps/535176909.json",
      "https://ads.vk.com/api/v2/google_apps/com.bscotch.quadropus.json",
    ]);
    await expect(client.getMobileApp({ platform: "android", packageName: "../secrets" })).rejects.toThrow("недопустимые символы");
  });

  it("читает статистику целей только для banners/day с обязательными датами", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ items: [{ id: 10, rows: [] }], total: { goals: [] } }), { status: 200 });
      },
    });
    await expect(client.getGoalStatistics({ objectType: "ad_plans", ids: [10, 20], dateFrom: "2026-07-01", dateTo: "2026-07-19" })).resolves.toMatchObject({ total: { goals: [] } });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/statistics/goals/ad_plans/day.json?id=10%2C20&date_from=2026-07-01&date_to=2026-07-19");
    await expect(client.getGoalStatistics({ objectType: "banners", ids: [], dateFrom: "2026-07-01", dateTo: "2026-07-19" })).rejects.toThrow("от 1 до 50 ID");
  });

  it("нормализует нестандартную пагинацию регионов и каталог целей", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        urls.push(String(url));
        if (String(url).includes("regions")) return new Response(JSON.stringify({ count: 2, limit: 1, items: [{ id: 1, name: "Москва" }] }), { status: 200 });
        return new Response(JSON.stringify({ topmailru: [{ id: 1, name: "Goal" }] }), { status: 200 });
      },
    });

    await expect(client.listRegions(2, 1)).resolves.toEqual({ count: 2, offset: 2, items: [{ id: 1, name: "Москва" }] });
    await expect(client.listRegions(0, 10, { query: "Сочи", parentIds: [-1], flags: ["geo_tree_extended", "rb_active"] })).resolves.toEqual({ count: 2, offset: 0, items: [{ id: 1, name: "Москва" }] });
    await expect(client.getGoals()).resolves.toMatchObject({ topmailru: [{ id: 1 }] });
    expect(urls).toEqual([
      "https://ads.vk.com/api/v2/regions.json?fields=id%2Cname%2Ctype&offset=2&limit=1",
      "https://ads.vk.com/api/v2/regions.json?fields=id%2Cname%2Ctype&offset=0&limit=10&_q=%D0%A1%D0%BE%D1%87%D0%B8&_parent_id__in=-1&_flags__in=geo_tree_extended%2Crb_active",
      "https://ads.vk.com/api/v2/goals.json",
    ]);
  });

  it("направляет agency и manager clients только на фиксированные v2/v3 endpoint", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ items: [{ id: 1 }] }), { status: 200 });
      },
    });
    await expect(client.listAgencyClients()).resolves.toEqual([{ id: 1 }]);
    await expect(client.listManagerClients()).resolves.toEqual([{ id: 1 }]);
    expect(urls).toEqual([
      "https://ads.vk.com/api/v2/agency/clients.json",
      "https://ads.vk.com/api/v3/manager/clients.json",
    ]);
  });

  it("преобразует HTTP ошибку в безопасную ошибку без тела ответа", async () => {
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async () => new Response(JSON.stringify({ access_token: "must-not-leak" }), { status: 401 }),
    });

    await expect(client.getUser()).rejects.toEqual(expect.objectContaining<VkAdsApiError>({ status: 401, message: "VK Ads API вернул HTTP 401." }));
  });

  it("выводит для write validation только код и имена полей", async () => {
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async () => new Response(JSON.stringify({ error: { code: "validation_failed", message: "private@example.test", fields: { goal_id: { message: "secret" }, counter_id: { message: "secret" } } } }), { status: 400 }),
    });

    await expect(client.createTestSegment({ name: "__MCP_TEST__ segment", counterId: 20, leftDays: 365, goalId: "uss" })).rejects.toEqual(expect.objectContaining<VkAdsApiError>({
      status: 400,
      message: "VK Ads API вернул HTTP 400. Диагностика: validation_failed; поля: goal_id, counter_id.",
    }));
  });

  it("один раз обновляет токен и повторяет только read-запрос", async () => {
    const authorizations: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "expired-token",
      tokenRefresher: async () => "fresh-token",
      timeoutMs: 1_000,
      fetchImplementation: async (_url, init) => {
        authorizations.push(new Headers(init?.headers).get("authorization") ?? "");
        if (authorizations.length === 1) return new Response("", { status: 401 });
        return new Response(JSON.stringify({ id: 42, currency: "RUB" }), { status: 200 });
      },
    });

    await expect(client.getUser()).resolves.toEqual({ id: 42, currency: "RUB" });
    expect(authorizations).toEqual(["Bearer expired-token", "Bearer fresh-token"]);
  });

  it("читает профиль через фиксированный v3 endpoint", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ id: 42, status: "active" }), { status: 200 });
      },
    });

    await expect(client.getUserV3()).resolves.toEqual({ id: 42, status: "active" });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v3/user.json");
  });

  it("повторяет read один раз после 429 с ограниченной паузой Retry-After", async () => {
    let calls = 0;
    const delays: number[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      sleep: async (milliseconds) => { delays.push(milliseconds); },
      fetchImplementation: async () => {
        calls += 1;
        if (calls === 1) return new Response("", { status: 429, headers: { "Retry-After": "3" } });
        return new Response(JSON.stringify({ id: 42 }), { status: 200 });
      },
    });

    await expect(client.getUser()).resolves.toEqual({ id: 42 });
    expect(calls).toBe(2);
    expect(delays).toEqual([3_000]);
  });

  it("получает первый токен через refresher, если токен ещё не передан", async () => {
    let authorization = "";
    const client = new VkAdsClient({
      tokenProvider: () => "",
      tokenRefresher: async () => "fresh-token",
      timeoutMs: 1_000,
      fetchImplementation: async (_url, init) => {
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return new Response(JSON.stringify({ id: 42 }), { status: 200 });
      },
    });

    await expect(client.getUser()).resolves.toEqual({ id: 42 });
    expect(authorization).toBe("Bearer fresh-token");
  });

  it("создаёт только остановленный изолированный test ad plan через фиксированный POST", async () => {
    let receivedUrl = "";
    let receivedMethod = "";
    let receivedBody = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        receivedMethod = init?.method ?? "";
        receivedBody = String(init?.body);
        return new Response(JSON.stringify({ id: 9, campaigns: [{ id: 10 }] }), { status: 200 });
      },
    });

    await expect(client.createTestAdPlan({ name: "__MCP_TEST__ contract", objective: "traffic", packageId: 11 })).resolves.toMatchObject({ id: 9 });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/ad_plans.json");
    expect(receivedMethod).toBe("POST");
    expect(JSON.parse(receivedBody)).toEqual({
      name: "__MCP_TEST__ contract",
      objective: "traffic",
      status: "blocked",
      campaigns: [{ name: "__MCP_TEST__ contract — campaign", package_id: 11, objective: "traffic", status: "blocked" }],
    });
  });

  it("создаёт test-сегмент только с фиксированной связью со счётчиком", async () => {
    let receivedUrl = "";
    let receivedBody = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        receivedBody = String(init?.body);
        return new Response(JSON.stringify({ id: 33 }), { status: 200 });
      },
    });

    await expect(client.createTestSegment({ name: "__MCP_TEST__ segment", counterId: 20, leftDays: 365, goalId: "uss" })).resolves.toEqual({ id: 33 });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/remarketing/segments.json");
    expect(JSON.parse(receivedBody)).toEqual({
      name: "__MCP_TEST__ segment",
      pass_condition: 1,
      relations: [{ object_type: "remarketing_counter", params: { source_id: 20, goal_id: "uss", left: 365, right: 0, type: "positive" } }],
    });
    await expect(client.createTestSegment({ name: "ordinary", counterId: 20, leftDays: 365, goalId: "uss" })).rejects.toThrow("__MCP_TEST__");
  });


  it("изменяет и удаляет только test-сегмент по фиксированным endpoint", async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        calls.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        if (init?.method === "POST") return new Response(JSON.stringify({ id: 33 }), { status: 200 });
        return new Response(JSON.stringify({ id: 33, name: "__MCP_TEST__ segment" }), { status: 200 });
      },
    });

    await client.renameTestSegment(33, "__MCP_TEST__ renamed");
    await client.deleteTestSegment(33);
    expect(calls).toEqual([
      { url: "https://ads.vk.com/api/v2/remarketing/segments/33.json", method: "GET", body: "" },
      { url: "https://ads.vk.com/api/v2/remarketing/segments/33.json", method: "POST", body: '{"name":"__MCP_TEST__ renamed"}' },
      { url: "https://ads.vk.com/api/v2/remarketing/segments/33.json", method: "GET", body: "" },
      { url: "https://ads.vk.com/api/v2/remarketing/segments/33.json", method: "DELETE", body: "" },
    ]);
  });

  it("управляет связями только между test-сегментами", async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        const urlText = String(url);
        calls.push({ url: urlText, method: init?.method ?? "GET", body: String(init?.body ?? "") });
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        if (init?.method === "POST") return new Response(JSON.stringify({ items: [{ id: 77 }] }), { status: 200 });
        if (urlText.includes("/relations.json")) return new Response(JSON.stringify({ items: [{ id: 77 }] }), { status: 200 });
        return new Response(JSON.stringify({ id: 33, name: "__MCP_TEST__ segment" }), { status: 200 });
      },
    });

    await client.addTestSegmentRelation({ segmentId: 33, nestedSegmentId: 34 });
    await client.deleteTestSegmentRelation({ segmentId: 33, relationId: 77 });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toContain("POST https://ads.vk.com/api/v2/remarketing/segments/33/relations.json");
    expect(calls.map((call) => `${call.method} ${call.url}`)).toContain("DELETE https://ads.vk.com/api/v2/remarketing/segments/33/relations/77.json");
  });

  it("изменяет params только связи между двумя test-сегментами", async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        const call = { url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") };
        calls.push(call);
        if (call.method === "POST") return new Response(JSON.stringify({ id: 77, object_id: 34, object_type: "segment" }), { status: 200 });
        if (call.url.includes("/relations.json")) return new Response(JSON.stringify({ items: [{ id: 77, object_id: 34, object_type: "segment" }] }), { status: 200 });
        if (call.url.endsWith("/segments/33.json")) return new Response(JSON.stringify({ id: 33, name: "__MCP_TEST__ parent" }), { status: 200 });
        return new Response(JSON.stringify({ id: 34, name: "__MCP_TEST__ nested" }), { status: 200 });
      },
    });

    await expect(client.updateTestSegmentRelation({ segmentId: 33, relationId: 77, left: 30, right: 1, type: "negative" })).resolves.toMatchObject({ id: 77 });
    expect(calls.at(-1)).toEqual({ url: "https://ads.vk.com/api/v2/remarketing/segments/33/relations/77.json", method: "POST", body: JSON.stringify({ params: { left: 30, right: 1, type: "negative" } }) });
  });

  it("не отправляет remoderation, пока VK не разрешил её test-banner", async () => {
    const methods: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (_url, init) => {
        methods.push(init?.method ?? "GET");
        return new Response(JSON.stringify({ id: 44, name: "__MCP_TEST__ banner", user_can_request_remoderation: false }), { status: 200 });
      },
    });

    await expect(client.remoderateTestBanners([44])).resolves.toMatchObject({ requested: false, results: [{ id: 44, remoderated: false }] });
    expect(methods).not.toContain("POST");
  });

  it("отправляет remoderation только на фиксированный endpoint для test-banner", async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        calls.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
        if (init?.method === "POST") return new Response(JSON.stringify({ id: 44, remoderated: true }), { status: 200 });
        return new Response(JSON.stringify({ id: 44, name: "__MCP_TEST__ banner", user_can_request_remoderation: true }), { status: 200 });
      },
    });

    await expect(client.remoderateTestBanners([44])).resolves.toEqual({ id: 44, remoderated: true });
    expect(calls.at(-1)).toEqual({
      url: "https://ads.vk.com/api/v2/banners/remoderate.json?fields=id%2Cremoderated",
      method: "POST",
      body: '{"banners":[{"id":44}]}',
    });
  });

  it("обновляет токен и повторяет write после 401", async () => {
    const authorizations: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "expired-token",
      tokenRefresher: async () => "fresh-token",
      timeoutMs: 1_000,
      fetchImplementation: async (_url, init) => {
        authorizations.push(new Headers(init?.headers).get("authorization") ?? "");
        if (authorizations.length === 1) return new Response("", { status: 401 });
        return new Response(JSON.stringify({ id: 5 }), { status: 200 });
      },
    });

    await expect(client.createUrl("https://example.test/landing")).resolves.toEqual({ id: 5 });
    expect(authorizations).toEqual(["Bearer expired-token", "Bearer fresh-token"]);
  });

  it("массово блокирует только test ad plans через фиксированный mass-action endpoint", async () => {
    const urls: string[] = [];
    const bodies: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        urls.push(String(url));
        if (init?.method === "POST") {
          bodies.push(String(init.body));
          return new Response(null, { status: 204 });
        }
        const id = Number(String(url).match(/ad_plans\/(\d+)/)?.[1]);
        return new Response(JSON.stringify({ id, name: `__MCP_TEST__ ${id}` }), { status: 200 });
      },
    });

    await expect(client.blockTestAdPlans([10, 20])).resolves.toEqual({ ids: [10, 20], status: "blocked" });
    expect(urls).toEqual([
      "https://ads.vk.com/api/v2/ad_plans/10.json",
      "https://ads.vk.com/api/v2/ad_plans/20.json",
      "https://ads.vk.com/api/v2/ad_plans/mass_action.json",
    ]);
    expect(JSON.parse(bodies[0] ?? "")).toEqual([{ id: 10, status: "blocked" }, { id: 20, status: "blocked" }]);
  });

  it("массово блокирует только test ad groups через фиксированный mass-action endpoint", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        urls.push(String(url));
        if (init?.method === "POST") {
          expect(JSON.parse(String(init.body))).toEqual([{ id: 10, status: "blocked" }]);
          return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify({ id: 10, name: "__MCP_TEST__ group" }), { status: 200 });
      },
    });
    await expect(client.blockTestAdGroups([10])).resolves.toEqual({ ids: [10], status: "blocked" });
    expect(urls).toEqual([
      "https://ads.vk.com/api/v2/ad_groups/10.json",
      "https://ads.vk.com/api/v2/ad_groups/mass_action.json",
    ]);
  });

  it("массово блокирует только test banners через документированный mass-action endpoint", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        urls.push(String(url));
        if (init?.method === "POST") {
          expect(JSON.parse(String(init.body))).toEqual([{ id: 10, status: "blocked" }]);
          return new Response(null, { status: 204 });
        }
        return new Response(JSON.stringify({ id: 10, name: "__MCP_TEST__ banner" }), { status: 200 });
      },
    });

    await expect(client.blockTestBanners([10])).resolves.toEqual({ ids: [10], status: "blocked" });
    expect(urls).toEqual([
      "https://ads.vk.com/api/v2/banners/10.json",
      "https://ads.vk.com/api/v2/banners/mass_action.json",
    ]);
  });

  it("не доверяет detail banner без имени и перечитывает только его test group", async () => {
    const urls: string[] = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        urls.push(String(url));
        if (init?.method === "POST") return new Response(null, { status: 204 });
        if (String(url).includes("/banners/10.json")) return new Response(JSON.stringify({ id: 10, ad_group_id: 20 }), { status: 200 });
        return new Response(JSON.stringify({ count: 1, offset: 0, items: [{ id: 10, name: "__MCP_TEST__ banner" }] }), { status: 200 });
      },
    });

    await expect(client.blockTestBanners([10])).resolves.toEqual({ ids: [10], status: "blocked" });
    expect(urls).toEqual([
      "https://ads.vk.com/api/v2/banners/10.json",
      "https://ads.vk.com/api/v2/banners.json?offset=0&limit=20&_ad_group_id__in=20&fields=id%2Cname",
      "https://ads.vk.com/api/v2/banners/mass_action.json",
    ]);
  });

  it("загружает изображение только в фиксированный content/static endpoint", async () => {
    let receivedUrl = "";
    let receivedMethod = "";
    let fileName = "";
    let fileType = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        receivedMethod = init?.method ?? "";
        const form = init?.body as FormData;
        const file = form.get("file") as File;
        fileName = file.name;
        fileType = file.type;
        return new Response(JSON.stringify({ id: 1, variants: [] }), { status: 200 });
      },
    });

    await expect(client.uploadStaticImage({ filename: "creative.png", mimeType: "image/png", bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]) })).resolves.toMatchObject({ id: 1 });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/content/static.json");
    expect(receivedMethod).toBe("POST");
    expect(fileName).toBe("creative.png");
    expect(fileType).toBe("image/png");
  });

  it("загружает MP4 только в фиксированный content/video endpoint с размерами", async () => {
    let receivedUrl = "";
    let receivedData = "";
    let fileName = "";
    let fileType = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        const form = init?.body as FormData;
        const file = form.get("file") as File;
        fileName = file.name;
        fileType = file.type;
        receivedData = String(form.get("data"));
        return new Response(JSON.stringify({ id: 2, variants: [] }), { status: 200 });
      },
    });

    await expect(client.uploadVideo({ filename: "creative.mp4", mimeType: "video/mp4", bytes: new Uint8Array([0, 0, 0, 24]), width: 320, height: 180 })).resolves.toMatchObject({ id: 2 });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/content/video.json");
    expect(fileName).toBe("creative.mp4");
    expect(fileType).toBe("video/mp4");
    expect(JSON.parse(receivedData)).toEqual({ width: 320, height: 180 });
    await expect(client.uploadVideo({ filename: "creative.mp4", mimeType: "video/mp4", bytes: new Uint8Array([1]), width: 0, height: 180 })).rejects.toThrow("width");
  });

  it("загружает HTML5 только в фиксированный content/html5 endpoint", async () => {
    let receivedUrl = "";
    let fileName = "";
    let fileType = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        const form = init?.body as FormData;
        const file = form.get("file") as File;
        fileName = file.name;
        fileType = file.type;
        return new Response(JSON.stringify({ id: 3 }), { status: 201 });
      },
    });

    await expect(client.uploadHtml5({ filename: "creative.zip", bytes: new Uint8Array([1, 2, 3]) })).resolves.toMatchObject({ id: 3 });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/content/html5.json");
    expect(fileName).toBe("creative.zip");
    expect(fileType).toBe("application/zip");
  });

  it("регистрирует только HTTPS URL через фиксированный endpoint", async () => {
    let receivedUrl = "";
    let receivedBody = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        receivedBody = String(init?.body);
        return new Response(JSON.stringify({ id: 12 }), { status: 201 });
      },
    });

    await expect(client.createUrl("https://example.com/path")).resolves.toEqual({ id: 12 });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/urls.json");
    expect(JSON.parse(receivedBody)).toEqual({ url: "https://example.com/path" });
    await expect(client.createUrl("http://example.com")).rejects.toThrow("HTTPS");
    await expect(client.createUrl("https://user:password@example.com")).rejects.toThrow("логина");
    await expect(client.createUrl("https://127.0.0.1/")).rejects.toThrow("публичный домен");
  });

  it("выполняет production CRUD ad plan без test-prefix и с фиксированными URL/payload", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
        if (init?.method === "GET") return new Response(JSON.stringify({ id: 42, name: "Production plan" }), { status: 200 });
        return new Response(JSON.stringify({ id: 42, name: "Production plan", status: "blocked" }), { status: 200 });
      },
    });

    await expect(client.createAdPlan({ name: "Production plan", objective: "traffic", status: "blocked" })).resolves.toMatchObject({ id: 42 });
    await expect(client.updateAdPlan(42, { name: "Production plan renamed", budget_limit_day: 1500 })).resolves.toMatchObject({ id: 42 });
    await expect(client.deleteAdPlan(42)).resolves.toMatchObject({ id: 42 });
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/ad_plans.json", method: "POST", body: '{"name":"Production plan","objective":"traffic","status":"blocked"}' },
      { url: "https://ads.vk.com/api/v2/ad_plans/42.json", method: "GET", body: "" },
      { url: "https://ads.vk.com/api/v2/ad_plans/42.json", method: "POST", body: '{"name":"Production plan renamed","budget_limit_day":1500}' },
      { url: "https://ads.vk.com/api/v2/ad_plans/42.json", method: "GET", body: "" },
      { url: "https://ads.vk.com/api/v2/ad_plans/42.json", method: "POST", body: '{"status":"deleted"}' },
    ]);
  });

  it("читает currencies через фиксированный справочный endpoint", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ items: [{ name: "RUB" }] }), { status: 200 });
      },
    });
    await expect(client.listCurrencies()).resolves.toEqual([{ name: "RUB" }]);
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/currencies.json");
  });

  it("отправляет production mass-action с документированным статусом", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
        if (init?.method === "GET") return new Response(JSON.stringify({ id: 7, name: "Production object" }), { status: 200 });
        return new Response(null, { status: 204 });
      },
    });

    await expect(client.manageBanners([{ id: 7, status: "blocked" }])).resolves.toEqual({ items: [{ id: 7, status: "blocked" }] });
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/banners/7.json", method: "GET", body: "" },
      { url: "https://ads.vk.com/api/v2/banners/mass_action.json", method: "POST", body: '[{"id":7,"status":"blocked"}]' },
    ]);
  });

  it("создаёт только остановленный test banner проверенного pattern 284", async () => {
    const requests: Array<{ url: string; method: string; body: string | undefined }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "", body: typeof init?.body === "string" ? init.body : undefined });
        if ((init?.method ?? "") === "GET") return new Response(JSON.stringify({ id: 10, name: "__MCP_TEST__ group", package_id: 2860 }), { status: 200 });
        return new Response(JSON.stringify({ id: 15 }), { status: 200 });
      },
    });

    await expect(client.createTestBanner({
      adGroupId: 10, name: "__MCP_TEST__ banner", primaryUrlId: 11, landscapeImageId: 12, iconImageId: 13,
      title: "Тест", text: "Тестовый текст", cta: "install",
    })).resolves.toEqual({ id: 15 });
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/ad_groups/10.json", method: "GET", body: undefined },
      { url: "https://ads.vk.com/api/v2/urls/11.json", method: "GET", body: undefined },
      { url: "https://ads.vk.com/api/v2/ad_groups/10/banners.json", method: "POST", body: JSON.stringify({
        name: "__MCP_TEST__ banner", status: "blocked",
        content: { image_1080x607: { id: 12 }, icon_256x256_app: { id: 13 } },
        textblocks: { title_40_vkads: { text: "Тест" }, text_90: { text: "Тестовый текст" }, cta_apps_full: { text: "install" } },
        urls: { primary: { id: 11 } },
      }) },
    ]);
  });

  it("не позволяет передать имя существующей кампании в test write", async () => {
    const client = new VkAdsClient({ tokenProvider: () => "test-token", timeoutMs: 1_000, fetchImplementation: fetch });
    await expect(client.createTestAdPlan({ name: "Продажи", objective: "traffic", packageId: 11 })).rejects.toThrow("__MCP_TEST__");
  });

  it("создаёт test ad group только под test ad plan через фиксированный payload", async () => {
    const requests: Array<{ url: string; method: string; body: string | undefined }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "", body: typeof init?.body === "string" ? init.body : undefined });
        if ((init?.method ?? "") === "GET") return new Response(JSON.stringify({ id: 10, name: "__MCP_TEST__ plan" }), { status: 200 });
        return new Response(JSON.stringify({ id: 11 }), { status: 200 });
      },
    });

    await expect(client.createTestAdGroup({ adPlanId: 10, packageId: 20, name: "__MCP_TEST__ group", targetings: { geo: { regions: [1] } } })).resolves.toMatchObject({ id: 11 });
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/ad_plans/10.json", method: "GET", body: undefined },
      { url: "https://ads.vk.com/api/v2/ad_groups.json", method: "POST", body: JSON.stringify({ ad_plan_id: 10, package_id: 20, name: "__MCP_TEST__ group", status: "blocked", targetings: { geo: { regions: [1] } } }) },
    ]);
  });

  it("создаёт только blocked appinstalls test campaign в test ad plan", async () => {
    const requests: Array<{ url: string; method: string; body: string | undefined }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "", body: typeof init?.body === "string" ? init.body : undefined });
        if ((init?.method ?? "") === "GET") return new Response(JSON.stringify({ id: 10, name: "__MCP_TEST__ plan" }), { status: 200 });
        return new Response(JSON.stringify({ id: 12 }), { status: 201 });
      },
    });

    await expect(client.createTestCampaign({ adPlanId: 10, packageId: 2860, objective: "appinstalls", name: "__MCP_TEST__ campaign" })).resolves.toEqual({ id: 12 });
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/ad_plans/10.json", method: "GET", body: undefined },
      { url: "https://ads.vk.com/api/v2/campaigns.json", method: "POST", body: JSON.stringify({ name: "__MCP_TEST__ campaign", ad_plan_id: 10, package_id: 2860, objective: "appinstalls", status: "blocked" }) },
    ]);
  });

  it("переименовывает только существующую test ad group", async () => {
    const requests: Array<{ url: string; method: string; body: string | undefined }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "", body: typeof init?.body === "string" ? init.body : undefined });
        if ((init?.method ?? "") === "GET") return new Response(JSON.stringify({ id: 11, name: "__MCP_TEST__ group" }), { status: 200 });
        return new Response(null, { status: 204 });
      },
    });
    await expect(client.renameTestAdGroup(11, "__MCP_TEST__ group renamed")).resolves.toEqual({});
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/ad_groups/11.json", method: "GET", body: undefined },
      { url: "https://ads.vk.com/api/v2/ad_groups/11.json", method: "POST", body: JSON.stringify({ name: "__MCP_TEST__ group renamed" }) },
    ]);
  });

  it("переименовывает только существующую test campaign через подтверждённый endpoint", async () => {
    const requests: Array<{ url: string; method: string; body: string | undefined }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "", body: typeof init?.body === "string" ? init.body : undefined });
        if ((init?.method ?? "") === "GET") return new Response(JSON.stringify({ id: 12, name: "__MCP_TEST__ campaign" }), { status: 200 });
        return new Response(null, { status: 204 });
      },
    });

    await expect(client.renameTestCampaign(12, "__MCP_TEST__ campaign renamed")).resolves.toEqual({});
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/campaigns/12.json", method: "GET", body: undefined },
      { url: "https://ads.vk.com/api/v2/campaigns/12.json", method: "POST", body: JSON.stringify({ name: "__MCP_TEST__ campaign renamed" }) },
    ]);
  });

  it("soft-delete только существующую test campaign", async () => {
    const requests: Array<{ url: string; method: string; body: string | undefined }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "", body: typeof init?.body === "string" ? init.body : undefined });
        if ((init?.method ?? "") === "GET") return new Response(JSON.stringify({ id: 12, name: "__MCP_TEST__ campaign" }), { status: 200 });
        return new Response(null, { status: 204 });
      },
    });

    await expect(client.deleteTestCampaign(12)).resolves.toEqual({});
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/campaigns/12.json", method: "GET", body: undefined },
      { url: "https://ads.vk.com/api/v2/campaigns/12.json", method: "POST", body: JSON.stringify({ status: "deleted" }) },
    ]);
  });

  it("изменяет дневной лимит существующей кампании через тот же endpoint", async () => {
    const requests: Array<{ url: string; method: string; body: string | undefined }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "", body: typeof init?.body === "string" ? init.body : undefined });
        if ((init?.method ?? "") === "GET") return new Response(JSON.stringify({ id: 12, budget_limit_day: 500 }), { status: 200 });
        return new Response(null, { status: 204 });
      },
    });

    await expect(client.updateCampaignBudgetLimitDay(12, 750)).resolves.toEqual({});
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/campaigns/12.json", method: "GET", body: undefined },
      { url: "https://ads.vk.com/api/v2/campaigns/12.json", method: "POST", body: JSON.stringify({ budget_limit_day: 750 }) },
    ]);
  });

  it("переименовывает только существующий test banner через подтверждённый endpoint", async () => {
    const requests: Array<{ url: string; method: string; body: string | undefined }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "", body: typeof init?.body === "string" ? init.body : undefined });
        if ((init?.method ?? "") === "GET") return new Response(JSON.stringify({ id: 13, name: "__MCP_TEST__ banner" }), { status: 200 });
        return new Response(null, { status: 204 });
      },
    });

    await expect(client.renameTestBanner(13, "__MCP_TEST__ banner renamed")).resolves.toEqual({});
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/banners/13.json", method: "GET", body: undefined },
      { url: "https://ads.vk.com/api/v2/banners/13.json", method: "POST", body: JSON.stringify({ name: "__MCP_TEST__ banner renamed" }) },
    ]);
  });

  it("soft-delete только существующую test ad group", async () => {
    const requests: Array<{ url: string; method: string; body: string | undefined }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "", body: typeof init?.body === "string" ? init.body : undefined });
        if ((init?.method ?? "") === "GET") return new Response(JSON.stringify({ id: 11, name: "__MCP_TEST__ group" }), { status: 200 });
        return new Response(null, { status: 204 });
      },
    });
    await expect(client.deleteTestAdGroup(11)).resolves.toEqual({});
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/ad_groups/11.json", method: "GET", body: undefined },
      { url: "https://ads.vk.com/api/v2/ad_groups/11.json", method: "POST", body: JSON.stringify({ status: "deleted" }) },
    ]);
  });

  it("загружает test-список ремаркетинга только в фиксированный multipart endpoint", async () => {
    let receivedUrl = "";
    let name = "";
    let type = "";
    let filename = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        const form = init?.body as FormData;
        const file = form.get("file") as File;
        filename = file.name;
        ({ name, type } = JSON.parse(String(form.get("data"))) as { name: string; type: string });
        return new Response(JSON.stringify({ id: 99, status: "loading" }), { status: 201 });
      },
    });

    await expect(client.createTestRemarketingUserList({
      name: "__MCP_TEST__ audience", type: "vk", filename: "audience.txt", mimeType: "text/plain", bytes: Buffer.from("1\n2\n"),
    })).resolves.toMatchObject({ id: 99 });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/remarketing/users_lists.json");
    expect({ name, type, filename }).toEqual({ name: "__MCP_TEST__ audience", type: "vk", filename: "audience.txt" });
  });

  it("загружает v3 test-список с name и type как multipart-полями", async () => {
    let receivedUrl = "";
    let filename = "";
    let name = "";
    let type = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        const form = init?.body as FormData;
        filename = (form.get("file") as File).name;
        name = String(form.get("name"));
        type = String(form.get("type"));
        return new Response(JSON.stringify({ id: 100, status: "receiving" }), { status: 200 });
      },
    });

    await expect(client.createTestRemarketingUserListV3({ name: "__MCP_TEST__ v3 audience", type: "vk", filename: "audience.csv", mimeType: "text/csv", bytes: Buffer.from("1\n2\n") })).resolves.toMatchObject({ id: 100 });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v3/remarketing/users_lists.json");
    expect({ filename, name, type }).toEqual({ filename: "audience.csv", name: "__MCP_TEST__ v3 audience", type: "vk" });
  });

  it("загружает test-список офлайн-конверсий документированным multipart контрактом", async () => {
    let receivedUrl = "";
    let filename = "";
    let data: Record<string, unknown> = {};
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        const form = init?.body as FormData;
        filename = (form.get("list_users") as File).name;
        data = JSON.parse(String(form.get("data"))) as Record<string, unknown>;
        return new Response(null, { status: 204 });
      },
    });

    await expect(client.createTestOfflineGoal({
      name: "__MCP_TEST__ offline", attributionPeriod: 90, type: "hash_email", filename: "offline.csv", mimeType: "text/csv", bytes: Buffer.from("hash\n"),
    })).resolves.toEqual({});
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/remarketing/offline_goals.json");
    expect({ filename, data }).toEqual({ filename: "offline.csv", data: { name: "__MCP_TEST__ offline", attribution_period: 90, type: "hash_email" } });
  });

  it("обновляет только существующий test offline-goal документированным multipart контрактом", async () => {
    const requests: string[] = [];
    let receivedUrl = "";
    let data: Record<string, unknown> = {};
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push(`${init?.method ?? "GET"} ${String(url)}`);
        if (init?.method === "GET") return new Response(JSON.stringify({ items: [{ id: 42, name: "__MCP_TEST__ offline" }] }), { status: 200 });
        receivedUrl = String(url);
        data = JSON.parse(String((init?.body as FormData).get("data"))) as Record<string, unknown>;
        return new Response(null, { status: 204 });
      },
    });

    await expect(client.updateTestOfflineGoal({ id: 42, name: "__MCP_TEST__ renamed" })).resolves.toEqual({});
    expect(requests).toEqual(["GET https://ads.vk.com/api/v2/remarketing/offline_goals.json", "POST https://ads.vk.com/api/v2/remarketing/offline_goals/42.json"]);
    expect({ receivedUrl, data }).toEqual({ receivedUrl: "https://ads.vk.com/api/v2/remarketing/offline_goals/42.json", data: { name: "__MCP_TEST__ renamed" } });
  });

  it("удаляет только предварительно подтверждённый __MCP_TEST__ список офлайн-конверсий", async () => {
    const requests: Array<{ url: string; method: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "GET" });
        if (init?.method === "DELETE") return new Response(null, { status: 204 });
        return new Response(JSON.stringify({ items: [{ id: 42, name: "__MCP_TEST__ offline" }] }), { status: 200 });
      },
    });

    await expect(client.deleteTestOfflineGoal(42)).resolves.toEqual({});
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/remarketing/offline_goals.json", method: "GET" },
      { url: "https://ads.vk.com/api/v2/remarketing/offline_goals/42.json", method: "DELETE" },
    ]);
  });

  it("переименовывает и удаляет только test-список ремаркетинга", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "", body: typeof init?.body === "string" ? init.body : undefined });
        if ((init?.method ?? "") === "GET") return new Response(JSON.stringify({ id: 99, name: "__MCP_TEST__ audience" }), { status: 200 });
        return new Response(null, { status: 204 });
      },
    });

    await client.renameTestRemarketingUserList(99, "__MCP_TEST__ renamed");
    await client.deleteTestRemarketingUserList(99);
    await client.deleteTestRemarketingUserListV3(99);
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/remarketing/users_lists/99.json", method: "GET" },
      { url: "https://ads.vk.com/api/v2/remarketing/users_lists/99.json", method: "POST", body: JSON.stringify({ name: "__MCP_TEST__ renamed" }) },
      { url: "https://ads.vk.com/api/v2/remarketing/users_lists/99.json", method: "GET" },
      { url: "https://ads.vk.com/api/v1/remarketing_users_list/99.json", method: "DELETE" },
      { url: "https://ads.vk.com/api/v2/remarketing/users_lists/99.json", method: "GET" },
      { url: "https://ads.vk.com/api/v3/remarketing/users_lists/99.json", method: "DELETE" },
    ]);
  });

  it("переименовывает test-список через документированный v3 endpoint", async () => {
    const requests: Array<{ url: string; method: string; body: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token", timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") });
        if ((init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ id: 99, name: "__MCP_TEST__ source" }), { status: 200 });
        return new Response(JSON.stringify({ id: 99, name: "__MCP_TEST__ renamed v3" }), { status: 200 });
      },
    });
    await expect(client.renameTestRemarketingUserListV3(99, "__MCP_TEST__ renamed v3")).resolves.toMatchObject({ id: 99 });
    expect(requests.at(-1)).toEqual({ url: "https://ads.vk.com/api/v3/remarketing/users_lists/99.json", method: "POST", body: JSON.stringify({ name: "__MCP_TEST__ renamed v3" }) });
  });

  it("подключает только существующего клиента агентства через фиксированный contract", async () => {
    let receivedUrl = "";
    let receivedBody = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        receivedBody = String(init?.body);
        return new Response(JSON.stringify({ user: { id: 77 } }), { status: 200 });
      },
    });

    await expect(client.connectExistingAgencyClient({ userId: 77, accessType: "full_access" })).resolves.toEqual({ user: { id: 77 } });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/agency/clients.json");
    expect(JSON.parse(receivedBody)).toEqual({ access_type: "full_access", user: { id: 77 } });
  });

  it("создаёт local geo только с test-именем и фиксированным payload", async () => {
    let receivedUrl = "";
    let receivedBody = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        receivedUrl = String(url);
        receivedBody = String(init?.body);
        return new Response(JSON.stringify({ id: 24, name: "__MCP_TEST__ geo" }), { status: 200 });
      },
    });

    await expect(client.createTestLocalGeo({
      name: "__MCP_TEST__ geo",
      regions: [{ lat: 55.75583, lng: 37.6173, radius: 3000, label: "Центр" }],
    })).resolves.toMatchObject({ id: 24 });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v2/remarketing/local_geo.json");
    expect(JSON.parse(receivedBody)).toEqual({
      name: "__MCP_TEST__ geo",
      regions: [{ lat: 55.75583, lng: 37.6173, radius: 3000, label: "Центр" }],
    });
    await expect(client.createTestLocalGeo({ name: "__MCP_TEST__ too small", regions: [{ lat: 0, lng: 0, radius: 499, label: "Точка" }] })).rejects.toThrow("от 500 до 10000");
    await expect(client.createTestLocalGeo({ name: "__MCP_TEST__ too large", regions: [{ lat: 0, lng: 0, radius: 10_001, label: "Точка" }] })).rejects.toThrow("от 500 до 10000");
    await expect(client.createTestLocalGeo({ name: "Обычное гео", regions: [{ lat: 0, lng: 0, radius: 1, label: "Точка" }] })).rejects.toThrow("__MCP_TEST__");
  });

  it("изменяет и удаляет только test local geo через detail endpoints", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "", body: typeof init?.body === "string" ? init.body : undefined });
        if ((init?.method ?? "") === "GET") return new Response(JSON.stringify({ items: [{ id: 24, name: "__MCP_TEST__ geo" }] }), { status: 200 });
        return new Response(null, { status: 204 });
      },
    });
    const regions = [{ lat: 55.75583, lng: 37.6173, radius: 3000, label: "Центр" }];
    await client.updateTestLocalGeo({ id: 24, name: "__MCP_TEST__ geo renamed", regions });
    await client.deleteTestLocalGeo(24);
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/remarketing/local_geo.json", method: "GET" },
      { url: "https://ads.vk.com/api/v2/remarketing/local_geo/24.json", method: "POST", body: JSON.stringify({ name: "__MCP_TEST__ geo renamed", regions }) },
      { url: "https://ads.vk.com/api/v2/remarketing/local_geo.json", method: "GET" },
      { url: "https://ads.vk.com/api/v2/remarketing/local_geo/24.json", method: "DELETE" },
    ]);
  });

  it("отправляет test-лид только после проверки __MCP_TEST__ формы", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
        if (init?.method === "POST") return new Response(JSON.stringify({ id: 1 }), { status: 200 });
        return new Response(JSON.stringify({ id: 7, name: "__MCP_TEST__ form" }), { status: 200 });
      },
    });

    await client.sendTestLead(7);
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v1/lead_ads/lead_forms/7.json", method: "GET" },
      { url: "https://ads.vk.com/api/v1/lead_ads/lead_forms/7/send_test_lead", method: "POST", body: "{}" },
    ]);
  });

  it("использует фиксированные пути для активации и отзыва ключа, а также SKAdNetwork", async () => {
    const requests: Array<{ url: string; method: string; body?: string }> = [];
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        requests.push({ url: String(url), method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
        return new Response(null, { status: 204 });
      },
    });

    await client.activateExternalSharingKey("safe_key-7");
    await client.revokeSharingKey("safe_key-7");
    await client.shareSkAdNetworkIds({ appId: 10, count: 2, recipient: "test@example.test" });
    await client.withdrawSkAdNetworkIds({ appId: 10, count: 1, recipient: "test@example.test" });
    expect(requests).toEqual([
      { url: "https://ads.vk.com/api/v2/sharing_keys/safe_key-7.json", method: "POST", body: "{}" },
      { url: "https://ads.vk.com/api/v2/sharing_keys/safe_key-7.json", method: "DELETE" },
      { url: "https://ads.vk.com/api/v2/apple_apps/10/sk_ad_network_ids/share.json", method: "POST", body: JSON.stringify({ count: 2, username: "test@example.test" }) },
      { url: "https://ads.vk.com/api/v2/apple_apps/10/sk_ad_network_ids/withdraw.json", method: "POST", body: JSON.stringify({ count: 1, username: "test@example.test" }) },
    ]);
  });

  it("читает только технические поля mobile_app_users для SKAdNetwork preflight", async () => {
    let receivedUrl = "";
    const client = new VkAdsClient({
      tokenProvider: () => "test-token",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        receivedUrl = String(url);
        return new Response(JSON.stringify({ count: 1, offset: 0, items: [{ platform: "iOS", rb_mobile_app_id: 10, sk_ad_network_ids: { available: 3 }, users: [] }] }), { status: 200 });
      },
    });

    await expect(client.getAppleAppSkAdNetworkStatus(10)).resolves.toMatchObject({ rb_mobile_app_id: 10 });
    expect(receivedUrl).toBe("https://ads.vk.com/api/v1/mobile_app_users.json?offset=0&limit=50&fields=app_name%2Cplatform%2Crb_mobile_app_id%2Ccampaign_ids%2Csk_ad_network_ids%2Cusers");
  });
});
