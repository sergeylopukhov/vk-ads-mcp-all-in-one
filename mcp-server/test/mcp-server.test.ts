import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { LoggingMessageNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { createServer } from "../src/server.js";
import { CommunityResearchStore } from "../src/community-research-store.js";
import { VkAdsApiError, type VkAdsClient } from "../src/vk-client.js";

describe("MCP-контракт", () => {
  const createClientStub = () => ({
    getUser: async () => ({ id: 1, username: "test", currency: "RUB" }),
    listAdPlans: async () => ({ count: 0, offset: 0, items: [] }),
    getGoalStatistics: async () => ({ items: [], total: { goals: [] } }),
    listAdGroups: async () => ({ count: 0, offset: 0, items: [] }),
    listCampaigns: async () => ({ count: 0, offset: 0, items: [] }),
    listBanners: async () => ({ count: 0, offset: 0, items: [] }),
    getUrl: async () => ({ id: 1, url: "https://example.test" }),
    getUrls: async () => [],
    listRegions: async () => ({ count: 0, offset: 0, items: [] }),
    listPackages: async () => [],
    getReachForecast: async () => ({ cr_ctr: [], histograms: [] }),
    checkAuditPixel: async () => ({ audit_pixel: "https://example.test/pixel", generated_audit_pixels: [] }),
    listCurrencies: async () => [],
    listBannerPatterns: async () => [],
    listBannerFormats: async () => [],
    listBannerFieldDefinitions: async () => ({ count: 0, offset: 0, items: [] }),
    listRemarketingCounters: async () => [],
    listOfflineGoals: async () => [],
    listPricelists: async () => ({ count: 0, offset: 0, items: [] }),
    listRemarketingUserLists: async () => ({ count: 0, offset: 0, items: [] }),
    listInAppEvents: async () => ({ count: 0, offset: 0, items: [] }),
    listInAppEventCategories: async () => [],
    listMobileAppUsers: async () => ({ count: 0, offset: 0, items: [] }),
    listLeadForms: async () => ({ count: 0, offset: 0, items: [] }),
    listSurveyForms: async () => ({ count: 0, offset: 0, items: [] }),
    listPackagePads: async () => [],
    listSegments: async () => ({ count: 0, offset: 0, items: [] }),
    listLocalGeo: async () => [],
    listPadsTree: async () => [],
    listMobileCategories: async () => [],
    getMobileApp: async () => ({ id: "com.example.app", name: "Test App" }),
    listMobileOperators: async () => [],
    listMobileTypes: async () => [],
    listMobileOs: async () => [],
    listMobileVendors: async () => [],
    getTargetingsTree: async () => ({}),
    getThrottling: async () => ({}),
    getGoals: async () => ({}),
    listAgencyClients: async () => [],
    listManagerClients: async () => [],
    listSharingKeys: async () => [],
    listSearchPhrases: async () => [],
    listSubscriptions: async () => ({ count: 0, offset: 0, items: [] }),
    listTransactionGroups: async () => ({ count: 0, offset: 0, items: [] }),
  } as unknown as VkAdsClient);

  it("не регистрирует write-инструменты в readonly и показывает только исполняемый поиск по умолчанию", async () => {
    const server = createServer(createClientStub(), "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name);
    expect(names).toContain("get_provider_context");
    expect(names).not.toContain("vk_ads_oauth_status");
    expect(names).not.toContain("vk_ads_oauth_begin");
    expect(names).toContain("call_read_tool");
    expect(names).toContain("vk_get_ad_plans");
    expect(names).toContain("vk_get_packages_pads");
    expect(names).toContain("vk_get_search_phrases");
    expect(names).not.toContain("write_preview");
    expect(names).not.toContain("write_execute");

    const search = await client.callTool({ name: "search_tools", arguments: { query: "", include_planned: false } });
    expect(search.structuredContent).toMatchObject({ total: expect.any(Number) });

    const planned = await client.callTool({ name: "search_tools", arguments: { query: "", include_planned: true } });
    expect(planned.structuredContent).toMatchObject({ total: expect.any(Number) });

    await Promise.all([client.close(), server.close()]);
  });

  it("отклоняет неявные правила скоринга и начисляет балл по корректной схеме", async () => {
    const communityClient = {
      getByIds: async () => [{ id: 7, name: "Регентское дело", description: "Курсы", screen_name: "regent", members_count: 1_000, type: "group" }],
      wall: async () => [{ date: Math.floor(Date.now() / 1_000), text: "Регентские занятия" }],
    };
    const server = createServer(createClientStub(), "readonly", { communityClient: communityClient as never });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const invalid = await client.callTool({ name: "vk_score_communities", arguments: { community_ids: [7], scoring_rules: { terms: ["регент"], name_term: 35 } } });
    expect(invalid.isError).toBe(true);

    const valid = await client.callTool({ name: "vk_score_communities", arguments: { community_ids: [7], scoring_rules: { terms: ["регент"], weights: { name_term: 35, post_term: 25 }, per_match_weights: { name_term: 35, post_term: 25 } } } });
    expect(valid.isError).not.toBe(true);
    expect(valid.structuredContent).toMatchObject({ items: [expect.objectContaining({ id: 7, score: 95, reasons: expect.arrayContaining(["термины в названии: 1 совп. +35 из 35", "термины в публикациях: 1 совп. +25 из 25", "свежая активность: +15", "тематические публикации: 100% +20"]) })] });

    await Promise.all([client.close(), server.close()]);
  });

  it("выполняет поиск, анализ и скоринг сообществ одним read-only вызовом", async () => {
    const communityClient = {
      searchPage: async () => ({ count: 1, offset: 0, items: [{ id: 7 }] }),
      getByIds: async () => [{ id: 7, name: "Регентское дело", description: "Курсы для регентов", screen_name: "regent", members_count: 1_000, type: "group" }],
      wall: async () => [{ date: Math.floor(Date.now() / 1_000), text: "Регентские занятия" }],
    };
    const server = createServer(createClientStub(), "readonly", { communityClient: communityClient as never });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "vk_find_community_candidates", arguments: { keywords: ["регент"], limit: 10, posts_limit: 10 } });

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ items: [expect.objectContaining({ id: 7, score: expect.any(Number), activity: expect.objectContaining({ last_post_at: expect.any(String), posts_analyzed: 1 }), reasons: expect.any(Array) })] });
    await Promise.all([client.close(), server.close()]);
  });

  it("в универсальном исследовании поднимает тематически активные сообщества выше неактивных", async () => {
    const now = Math.floor(Date.now() / 1_000);
    const communityClient = {
      searchPage: async () => ({ count: 2, offset: 0, items: [{ id: 7 }, { id: 8 }] }),
      getByIds: async () => [
        { id: 7, name: "Регентские курсы", description: "Обучение регентов", screen_name: "active", members_count: 500, type: "group" },
        { id: 8, name: "Регентская школа", description: "Обучение регентов", screen_name: "inactive", members_count: 5_000, type: "group" },
      ],
      wall: async (id: number) => id === 7
        ? [{ date: now - 7 * 86400, text: "Регентская практика" }, { date: now - 86400, text: "Регентское занятие" }]
        : [],
    };
    const server = createServer(createClientStub(), "readonly", { communityClient: communityClient as never });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "vk_find_community_candidates", arguments: { keywords: ["регент"], limit: 10, posts_limit: 10 } });
    expect(result.isError).not.toBe(true);
    const items = (result.structuredContent as { items: Array<{ id: number; score: number; reasons: string[] }> }).items;
    const active = items.find((item) => item.id === 7)!;
    const inactive = items.find((item) => item.id === 8)!;
    expect(active.score).toBeGreaterThan(inactive.score);
    expect(active.reasons).toContain("тематические публикации: 100% +20");
    expect(inactive.reasons).toContain("низкая активность: -20");
    await Promise.all([client.close(), server.close()]);
  });

  it("при min_members останавливает отсортированный поиск после страницы ниже порога", async () => {
    let calls = 0;
    const communityClient = {
      searchPage: async (...args: unknown[]) => {
        calls += 1;
        expect(args.at(-1)).toBe("members");
        return { count: 200, offset: 0, items: [{ id: 7 }] };
      },
      getByIds: async () => [{ id: 7, name: "Маленькая группа", description: "", screen_name: "small", members_count: 999, type: "group" }],
      wall: async () => [],
    };
    const server = createServer(createClientStub(), "readonly", { communityClient: communityClient as never });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "vk_discover_communities", arguments: { keywords: ["курсы"], min_members: 1_000, limit: 100 } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ items: [] });
    expect(calls).toBe(1);
    await Promise.all([client.close(), server.close()]);
  });

  it("повторяет поиск по релевантности, если VK вернул пустую выдачу на сортировке по участникам", async () => {
    const sorts: unknown[] = [];
    const communityClient = {
      searchPage: async (...args: unknown[]) => {
        const sort = args.at(-1); sorts.push(sort);
        return sort === "members"
          ? { count: 0, offset: 0, items: [] }
          : { count: 1, offset: 0, items: [{ id: 7 }] };
      },
      getByIds: async () => [{ id: 7, name: "Регентские курсы", description: "Обучение", screen_name: "course", members_count: 1_000, type: "group" }],
      wall: async () => [],
    };
    const server = createServer(createClientStub(), "readonly", { communityClient: communityClient as never });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "vk_discover_communities", arguments: { keywords: ["регент"], min_members: 100, limit: 100 } });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({ items: [expect.objectContaining({ id: 7 })] });
    expect(sorts).toEqual(["members", "relevance"]);
    await Promise.all([client.close(), server.close()]);
  });

  it("совместимый синхронный поиск ограничен 100 кандидатами", async () => {
    const ids = Array.from({ length: 250 }, (_, index) => index + 1);
    let wallCalls = 0;
    const communityClient = {
      searchPage: async (_query: string, offset: number) => ({ count: ids.length, offset, items: ids.slice(offset, offset + 100).map((id) => ({ id })) }),
      getByIds: async (pageIds: number[]) => pageIds.map((id) => ({ id, name: `Курс ${id}`, description: "курс", screen_name: `course${id}`, members_count: id, type: "group" })),
      wall: async () => { wallCalls += 1; return []; },
    };
    const server = createServer(createClientStub(), "readonly", { communityClient: communityClient as never });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "vk_find_community_candidates", arguments: { keywords: ["курс"], posts_limit: 1 } });
    expect(result.isError).not.toBe(true);
    expect((result.structuredContent as { items: unknown[] }).items).toHaveLength(100);
    expect(wallCalls).toBe(100);
    await Promise.all([client.close(), server.close()]);
  });

  it("не анализирует ложный результат поиска без подтверждения фразы в metadata", async () => {
    let wallCalls = 0;
    const communityClient = {
      searchPage: async () => ({ count: 2, offset: 0, items: [{ id: 7 }, { id: 8 }] }),
      getByIds: async () => [
        { id: 7, name: "Регентские курсы", description: "Обучение", screen_name: "relevant", members_count: 500, type: "group" },
        { id: 8, name: "Музыкальная школа", description: "Общий курс", screen_name: "false-result", members_count: 5_000, type: "group" },
      ],
      wall: async () => { wallCalls += 1; return []; },
    };
    const server = createServer(createClientStub(), "readonly", { communityClient: communityClient as never });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "vk_find_community_candidates", arguments: { keywords: ["регент"], posts_limit: 1 } });
    expect(result.isError).not.toBe(true);
    expect((result.structuredContent as { items: Array<{ id: number }> }).items).toEqual([expect.objectContaining({ id: 7 })]);
    expect(wallCalls).toBe(1);
    await Promise.all([client.close(), server.close()]);
  });

  it("сохраняет полный запуск исследования и возвращает тот же снимок по run_id", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vk-community-research-mcp-"));
    try {
      const communityClient = {
        searchPage: async () => ({ count: 1, offset: 0, items: [{ id: 7 }] }),
        getByIds: async () => [{ id: 7, name: "Регентское дело", description: "Курсы для регентов", screen_name: "regent", members_count: 1_000, type: "group" }],
        wall: async () => [{ date: Math.floor(Date.now() / 1_000), text: "Регентские занятия" }],
      };
      const store = new CommunityResearchStore(join(directory, "runs.json"), 24 * 60 * 60 * 1_000);
      const server = createServer(createClientStub(), "readonly", { communityClient: communityClient as never, communityResearchStore: store });
      const client = new Client({ name: "test-client", version: "0.0.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const result = await client.callTool({ name: "vk_research_communities", arguments: { keywords: ["регент"], limit: 10, posts_limit: 10 } });
      expect(result.isError).not.toBe(true);
      const run = result.structuredContent as { run_id: string; status: string; progress: Record<string, unknown> };
      expect(run).toMatchObject({ run_id: expect.any(String), status: expect.stringMatching(/queued|running|completed/), progress: expect.objectContaining({ selected: 1, batch_size: 25 }) });

      let progress: { status: string } | undefined;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const current = await client.callTool({ name: "vk_get_community_research_progress", arguments: { run_id: run.run_id } });
        progress = current.structuredContent as { status: string };
        if (progress.status === "completed") break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect(progress).toMatchObject({ status: "completed" });

      const restored = await client.callTool({ name: "vk_get_community_research_run", arguments: { run_id: run.run_id } });
      expect(restored.isError).not.toBe(true);
      expect(restored.structuredContent).toMatchObject({ run_id: run.run_id, status: "completed", summary: expect.objectContaining({ selected: 1, analyzed: 1, analysis_batch_size: 25, analysis_batches: 1, search_pages: 1, incomplete: false }) });
      await Promise.all([client.close(), server.close()]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("добавляет базовые сигналы к неполному профилю скоринга исследования", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vk-community-research-default-scoring-"));
    try {
      const communityClient = {
        searchPage: async () => ({ count: 1, offset: 0, items: [{ id: 7 }] }),
        getByIds: async () => [{ id: 7, name: "Регентские курсы", description: "Обучение", screen_name: "regent", members_count: 1_000, type: "group" }],
        wall: async () => [{ date: Math.floor(Date.now() / 1_000), text: "Регентские занятия" }],
      };
      const store = new CommunityResearchStore(join(directory, "runs.json"), 24 * 60 * 60 * 1_000);
      const server = createServer(createClientStub(), "readonly", { communityClient: communityClient as never, communityResearchStore: store });
      const client = new Client({ name: "test-client", version: "0.0.0" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const started = await client.callTool({ name: "vk_start_community_research", arguments: { keywords: ["регент"], posts_limit: 1, scoring_rules: { weights: { name_term: 25 } } } });
      const runId = (started.structuredContent as { run_id: string }).run_id;
      let restored: { status: string; scoring_version: string; passed: Array<{ score: number; reasons: string[] }> } | undefined;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const current = await client.callTool({ name: "vk_get_community_research_run", arguments: { run_id: runId } });
        restored = current.structuredContent as typeof restored;
        if (restored?.status === "completed") break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      expect(restored).toMatchObject({ status: "completed", scoring_version: "community-research-v2", passed: [expect.objectContaining({ score: 46, reasons: expect.arrayContaining(["свежая активность: +15", "тематические публикации: 100% +20"]) })] });
      await Promise.all([client.close(), server.close()]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("отправляет безопасный прогресс и итог фонового исследования через MCP-уведомления", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vk-community-research-notifications-"));
    try {
      const communityClient = {
        searchPage: async () => ({ count: 26, offset: 0, items: Array.from({ length: 26 }, (_, index) => ({ id: index + 1 })) }),
        getByIds: async (ids: number[]) => ids.map((id) => ({ id, name: `Регентские курсы ${id}`, description: "Обучение регентов", screen_name: `regent-${id}`, members_count: 1_000, type: "group" })),
        wall: async () => {
          await new Promise((resolve) => setTimeout(resolve, 3));
          return [{ date: Math.floor(Date.now() / 1_000), text: "Регентские занятия" }];
        },
      };
      const store = new CommunityResearchStore(join(directory, "runs.json"), 24 * 60 * 60 * 1_000);
      const server = createServer(createClientStub(), "readonly", { communityClient: communityClient as never, communityResearchStore: store, communityResearchProgressIntervalMs: 5 });
      const client = new Client({ name: "test-client", version: "0.0.0" });
      const notifications: string[] = [];
      client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
        notifications.push(String(notification.params.data));
      });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

      const started = await client.callTool({ name: "vk_start_community_research", arguments: { keywords: ["регент"], posts_limit: 1 } });
      const runId = (started.structuredContent as { run_id: string }).run_id;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const current = await client.callTool({ name: "vk_get_community_research_progress", arguments: { run_id: runId } });
        if ((current.structuredContent as { status: string }).status === "completed") break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(notifications.some((message) => message.includes("обработано") && message.includes("осталось"))).toBe(true);
      expect(notifications.some((message) => message.includes("Исследование сообществ завершено") && message.includes("26"))).toBe(true);
      expect(notifications.join(" ")).not.toContain("Регентские занятия");
      await Promise.all([client.close(), server.close()]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("не готовит preview для legacy write-пути вне текущего официального индекса", async () => {
    const server = createServer(createClientStub(), "write");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "write_preview", arguments: { operation: "create_campaign", payload: {} } });
    expect(result.isError).toBe(true);
    expect(result.content.map((item) => item.type === "text" ? item.text : "").join(" ")).toContain("отсутствует в текущем официальном индексе");
    await Promise.all([client.close(), server.close()]);
  });

  it("отдаёт профиль и проверенный список полей banner через read-only инструменты", async () => {
    const server = createServer(createClientStub(), "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const account = await client.callTool({ name: "call_read_tool", arguments: { tool_name: "vk_get_user", arguments: {} } });
    expect(account.structuredContent).toMatchObject({ data: { account: { id: 1, currency: "RUB" } } });
    expect(JSON.stringify(account.structuredContent)).not.toContain("username");

    const fields = await client.callTool({ name: "banner_fields_list", arguments: {} });
    expect(fields.structuredContent).toMatchObject({ fields: expect.arrayContaining(["content", "textblocks", "urls"]) });

    await Promise.all([client.close(), server.close()]);
  });

  it("читает связи сегмента только по явному segment_id", async () => {
    const requested: number[] = [];
    const server = createServer({
      ...createClientStub(),
      listSegmentRelations: async (segmentId: number) => {
        requested.push(segmentId);
        return [{ id: 5, object_id: 8, object_type: "segment", params: { left: 30, right: 1 } }];
      },
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "segment_relations_list", arguments: { segment_id: 8 } });
    expect(result.structuredContent).toEqual({ items: [{ id: 5, object_id: 8, object_type: "segment", params: { left: 30, right: 1 } }] });
    expect(requested).toEqual([8]);

    await Promise.all([client.close(), server.close()]);
  });

  it("получает v1 URL ID без tracker и исходного URL в ответе", async () => {
    const server = createServer({
      ...createClientStub(),
      resolveUrlIdV1: async () => ({ id: 42, url: "https://example.test/private", url_types: ["external"], postback_trackers: ["private"], has_goals: false }),
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "url_id_resolve_v1", arguments: { url: "https://example.test/" } });
    expect(result.structuredContent).toEqual({ item: { id: 42, url_types: ["external"], has_goals: false } });

    await Promise.all([client.close(), server.close()]);
  });

  it("не раскрывает пользователей приложений и bearer-секреты ключей шаринга", async () => {
    const server = createServer({
      ...createClientStub(),
      listMobileAppUsers: async () => ({ count: 1, offset: 0, items: [{ app_name: "com.example.app", platform: "android", users: [{ email: "private@example.test" }], sk_ad_network_ids: ["secret-id"] }] }),
      listSharingKeys: async () => [{ id: 7, sharing_key: "secret", sharing_url: "https://secret.example.test", users: [{ username: "private" }], sources: { segments: [42] } }],
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const mobile = await client.callTool({ name: "vk_get_mobile_app_users", arguments: { arguments: {} } });
    expect(mobile.structuredContent).toEqual({ data: { count: 1, offset: 0, items: [{ app_name: "com.example.app", platform: "android", sk_ad_network_ids_count: 1 }] } });
    const keys = await client.callTool({ name: "vk_get_sharing_keys", arguments: { arguments: {} } });
    expect(keys.structuredContent).toEqual({ data: { items: [{ id: 7, source_types: ["segments"], recipients_count: 1 }] } });

    await Promise.all([client.close(), server.close()]);
  });

  it("фильтрует receipt и client metadata из финансовых групп", async () => {
    const server = createServer({
      ...createClientStub(),
      listTransactionGroups: async () => ({ count: 1, offset: 0, items: [{ id: 1, amount: "10", receipt: "https://private.example/receipt", description: "private", client_name: "Private" }] }),
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const groups = await client.callTool({ name: "transaction_groups_list", arguments: { offset: 0, limit: 1 } });
    expect(groups.structuredContent).toEqual({ count: 1, offset: 0, items: [{ id: 1, amount: "10" }] });
    expect(JSON.stringify(groups.structuredContent)).not.toContain("private.example");
    await Promise.all([client.close(), server.close()]);
  });

  it("не раскрывает PII респондентов и реквизиты уведомлений форм", async () => {
    const server = createServer({
      ...createClientStub(),
      listRespondents: async () => ({ count: 1, offset: 0, items: [{ id: 3, form_id: 7, email: "private@example.test", answers: [{ value: "секрет" }] }] }),
      getLeadFormDetail: async () => ({ id: 7, name: "Заявка", notification_email: "private@example.test", fields: [{ name: "Имя" }] }),
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const respondents = await client.callTool({ name: "respondents_list", arguments: {} });
    expect(respondents.structuredContent).toEqual({ count: 1, offset: 0, items: [{ id: 3, form_id: 7 }] });
    const form = await client.callTool({ name: "lead_form_details_get", arguments: { id: 7 } });
    expect(form.structuredContent).toEqual({ item: { id: 7, name: "Заявка", fields: [{ name: "Имя" }] } });

    await Promise.all([client.close(), server.close()]);
  });

  it("возвращает ограничения роли ОРД как capability и очищает ОРД metadata", async () => {
    const server = createServer({
      ...createClientStub(),
      getOrdUser: async () => ({ status: "ready", name: "Private Name", inn: "1234567890", site: "https://private.example.test" }),
      listOrdPartnerPads: async () => { throw new VkAdsApiError(403, "forbidden"); },
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const user = await client.callTool({ name: "ord_user_status_get", arguments: {} });
    expect(user.structuredContent).toEqual({ available: true, data: { status: "ready" } });
    const pads = await client.callTool({ name: "ord_partner_pads_list", arguments: {} });
    expect(pads.structuredContent).toMatchObject({ available: false, http_status: 403 });

    await Promise.all([client.close(), server.close()]);
  });

  it("требует первый день месяца для ОРД-акта площадки и скрывает договорные данные", async () => {
    const server = createServer({
      ...createClientStub(),
      getOrdPartnerActStatByPad: async () => ({ id: 7, status: "uploaded", email: "private@example.test", password: "private", contracts: [{ number: "private" }], url: "https://private.example.test" }),
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "ord_partner_act_stat_get", arguments: { month_start: "2026-07-01", ord_pad_id: 7 } });
    expect(result.structuredContent).toEqual({ available: true, data: { id: 7, status: "uploaded" } });
    const invalid = await client.callTool({ name: "ord_partner_act_stat_get", arguments: { month_start: "2026-07", ord_pad_id: 7 } });
    expect(invalid.isError).toBe(true);

    await Promise.all([client.close(), server.close()]);
  });

  it("использует безопасные list-fallback для агентских клиентов и подписок", async () => {
    const server = createServer({
      ...createClientStub(),
      listAgencyClients: async () => [{ id: 8, name: "Private Client", email: "private@example.test", status: "active" }],
      listSubscriptions: async () => ({ count: 1, offset: 0, items: [{ id: 4, resource: "banners" }] }),
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const agency = await client.callTool({ name: "agency_client_get", arguments: { client_id: 8 } });
    expect(agency.structuredContent).toEqual({ item: { id: 8, status: "active" } });
    const subscription = await client.callTool({ name: "subscription_details_get", arguments: { id: 4 } });
    expect(subscription.structuredContent).toEqual({ item: { id: 4, resource: "banners" } });

    await Promise.all([client.close(), server.close()]);
  });

  it("читает зарегистрированную ссылку только по положительному ID", async () => {
    const calls: number[] = [];
    const server = createServer({
      ...createClientStub(),
      getUrl: async (id: number) => { calls.push(id); return { id, url: "https://example.test" }; },
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({ name: "call_read_tool", arguments: { tool_name: "vk_get_urls", arguments: { id: 42 } } });
    expect(response.structuredContent).toMatchObject({ data: { id: 42 } });
    expect(calls).toEqual([42]);

    await Promise.all([client.close(), server.close()]);
  });

  it("маршрутизирует v3 профиль отдельно и скрывает PII", async () => {
    const server = createServer({
      ...createClientStub(),
      getUserV3: async () => ({ id: 42, status: "active", username: "private@example.test", phone: "+79990000000" }),
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({ name: "call_read_tool", arguments: { tool_name: "vk_get_user", arguments: { api_version: "v3" } } });
    expect(response.structuredContent).toMatchObject({ data: { account: { id: 42, currency: null, info_currency: null, status: "active", timezone: null }, api_version: "v3" } });
    expect(JSON.stringify(response.structuredContent)).not.toContain("private@example.test");

    await Promise.all([client.close(), server.close()]);
  });

  it("вызывает список площадок пакетов через целевой инструмент", async () => {
    const server = createServer({
      ...createClientStub(),
      listPackagePads: async () => [{ package_id: 2860, pad_id: 2064426 }],
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "vk_get_packages_pads", arguments: {} });
    expect(result.structuredContent).toEqual({ data: { items: [{ package_id: 2860, pad_id: 2064426 }] } });

    await Promise.all([client.close(), server.close()]);
  });

  it("вызывает список поисковых фраз через публичное имя инструмента", async () => {
    const server = createServer({
      ...createClientStub(),
      listSearchPhrases: async () => [{ id: 93, name: "Фразы" }],
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "vk_get_search_phrases", arguments: {} });
    expect(result.structuredContent).toEqual({ data: { items: [{ id: 93, name: "Фразы" }] } });

    await Promise.all([client.close(), server.close()]);
  });

  it("разбирает ссылку локально и редактирует секретный query-параметр", async () => {
    const server = createServer(createClientStub(), "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({ name: "call_read_tool", arguments: { tool_name: "vk_resolve_url", arguments: { url: "https://example.test/landing?utm_source=vk&token=secret" } } });
    expect(response.structuredContent).toMatchObject({ data: { hostname: "example.test", utm: { utm_source: "vk" } } });
    expect(JSON.stringify(response.structuredContent)).not.toContain("secret");

    await Promise.all([client.close(), server.close()]);
  });

  it("передаёт в VK только безопасный фильтр группы и allowlist полей banner", async () => {
    const received: unknown[] = [];
    const server = createServer({
      ...createClientStub(),
      listBanners: async (...args: unknown[]) => {
        received.push(args);
        return { count: 0, offset: 0, items: [] };
      },
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    await client.callTool({ name: "call_read_tool", arguments: { tool_name: "vk_get_banners", arguments: { ad_group_id: 42, fields: ["id", "content"] } } });
    expect(received).toEqual([[0, 100, { adGroupId: 42, fields: ["id", "content"] }]]);

    await Promise.all([client.close(), server.close()]);
  });

  it("передаёт ручной user scope только в read-инструментах", async () => {
    const received: unknown[] = [];
    const server = createServer({
      ...createClientStub(),
      listCampaigns: async (...args: unknown[]) => { received.push(args); return { count: 0, offset: 0, items: [] }; },
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    await client.callTool({ name: "call_read_tool", arguments: { tool_name: "vk_get_campaigns", arguments: { user_id: 42 } } });
    expect(received).toEqual([[0, 100, 42]]);

    await Promise.all([client.close(), server.close()]);
  });

  it("передаёт rich-поля plan и group только из соответствующего allowlist", async () => {
    const planArgs: unknown[] = [];
    const groupArgs: unknown[] = [];
    const server = createServer({
      ...createClientStub(),
      listAdPlans: async (...args: unknown[]) => { planArgs.push(args); return { count: 0, offset: 0, items: [] }; },
      listAdGroups: async (...args: unknown[]) => { groupArgs.push(args); return { count: 0, offset: 0, items: [] }; },
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    await client.callTool({ name: "call_read_tool", arguments: { tool_name: "vk_get_ad_plans", arguments: { fields: ["id", "budget_limit"] } } });
    await client.callTool({ name: "call_read_tool", arguments: { tool_name: "vk_get_ad_groups", arguments: { fields: ["id", "targetings"] } } });
    expect(planArgs).toEqual([[0, 100, ["id", "budget_limit"]]]);
    expect(groupArgs).toEqual([[0, 100, ["id", "targetings"]]]);

    await Promise.all([client.close(), server.close()]);
  });

  it("маршрутизирует v3-дневную статистику через строгую schema", async () => {
    const received: unknown[] = [];
    const server = createServer({
      ...createClientStub(),
      getStatistics: async (input: unknown) => {
        received.push(input);
        return { items: [], total: {} };
      },
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const response = await client.callTool({ name: "call_read_tool", arguments: { tool_name: "vk_get_statistics", arguments: { api_version: "v3", object_type: "ad_groups", period: "day", ids: [8], date_from: "2026-07-01", date_to: "2026-07-02", metrics: "uniques" } } });
    expect(response.isError).not.toBe(true);
    expect(received).toEqual([{ apiVersion: "v3", objectType: "ad_groups", period: "day", ids: [8], dateFrom: "2026-07-01", dateTo: "2026-07-02", metrics: "uniques" }]);

    await Promise.all([client.close(), server.close()]);
  });

  it("разрешает upload preview только в write-режиме и только из upload-каталога", async () => {
    const server = createServer(createClientStub(), "write", { uploadDir: resolve("test/fixtures") });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "write_preview", arguments: {
      operation: "upload_static_image",
      payload: { file_path: resolve("test/fixtures/mcp-upload-test.png") },
    } });
    expect(preview.structuredContent).toMatchObject({ operation: "upload_static_image", payload: { mime_type: "image/png" } });

    await Promise.all([client.close(), server.close()]);
  });

  it("проверяет media локально без регистрации write-операции", async () => {
    const server = createServer(createClientStub(), "readonly", { uploadDir: resolve("test/fixtures") });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "media_validate", arguments: {
      file_path: resolve("test/fixtures/mcp-upload-test.png"), kind: "image",
    } });
    expect(result.structuredContent).toMatchObject({
      filename: "mcp-upload-test.png", mime_type: "image/png", upload_ready: true,
    });

    await Promise.all([client.close(), server.close()]);
  });

  it("формирует XLSX в памяти без записи файла", async () => {
    const server = createServer(createClientStub(), "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "export_xlsx", arguments: {
      rows: [{ campaign: "Тест", spent: 123.45 }],
    } });
    const data = result.structuredContent as { filename: string; content_base64: string; byte_length: number };
    expect(data.filename).toBe("vk-ads-export.xlsx");
    expect(data.byte_length).toBeGreaterThan(100);
    expect(Buffer.from(data.content_base64, "base64").subarray(0, 4).toString("ascii")).toBe("PK\u0003\u0004");

    await Promise.all([client.close(), server.close()]);
  });

  it("получает статистику и экспортирует её без записи на диск", async () => {
    const server = createServer({
      ...createClientStub(),
      getStatistics: async () => ({ items: [{ id: 1, base: { spent: 15 } }], total: { base: { spent: 15 } } }),
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "statistics_export", arguments: {
      object_type: "campaigns", period: "summary", format: "csv",
    } });
    expect(result.structuredContent).toMatchObject({
      filename: "vk-ads-statistics.csv", row_count: 2, columns: expect.arrayContaining(["base.spent", "row_type"]),
    });

    await Promise.all([client.close(), server.close()]);
  });

  it("показывает только наблюдаемые поля списка пакетов", async () => {
    const server = createServer({
      ...createClientStub(),
      listPackages: async () => [{ id: 1, name: "Тест" }, { id: 2, objective: "traffic" }],
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "package_fields_list", arguments: {} });
    expect(result.structuredContent).toEqual({ fields: ["id", "name", "objective"], observed_items: 2 });

    await Promise.all([client.close(), server.close()]);
  });

  it("находит пакет по ID только внутри подтверждённого списка", async () => {
    const server = createServer({
      ...createClientStub(),
      listPackages: async () => [{ id: 2860, name: "Тестовый пакет" }],
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "package_get", arguments: { id: 2860 } });
    expect(result.structuredContent).toEqual({ item: { id: 2860, name: "Тестовый пакет" } });

    await Promise.all([client.close(), server.close()]);
  });

  it("читает счётчик ремаркетинга по документированному detail path и скрывает чувствительные поля", async () => {
    const server = createServer({
      ...createClientStub(),
      getRemarketingCounter: async () => ({ id: 77, name: "Счётчик", password: "private" }),
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "remarketing_counter_get", arguments: { id: 77 } });
    expect(result.structuredContent).toEqual({ item: { id: 77, name: "Счётчик" } });

    await Promise.all([client.close(), server.close()]);
  });

  it("изменяет доступный счётчик через preview", async () => {
    const server = createServer({
      ...createClientStub(),
      getRemarketingCounter: async () => ({ id: 77, name: "Рабочий counter" }),
      listRemarketingCounters: async () => [{ id: 77, name: "Рабочий counter" }],
      renameTestRemarketingCounter: async () => ({ id: 77, name: "Рабочий renamed" }),
    } as unknown as VkAdsClient, "write");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "vk_update_remarketing_counter", arguments: { counter_id: 77, name: "Рабочий renamed" } });
    const previewData = preview.structuredContent as { id: string; confirmation_statement: string };
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: previewData.id, confirmation_statement: previewData.confirmation_statement } });
    expect(executed.structuredContent).toMatchObject({ result: { id: 77 }, after: { reread: true, item: { id: 77 } } });

    await Promise.all([client.close(), server.close()]);
  });

  it("изменяет существующую цель доступного счётчика", async () => {
    const server = createServer({
      ...createClientStub(),
      listRemarketingCounters: async () => [{ id: 77, name: "Production counter" }],
      listRemarketingCounterGoals: async () => [{ id: 12, name: "Рабочий goal" }],
      updateTestCounterGoal: async () => ({ id: 12, name: "Рабочий goal renamed", value: 3, goal_type: "purchase" }),
    } as unknown as VkAdsClient, "write");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "vk_update_counter_goal", arguments: { counter_id: 77, goal_id: 12, name: "Production goal renamed", value: 3, goal_type: "purchase" } });
    const previewData = preview.structuredContent as { id: string; confirmation_statement: string };
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: previewData.id, confirmation_statement: previewData.confirmation_statement } });
    expect(executed.structuredContent).toMatchObject({ result: { id: 12 }, after: { reread: true } });
    await Promise.all([client.close(), server.close()]);
  });

  it("отдаёт только metadata списка ремаркетинга по ID", async () => {
    const server = createServer({
      ...createClientStub(),
      getRemarketingUserListV3: async () => ({ id: 88, name: "Список", status: "ready", contacts: ["скрыто"] }),
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "remarketing_list_get", arguments: { id: 88 } });
    expect(result.structuredContent).toEqual({ item: { id: 88, name: "Список", status: "ready" } });

    await Promise.all([client.close(), server.close()]);
  });

  it("маршрутизирует v2 и v3 списки ремаркетинга по явной версии", async () => {
    const calls: string[] = [];
    const server = createServer({
      ...createClientStub(),
      listRemarketingUserLists: async () => { calls.push("v3"); return { count: 0, offset: 0, items: [] }; },
      listRemarketingUserListsV2: async () => { calls.push("v2"); return { count: 0, offset: 0, items: [] }; },
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const v2 = await client.callTool({ name: "call_read_tool", arguments: { tool_name: "vk_get_remarketing_lists", arguments: { api_version: "v2", offset: 0, limit: 1 } } });
    const v3 = await client.callTool({ name: "call_read_tool", arguments: { tool_name: "vk_get_remarketing_lists", arguments: { api_version: "v3", offset: 0, limit: 1 } } });
    expect(v2.structuredContent).toMatchObject({ data: { api_version: "v2", count: 0 } });
    expect(v3.structuredContent).toMatchObject({ data: { api_version: "v3", count: 0 } });
    expect(calls).toEqual(["v2", "v3"]);

    await Promise.all([client.close(), server.close()]);
  });

  it("проверяет read-scope без переключения credential", async () => {
    const calls: unknown[][] = [];
    const server = createServer({
      ...createClientStub(),
      listCampaigns: async (...args: unknown[]) => { calls.push(args); return { count: 3, offset: 0, items: [] }; },
    } as unknown as VkAdsClient, "readonly", { connectionId: "local-default" });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "client_scope_check", arguments: { user_id: 42 } });
    expect(result.structuredContent).toMatchObject({ connection_id: "local-default", user_id: 42, read_scope_verified: true, campaigns_count: 3 });
    expect(calls).toEqual([[0, 1, 42]]);

    await Promise.all([client.close(), server.close()]);
  });

  it("получает лид-форму только из metadata-списка", async () => {
    const server = createServer({
      ...createClientStub(),
      listLeadForms: async () => ({ count: 1, offset: 0, items: [{ id: 91, name: "Заявка" }] }),
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "lead_form_get", arguments: { id: 91 } });
    expect(result.structuredContent).toEqual({ item: { id: 91, name: "Заявка" } });

    await Promise.all([client.close(), server.close()]);
  });

  it("получает опросную форму только из metadata-списка", async () => {
    const server = createServer({
      ...createClientStub(),
      listSurveyForms: async () => ({ count: 1, offset: 0, items: [{ id: 92, name: "Опрос" }] }),
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "survey_form_get", arguments: { id: 92 } });
    expect(result.structuredContent).toEqual({ item: { id: 92, name: "Опрос" } });

    await Promise.all([client.close(), server.close()]);
  });

  it("получает список поисковых фраз только из metadata-списка", async () => {
    const server = createServer({
      ...createClientStub(),
      listSearchPhrases: async () => [{ id: 93, name: "Фразы", status: "ready" }],
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "search_phrase_get", arguments: { id: 93 } });
    expect(result.structuredContent).toEqual({ item: { id: 93, name: "Фразы", status: "ready" } });

    await Promise.all([client.close(), server.close()]);
  });

  it("получает подписку только из metadata-страниц", async () => {
    const server = createServer({
      ...createClientStub(),
      listSubscriptions: async () => ({ count: 1, offset: 0, items: [{ id: 94, name: "Подписка" }] }),
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "subscription_get", arguments: { id: 94 } });
    expect(result.structuredContent).toEqual({ item: { id: 94, name: "Подписка" } });

    await Promise.all([client.close(), server.close()]);
  });

  it("получает группу транзакций без доступа к операциям и балансу", async () => {
    const server = createServer({
      ...createClientStub(),
      listTransactionGroups: async () => ({ count: 1, offset: 0, items: [{ id: 95, name: "Группа" }] }),
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "transaction_group_get", arguments: { id: 95 } });
    expect(result.structuredContent).toEqual({ item: { id: 95, name: "Группа" } });

    await Promise.all([client.close(), server.close()]);
  });

  it("получает только metadata цели офлайн-конверсий", async () => {
    const server = createServer({
      ...createClientStub(),
      listOfflineGoals: async () => [{ id: 96, name: "Покупка" }],
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "offline_goal_get", arguments: { id: 96 } });
    expect(result.structuredContent).toEqual({ item: { id: 96, name: "Покупка" } });

    await Promise.all([client.close(), server.close()]);
  });

  it("отдаёт лиды без ответов формы и персональных данных", async () => {
    const server = createServer({
      ...createClientStub(),
      listLeads: async () => ({ count: 1, offset: 0, items: [{ id: 98, form_id: 3, created_at: "2026-07-20 10:00:00", phone: "+79990000000", email: "user@example.test", answers: [{ text: "секрет" }] }] }),
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "vk_get_leads", arguments: { arguments: { form_ids: [3] } } });
    expect(result.structuredContent).toEqual({ data: { count: 1, offset: 0, items: [{ id: 98, form_id: 3, created_at: "2026-07-20 10:00:00" }] } });

    await Promise.all([client.close(), server.close()]);
  });

  it("получает прайс-лист только из metadata-страниц", async () => {
    const server = createServer({
      ...createClientStub(),
      listPricelists: async () => ({ count: 1, offset: 0, items: [{ id: 97, name: "Каталог" }] }),
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "pricelist_get", arguments: { id: 97 } });
    expect(result.structuredContent).toEqual({ item: { id: 97, name: "Каталог" } });

    await Promise.all([client.close(), server.close()]);
  });

  it("получает видеоотчёт только через подтверждённые metrics video и uniques_video", async () => {
    let input: unknown;
    const server = createServer({
      ...createClientStub(),
      getStatistics: async (value: unknown) => {
        input = value;
        return { items: [{ id: 1, rows: [{ video: {}, uniques_video: {} }] }], total: {} };
      },
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "vk_get_video_report", arguments: { object_type: "banners", period: "day", ids: [1], date_from: "2026-07-13", date_to: "2026-07-19" } });
    expect(result.structuredContent).toEqual({ items: [{ id: 1, rows: [{ video: {}, uniques_video: {} }] }], total: {} });
    expect(input).toEqual({ objectType: "banners", period: "day", ids: [1], dateFrom: "2026-07-13", dateTo: "2026-07-19", metrics: "video,uniques_video" });

    await Promise.all([client.close(), server.close()]);
  });

  it("возвращает цели счётчика только при доступной capability", async () => {
    const server = createServer({
      ...createClientStub(),
      listRemarketingCounters: async () => [{ id: 99, name: "Счётчик" }],
      listRemarketingCounterGoals: async () => [{ id: 1, name: "Покупка" }],
    } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const result = await client.callTool({ name: "vk_get_counter_goals", arguments: { arguments: { id: 99 } } });
    expect(result.structuredContent).toEqual({ data: { counter_id: 99, available: true, items: [{ id: 1, name: "Покупка" }] } });

    await Promise.all([client.close(), server.close()]);
  });

  it("не готовит banner preview без локально подтверждённых content ID", async () => {
    const server = createServer({ ...createClientStub(), getAdGroup: async () => ({ id: 11, name: "Рабочий group", package_id: 2860 }) } as unknown as VkAdsClient, "write");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "write_preview", arguments: {
      operation: "create_test_banner",
      payload: {
        ad_group_id: 11, name: "Рабочий banner", primary_url_id: 12,
        landscape_image_id: 13, icon_image_id: 14, title: "Тест", text: "Тестовый текст", cta: "install",
      },
    } });
    expect(preview.isError).toBe(true);
    expect(preview.content[0]?.type === "text" ? preview.content[0].text : "").toContain("локальный preflight");

    await Promise.all([client.close(), server.close()]);
  });

  it("показывает preflight, reread и audit для подтверждённой test-записи", async () => {
    const server = createServer({
      ...createClientStub(),
      createAdPlan: async () => ({ id: 10 }),
      getAdPlan: async () => ({ id: 10, name: "Рабочий created", status: "blocked" }),
      listPackages: async () => [{ id: 1, objective: ["traffic"] }],
    } as unknown as VkAdsClient, "write", { connectionId: "agency-client-a", profileName: "agency_a" });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const context = await client.callTool({ name: "get_provider_context", arguments: {} });
    expect(context.structuredContent).toMatchObject({ connection_id: "agency-client-a", profile: "agency_a" });

    const profile = await client.callTool({ name: "account_profile_get", arguments: {} });
    expect(profile.structuredContent).toEqual({ profile: "agency_a", connection_id: "agency-client-a", selection: "startup_configuration" });

    const writeTools = await client.listTools();
    expect(writeTools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["vk_create_ad_plan", "vk_update_ad_plan", "vk_delete_ad_plan", "vk_create_campaign", "vk_update_campaign", "vk_create_ad_group", "vk_create_banner", "vk_update_banner", "vk_manage_banners", "vk_remoderate_banners", "vk_create_segment", "vk_update_segment", "vk_delete_segment", "vk_manage_segment_relations", "vk_create_remarketing_list", "vk_update_remarketing_list", "vk_delete_remarketing_list", "vk_connect_client", "vk_manage_local_geo", "vk_export_leads", "survey_respondents_export", "lead_form_copy", "vk_update_lead_form", "survey_form_copy", "lead_forms_archive_manage", "survey_forms_archive_manage"]));

    const preview = await client.callTool({ name: "vk_create_ad_plan", arguments: {
      name: "Production created", objective: "traffic",
    } });
    const previewData = preview.structuredContent as { id: string; confirmation_statement: string; connection_id: string; preflight: { expected_change: string } };
    expect(previewData).toMatchObject({ connection_id: "agency-client-a", preflight: { expected_change: expect.stringContaining("blocked") } });

    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: previewData.id, confirmation_statement: previewData.confirmation_statement } });
    expect(executed.structuredContent).toMatchObject({ after: { reread: true, item: { id: 10 } }, audit: { status: "succeeded", connection_id: "agency-client-a" } });

    const audit = await client.callTool({ name: "write_audit_list", arguments: {} });
    expect(audit.structuredContent).toMatchObject({ items: [{ id: previewData.id, status: "succeeded" }] });

    await Promise.all([client.close(), server.close()]);
  });

  it("копирует лид-форму только через preview и скрывает реквизиты формы", async () => {
    const server = createServer({
      ...createClientStub(),
      getLeadFormDetail: async (id: number) => ({ id, name: "Рабочий source", notification_email: "private@example.test" }),
      copyTestLeadForm: async () => ({ id: 71, name: "Рабочий copy", notification_email: "private@example.test" }),
    } as unknown as VkAdsClient, "write");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "lead_form_copy", arguments: { form_id: 70, name: "Рабочий copy" } });
    const data = preview.structuredContent as { id: string; confirmation_statement: string; preflight: { before: Record<string, unknown> } };
    expect(data.preflight.before).toEqual({ id: 70, name: "Рабочий source" });
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(executed.structuredContent).toMatchObject({ result: { id: 71, name: "Рабочий copy" }, after: { reread: true, item: { id: 71 } } });
    expect(JSON.stringify(executed.structuredContent)).not.toContain("private@example.test");

    await Promise.all([client.close(), server.close()]);
  });

  it("выдаёт экспорт ответов опроса только после подтверждения и не сохраняет PII в audit", async () => {
    const server = createServer({
      ...createClientStub(),
      getSurveyFormDetail: async (id: number) => ({ id, name: "Опрос", notification_email: "private@example.test" }),
      exportSurveyFormRespondents: async () => ({ bytes: new Uint8Array([1, 2, 3]), contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    } as unknown as VkAdsClient, "write");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "survey_respondents_export", arguments: { form_id: 7 } });
    const previewData = preview.structuredContent as { id: string; confirmation_statement: string; preflight: { before: { survey_form: { notification_email?: unknown } } } };
    expect(previewData.preflight.before.survey_form.notification_email).toBeUndefined();

    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: previewData.id, confirmation_statement: previewData.confirmation_statement } });
    expect(executed.structuredContent).toMatchObject({ result: { form_id: 7, format: "xlsx", content_base64: "AQID" }, audit: { status: "succeeded" } });
    const audit = await client.callTool({ name: "write_audit_list", arguments: {} });
    expect(JSON.stringify(audit.structuredContent)).not.toContain("AQID");

    await Promise.all([client.close(), server.close()]);
  });

  it("переименовывает только test-лид-форму через preview и не передаёт PII-секции", async () => {
    let name = "Рабочий source";
    const server = createServer({
      ...createClientStub(),
      getLeadFormDetail: async (id: number) => ({ id, name, notification_email: "private@example.test", contact_fields: ["phone"] }),
      renameTestLeadForm: async (id: number, nextName: string) => {
        name = nextName;
        return { id, name, notification_email: "private@example.test", contact_fields: ["phone"] };
      },
    } as unknown as VkAdsClient, "write");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "vk_update_lead_form", arguments: { form_id: 70, name: "Рабочий renamed" } });
    const data = preview.structuredContent as { id: string; confirmation_statement: string; preflight: { before: Record<string, unknown>; expected_change: string } };
    expect(data.preflight.before).toEqual({ id: 70, name: "Рабочий source" });
    expect(data.preflight.expected_change).toContain("не изменяются");
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(executed.structuredContent).toMatchObject({ result: { id: 70, name: "Рабочий renamed" }, after: { reread: true, item: { id: 70, name: "Рабочий renamed" } } });
    expect(JSON.stringify(executed.structuredContent)).not.toContain("private@example.test");
    expect(JSON.stringify(executed.structuredContent)).not.toContain("phone");

    await Promise.all([client.close(), server.close()]);
  });

  it("проводит сегмент только через preview", async () => {
    const calls: Array<{ source: number; days: number }> = [];
    const server = createServer({
      ...createClientStub(),
      listRemarketingCounters: async () => [{ id: 1, counter_id: 99, system_status: "active" }],
      getGoals: async () => ({ topmailru: [{ counter_id: 99, goal: "uss" }] }),
      createTestSegment: async ({ counterId, leftDays }: { counterId: number; leftDays: number }) => {
        calls.push({ source: counterId, days: leftDays });
        return { id: 81 };
      },
      getSegment: async () => ({ id: 81, name: "Рабочий segment", pass_condition: 1 }),
    } as unknown as VkAdsClient, "write");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "vk_create_segment", arguments: { name: "Рабочий segment", counter_id: 99, left_days: 30, goal_id: "uss" } });
    const data = preview.structuredContent as { id: string; confirmation_statement: string; preflight: { expected_change: string } };
    expect(data.preflight.expected_change).toContain("Создать сегмент");
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(executed.structuredContent).toMatchObject({ operation: "create_test_segment", after: { reread: true, item: { id: 81 } } });
    expect(calls).toEqual([{ source: 99, days: 30 }]);

    await Promise.all([client.close(), server.close()]);
  });

  it("не позволяет mass-action вывести Рабочий plan из blocked", async () => {
    const calls: number[][] = [];
    const server = createServer({
      ...createClientStub(),
      getAdPlan: async (id: number) => ({ id, name: `Рабочий ${id}`, status: "blocked" }),
      blockTestAdPlans: async (ids: number[]) => { calls.push(ids); return { ids, status: "blocked" }; },
    } as unknown as VkAdsClient, "write");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "write_preview", arguments: { operation: "block_test_ad_plans", payload: { ad_plan_ids: [10, 20] } } });
    const data = preview.structuredContent as { id: string; confirmation_statement: string; preflight: { risk: string; expected_change: string } };
    expect(data.preflight).toMatchObject({ risk: "low", expected_change: expect.stringContaining("blocked") });
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(executed.structuredContent).toMatchObject({ operation: "block_test_ad_plans", after: { reread: true } });
    expect(calls).toEqual([[10, 20]]);

    await Promise.all([client.close(), server.close()]);
  });

  it("ограничивает group mass-action только Рабочий ID и статусом blocked", async () => {
    const calls: number[][] = [];
    const server = createServer({
      ...createClientStub(),
      getAdGroup: async (id: number) => ({ id, name: `Рабочий ${id}`, status: "blocked" }),
      blockTestAdGroups: async (ids: number[]) => { calls.push(ids); return { ids, status: "blocked" }; },
    } as unknown as VkAdsClient, "write");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "write_preview", arguments: { operation: "block_test_ad_groups", payload: { ad_group_ids: [10] } } });
    const data = preview.structuredContent as { id: string; confirmation_statement: string };
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(executed.structuredContent).toMatchObject({ operation: "block_test_ad_groups", after: { reread: true } });
    expect(calls).toEqual([[10]]);
    await Promise.all([client.close(), server.close()]);
  });

  it("готовит и выполняет production banner mass-action через фиксированный preview", async () => {
    const calls: number[][] = [];
    const server = createServer({
      ...createClientStub(),
      getBanner: async (id: number) => ({ id, name: `Рабочий ${id}`, status: "blocked" }),
      manageBanners: async (items: Array<{ id: number }>) => { calls.push(items.map((item) => item.id)); return { items }; },
    } as unknown as VkAdsClient, "write");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "vk_manage_banners", arguments: { items: [{ id: 10, status: "blocked" }] } });
    const data = preview.structuredContent as { id: string; confirmation_statement: string };
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(executed.structuredContent).toMatchObject({ operation: "manage_banners", after: { reread: true } });
    expect(calls).toEqual([[10]]);

    await Promise.all([client.close(), server.close()]);
  });

  it("проводит manager-client write через preview, точное подтверждение и reread", async () => {
    const calls: Array<{ managerId: number; clientId: number; accessType: string }> = [];
    const server = createServer({
      ...createClientStub(),
      listManagerClients: async () => [{ id: 9, manager_id: 3, access_type: "readonly" }],
      updateAgencyManagerClient: async (input: { managerId: number; clientId: number; accessType: string }) => { calls.push(input); return {}; },
    } as unknown as VkAdsClient, "write", { allowAgencyWrites: true });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "manager_client_update", arguments: { manager_id: 3, client_id: 9, access_type: "full_access" } });
    const data = preview.structuredContent as { id: string; confirmation_statement: string; preflight: { before: Record<string, unknown>; risk: string } };
    expect(data.preflight).toMatchObject({ risk: "high", before: { id: 9 } });
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(executed.structuredContent).toMatchObject({ operation: "update_manager_client", after: { reread: true }, audit: { status: "succeeded" } });
    expect(calls).toEqual([{ managerId: 3, clientId: 9, accessType: "full_access" }]);

    await Promise.all([client.close(), server.close()]);
  });

  it("проводит agency-client write через preview, точное подтверждение и reread", async () => {
    const updates: Array<{ clientId: number; isVkads?: boolean; accessType?: string }> = [];
    const server = createServer({
      ...createClientStub(),
      listAgencyClients: async () => [{ id: 9, access_type: "full_access" }],
      updateAgencyClient: async (input: { clientId: number; isVkads?: boolean; accessType?: string }) => { updates.push(input); return {}; },
    } as unknown as VkAdsClient, "write", { allowAgencyWrites: true });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "agency_client_update", arguments: { client_id: 9, is_vkads: true, access_type: "full_access" } });
    const data = preview.structuredContent as { id: string; confirmation_statement: string; preflight: { before: Record<string, unknown>; risk: string } };
    expect(data.preflight).toMatchObject({ risk: "high", before: { id: 9 } });
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(executed.structuredContent).toMatchObject({ operation: "update_agency_client", after: { reread: true }, audit: { status: "succeeded" } });
    expect(updates).toEqual([{ clientId: 9, isVkads: true, accessType: "full_access" }]);

    await Promise.all([client.close(), server.close()]);
  });

  it("изменяет профиль только через отдельный opt-in, preview и reread", async () => {
    const calls: Array<{ version: string; body: Record<string, unknown> }> = [];
    const server = createServer({
      ...createClientStub(),
      getUserV3: async () => ({ id: 1, status: "active", username: "private@example.test" }),
      updateUserProfile: async (version: string, body: Record<string, unknown>) => { calls.push({ version, body }); return {}; },
    } as unknown as VkAdsClient, "write", { allowProfileWrites: true });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "user_profile_update", arguments: { api_version: "v3", language: "en", mailings: { finance: { email: [] } } } });
    if (!preview.structuredContent) throw new Error(preview.content.map((item) => item.type === "text" ? item.text : "").join("\n"));
    const data = preview.structuredContent as { id: string; confirmation_statement: string; preflight: { risk: string; before: Record<string, unknown> } };
    expect(data.preflight).toMatchObject({ risk: "high", before: { id: 1 } });
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(calls).toEqual([{ version: "v3", body: { language: "en", mailings: { finance: { email: [] } } } }]);
    expect(executed.structuredContent).toMatchObject({ operation: "update_user_profile", after: { reread: true, item: { id: 1 } } });
    expect(JSON.stringify(executed.structuredContent)).not.toContain("private@example.test");

    await Promise.all([client.close(), server.close()]);
  });

  it("подключает существующий счётчик только после preview и проверки отсутствия связи", async () => {
    const calls: Array<{ counterId: number; name: string; flags?: string[] }> = [];
    const server = createServer({
      ...createClientStub(),
      listRemarketingCounters: async () => [],
      connectExistingRemarketingCounter: async (input: { counterId: number; name: string; flags?: string[] }) => { calls.push(input); return {}; },
    } as unknown as VkAdsClient, "write", { allowRemarketingCounterWrites: true });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "remarketing_counter_connect_existing", arguments: { counter_id: 77, name: "Existing counter" } });
    const data = preview.structuredContent as { id: string; confirmation_statement: string; preflight: { before: Record<string, unknown>; risk: string } };
    expect(data.preflight).toMatchObject({ risk: "high", before: { counter_already_connected: false } });
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(executed.structuredContent).toMatchObject({ operation: "connect_existing_remarketing_counter", after: { reread: false }, audit: { status: "succeeded" } });
    expect(calls).toEqual([{ counterId: 77, name: "Existing counter", flags: ["cookie_sync"] }]);

    await Promise.all([client.close(), server.close()]);
  });

  it("не выдаёт creative preflight за подтверждённое создание banner", async () => {
    const server = createServer({ ...createClientStub(), listPackages: async () => [{ id: 1 }] } as unknown as VkAdsClient, "readonly");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preflight = await client.callTool({ name: "creative_preflight", arguments: { package_id: 1, content_ids: { image_1080x607: 42 }, textblocks: { title_25: "Тест" } } });
    expect(preflight.structuredContent).toMatchObject({ package_found: true, ready_for_banner_write: false });

    await Promise.all([client.close(), server.close()]);
  });

  it("отправляет test-лид только для test-формы и не возвращает PII", async () => {
    const sent: number[] = [];
    const server = createServer({
      ...createClientStub(),
      getLeadFormDetail: async (id: number) => ({ id, name: "Рабочий form", notification_email: "private@example.test" }),
      sendTestLead: async (id: number) => { sent.push(id); },
    } as unknown as VkAdsClient, "write");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "lead_form_test_lead_send", arguments: { form_id: 70 } });
    const data = preview.structuredContent as { id: string; confirmation_statement: string };
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(executed.structuredContent).toMatchObject({ operation: "send_test_lead", result: { form_id: 70, test_lead_sent: true }, after: { reread: true } });
    expect(JSON.stringify(executed.structuredContent)).not.toContain("private@example.test");
    expect(sent).toEqual([70]);

    await Promise.all([client.close(), server.close()]);
  });

  it("создаёт и отзывает только ключ текущего MCP-сеанса без раскрытия секрета", async () => {
    const revoked: string[] = [];
    const server = createServer({
      ...createClientStub(),
      getSegment: async () => ({ id: 8, name: "Рабочий segment" }),
      createTestSharingKey: async () => ({ sharing_key: "secret-key", sharing_url: "https://private.example.test" }),
      revokeSharingKey: async (key: string) => { revoked.push(key); return {}; },
    } as unknown as VkAdsClient, "write", { allowSharingKeyRevoke: true });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const createPreview = await client.callTool({ name: "sharing_key_create", arguments: { segment_id: 8, recipient: "test@example.test" } });
    const createData = createPreview.structuredContent as { id: string; confirmation_statement: string };
    const created = await client.callTool({ name: "write_execute", arguments: { preview_id: createData.id, confirmation_statement: createData.confirmation_statement } });
    const createdData = created.structuredContent as { result: { key_handle: string } };
    expect(createdData.result.key_handle).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(created.structuredContent)).not.toContain("secret-key");
    expect(JSON.stringify(created.structuredContent)).not.toContain("private.example.test");

    const revokePreview = await client.callTool({ name: "sharing_key_revoke", arguments: { key_handle: createdData.result.key_handle } });
    const revokeData = revokePreview.structuredContent as { id: string; confirmation_statement: string; preflight: { risk: string } };
    expect(revokeData.preflight.risk).toBe("high");
    await client.callTool({ name: "write_execute", arguments: { preview_id: revokeData.id, confirmation_statement: revokeData.confirmation_statement } });
    expect(revoked).toEqual(["secret-key"]);

    await Promise.all([client.close(), server.close()]);
  });

  it("активирует настроенный внешний ключ только после preview и не раскрывает его", async () => {
    const activated: string[] = [];
    const externalKey = "private-sharing-key";
    const server = createServer({
      ...createClientStub(),
      activateExternalSharingKey: async (key: string) => { activated.push(key); },
    } as unknown as VkAdsClient, "write", { externalSharingKey: externalKey });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "sharing_key_activate_configured", arguments: {} });
    const data = preview.structuredContent as { id: string; confirmation_statement: string; preflight: { risk: string } };
    expect(data.preflight.risk).toBe("high");
    expect(JSON.stringify(preview.structuredContent)).not.toContain(externalKey);
    expect(activated).toEqual([]);

    await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: "   " } });
    expect(activated).toEqual([]);

    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(executed.structuredContent).toMatchObject({ operation: "activate_configured_sharing_key", result: { activated: true, activation_scope: "all_sources" }, after: { reread: false, activated: true } });
    expect(JSON.stringify(executed.structuredContent)).not.toContain(externalKey);
    expect(activated).toEqual([externalKey]);

    await Promise.all([client.close(), server.close()]);
  });

  it("разрешает SKAdNetwork только для allowlist test-app без кампаний и свободных IDs", async () => {
    const calls: Array<{ kind: string; count: number }> = [];
    const status = {
      platform: "iOS", rb_mobile_app_id: 10, campaign_ids: [],
      sk_ad_network_ids: { available: 5, used: 0, total: 5 },
      users: [{ user: { username: "test@example.test" }, sk_ad_network_ids: { available: 5, used: 0, total: 5 } }],
    };
    const server = createServer({
      ...createClientStub(),
      getAppleAppSkAdNetworkStatus: async () => status,
      shareSkAdNetworkIds: async ({ count }: { count: number }) => { calls.push({ kind: "share", count }); },
      withdrawSkAdNetworkIds: async ({ count }: { count: number }) => { calls.push({ kind: "withdraw", count }); },
    } as unknown as VkAdsClient, "write", { allowSkAdNetworkWrites: true, skAdNetworkTestAppIds: [10] });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    for (const [tool, expected] of [["skadnetwork_ids_share", "share"], ["skadnetwork_ids_withdraw", "withdraw"]] as const) {
      const preview = await client.callTool({ name: tool, arguments: { app_id: 10, recipient: "test@example.test", count: 2 } });
      const data = preview.structuredContent as { id: string; confirmation_statement: string; preflight: { risk: string } };
      expect(data.preflight.risk).toBe("high");
      const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
      expect(executed.structuredContent).toMatchObject({ after: { reread: true, item: { app_id: 10, campaigns_count: 0, available_ids: 5 } } });
      expect(JSON.stringify(executed.structuredContent)).not.toContain("test@example.test");
      expect(calls.at(-1)).toEqual({ kind: expected, count: 2 });
    }

    await Promise.all([client.close(), server.close()]);
  });

  it("подготавливает SKAdNetwork-запись в write-режиме без отдельного opt-in", async () => {
    const server = createServer({
      ...createClientStub(),
      getAppleAppSkAdNetworkStatus: async () => ({ platform: "iOS", rb_mobile_app_id: 10, campaign_ids: [], sk_ad_network_ids: { available: 5 }, users: [] }),
    } as unknown as VkAdsClient, "write", { skAdNetworkTestAppIds: [10] });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "skadnetwork_ids_share", arguments: { app_id: 10, recipient: "test@example.test", count: 1 } });
    expect(preview.isError).not.toBe(true);

    await Promise.all([client.close(), server.close()]);
  });

  it("изменяет категорию только in-app события разрешённого test-приложения", async () => {
    let categoryId = 1;
    const updates: Array<{ appId: number; trackerId: number; eventId: number; nextCategoryId: number }> = [];
    const server = createServer({
      ...createClientStub(),
      listInAppEventCategories: async () => [{ id: 1, name: "old" }, { id: 2, name: "new" }],
      listInAppEvents: async () => ({ count: 1, offset: 0, items: [{ id: 7, rb_mobile_app_id: 65, tracker_id: 1, inapp_event_category_id: categoryId, name: "private event" }] }),
      updateInAppEventCategory: async ({ appId, trackerId, eventId, categoryId: nextCategoryId }: { appId: number; trackerId: number; eventId: number; categoryId: number }) => {
        updates.push({ appId, trackerId, eventId, nextCategoryId });
        categoryId = nextCategoryId;
      },
    } as unknown as VkAdsClient, "write", { allowInAppEventCategoryWrites: true, inAppEventTestAppIds: [65] });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "vk_update_inapp_event_category", arguments: { app_id: 65, tracker_id: 1, event_id: 7, category_id: 2 } });
    const data = preview.structuredContent as { id: string; confirmation_statement: string; preflight: { risk: string; before: Record<string, unknown> } };
    expect(data.preflight.risk).toBe("medium");
    expect(data.preflight.before).toMatchObject({ id: 7, rb_mobile_app_id: 65, inapp_event_category_id: 1 });
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(executed.structuredContent).toMatchObject({ result: { app_id: 65, tracker_id: 1, event_id: 7, category_id: 2, updated: true }, after: { reread: true, item: { id: 7, inapp_event_category_id: 2 } } });
    expect(updates).toEqual([{ appId: 65, trackerId: 1, eventId: 7, nextCategoryId: 2 }]);
    expect(JSON.stringify(executed.structuredContent)).not.toContain("private event");

    await Promise.all([client.close(), server.close()]);
  });

  it("проверяет доступность in-app события вместо отдельного opt-in", async () => {
    const server = createServer(createClientStub(), "write", { inAppEventTestAppIds: [65] });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "vk_update_inapp_event_category", arguments: { app_id: 65, tracker_id: 1, event_id: 7, category_id: 2 } });
    expect(preview.isError).toBe(true);
    expect(preview.content[0]?.type === "text" ? preview.content[0].text : "").toContain("In-app событие не найдено");

    await Promise.all([client.close(), server.close()]);
  });

  it("восстанавливает лимит токенов только через свежий preview и точное подтверждение", async () => {
    let recoveryCalls = 0;
    const server = createServer(createClientStub(), "write", {
      tokenRecovery: {
        recover: async () => {
          recoveryCalls += 1;
          return { token_reissued: true, refresh_token_saved: true, expires_at: "2026-07-22T00:00:00.000Z" };
        },
      },
    });
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "vk_recover_token_limit", arguments: {} });
    const data = preview.structuredContent as { id: string; confirmation_statement: string; operation: string; preflight: { risk: string; expected_change: string } };
    expect(recoveryCalls).toBe(0);
    expect(data).toMatchObject({ operation: "recover_token_limit", preflight: { risk: "high", expected_change: expect.stringContaining("все токены") } });

    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(recoveryCalls).toBe(1);
    expect(executed.structuredContent).toMatchObject({ operation: "recover_token_limit", result: { token_reissued: true, refresh_token_saved: true }, after: { reread: false }, audit: { status: "succeeded" } });

    await Promise.all([client.close(), server.close()]);
  });

  it("обновляет metadata приложений только после preview и точного подтверждения", async () => {
    let appleRefreshes = 0;
    let googleRefreshes = 0;
    const server = createServer({
      ...createClientStub(),
      getAppleApp: async () => ({ id: 535176909, title: "private title", category_id: 4 }),
      getGoogleApp: async () => ({ id: 7, title: "private title", category_id: 4 }),
      refreshAppleAppMetadata: async () => { appleRefreshes += 1; return { id: 535176909, title: "private title", category_id: 4 }; },
      refreshGoogleAppMetadata: async () => { googleRefreshes += 1; return { id: 7, title: "private title", category_id: 4 }; },
    } as unknown as VkAdsClient, "write");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const applePreview = await client.callTool({ name: "apple_app_metadata_refresh", arguments: { app_id: 535176909 } });
    const apple = applePreview.structuredContent as { id: string; confirmation_statement: string; operation: string; preflight: { risk: string; before: unknown } };
    expect(appleRefreshes).toBe(0);
    expect(apple).toMatchObject({ operation: "refresh_apple_app_metadata", preflight: { risk: "low", before: { id: 535176909, category_id: 4 } } });
    expect(JSON.stringify(apple)).not.toContain("private title");
    const rejected = await client.callTool({ name: "write_execute", arguments: { preview_id: apple.id, confirmation_statement: "   " } });
    expect(rejected.isError).toBe(true);
    expect(appleRefreshes).toBe(0);
    const appleExecuted = await client.callTool({ name: "write_execute", arguments: { preview_id: apple.id, confirmation_statement: apple.confirmation_statement } });
    expect(appleExecuted.structuredContent).toMatchObject({ operation: "refresh_apple_app_metadata", after: { reread: true, item: { id: 535176909, category_id: 4 } } });
    expect(appleRefreshes).toBe(1);

    const googlePreview = await client.callTool({ name: "google_app_metadata_refresh", arguments: { package_name: "com.example.app" } });
    const google = googlePreview.structuredContent as { id: string; confirmation_statement: string };
    await client.callTool({ name: "write_execute", arguments: { preview_id: google.id, confirmation_statement: google.confirmation_statement } });
    expect(googleRefreshes).toBe(1);

    await Promise.all([client.close(), server.close()]);
  });

  it("создаёт подписку только через preview и скрывает callback URL при reread", async () => {
    let creates = 0;
    const server = createServer({
      ...createClientStub(),
      listSubscriptions: async () => ({ count: 1, offset: 0, items: [{ id: 123, resource: "BANNER", callback_url: "https://private.example.test/hook" }] }),
      createSubscription: async () => { creates += 1; return { id: 123 }; },
    } as unknown as VkAdsClient, "write");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "subscription_create", arguments: { resource: "BANNER", callback_url: "https://callback.example.test/vk" } });
    const data = preview.structuredContent as { id: string; confirmation_statement: string; operation: string };
    expect(creates).toBe(0);
    expect(data.operation).toBe("create_subscription");
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(creates).toBe(1);
    expect(executed.structuredContent).toMatchObject({ operation: "create_subscription", after: { reread: true, item: { id: 123, resource: "BANNER" } } });
    expect(JSON.stringify(executed.structuredContent)).not.toContain("private.example.test");

    await Promise.all([client.close(), server.close()]);
  });

  it("удаляет offline goal только после preview и только с test-префиксом", async () => {
    let deletes = 0;
    const server = createServer({
      ...createClientStub(),
      listOfflineGoals: async () => [{ id: 42, name: "Рабочий offline", entries_count: 1 }],
      deleteTestOfflineGoal: async () => { deletes += 1; return {}; },
    } as unknown as VkAdsClient, "write");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "offline_goal_delete", arguments: { offline_goal_id: 42 } });
    const data = preview.structuredContent as { id: string; confirmation_statement: string; operation: string; preflight: { before: unknown } };
    expect(deletes).toBe(0);
    expect(data).toMatchObject({ operation: "delete_test_offline_goal", preflight: { before: { id: 42, entries_count: 1 } } });
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(deletes).toBe(1);
    expect(executed.structuredContent).toMatchObject({ operation: "delete_test_offline_goal", after: { reread: false } });

    await Promise.all([client.close(), server.close()]);
  });

  it("обновляет offline goal только через preview и только с test-префиксом", async () => {
    const updates: Array<{ id: number; name: string }> = [];
    const server = createServer({
      ...createClientStub(),
      listOfflineGoals: async () => [{ id: 42, name: "Рабочий offline", entries_count: 1 }],
      updateTestOfflineGoal: async (input: { id: number; name: string }) => { updates.push(input); return {}; },
    } as unknown as VkAdsClient, "write");
    const client = new Client({ name: "test-client", version: "0.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const preview = await client.callTool({ name: "offline_goal_update", arguments: { offline_goal_id: 42, name: "Рабочий renamed" } });
    const data = preview.structuredContent as { id: string; confirmation_statement: string; operation: string; preflight: { before: unknown } };
    expect(data).toMatchObject({ operation: "update_test_offline_goal", preflight: { before: { id: 42 } } });
    const executed = await client.callTool({ name: "write_execute", arguments: { preview_id: data.id, confirmation_statement: data.confirmation_statement } });
    expect(updates).toEqual([{ id: 42, name: "Рабочий renamed" }]);
    expect(executed.structuredContent).toMatchObject({ operation: "update_test_offline_goal", after: { reread: true } });

    await Promise.all([client.close(), server.close()]);
  });
});
