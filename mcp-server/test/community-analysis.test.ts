import { describe, expect, it } from "vitest";
import { analyze, candidate, includeCandidate, score } from "../src/community-analysis.js";
import { VkCommunityClient } from "../src/vk-community-client.js";

describe("сообщества VK", () => {
  it("кеширует metadata, дедуплицирует ID и не отдаёт лишние поля", async () => {
    let calls = 0;
    let request: { url: string; authorization: string | null } | undefined;
    const client = new VkCommunityClient({ tokenProvider: () => "token", timeoutMs: 1000, fetchImplementation: async (url, init) => {
      calls += 1;
      request = { url: String(url), authorization: new Headers(init?.headers).get("authorization") };
      return new Response(JSON.stringify({ response: [{ id: 7, name: "Клуб", screen_name: "club", members_count: 123, description: "Описание", is_verified: 1, users: [1] }] }));
    } });
    expect(await client.getByIds([7, 7])).toMatchObject([{ id: 7, name: "Клуб", members_count: 123 }]);
    await client.getByIds([7]);
    expect(calls).toBe(1);
    expect(request).toMatchObject({ authorization: "Bearer token" });
    expect(request?.url).not.toContain("access_token");
  });

  it("поддерживает legacy OAuth и актуальный формат groups.getById", async () => {
    let request: { url: string; authorization: string | null } | undefined;
    const client = new VkCommunityClient({ tokenProvider: () => "legacy-token", tokenType: "legacy", timeoutMs: 1000, fetchImplementation: async (url, init) => {
      request = { url: String(url), authorization: new Headers(init?.headers).get("authorization") };
      return new Response(JSON.stringify({ response: { groups: [{ id: 8, name: "Клуб" }] } }));
    } });
    await expect(client.getByIds([8])).resolves.toMatchObject([{ id: 8, name: "Клуб" }]);
    expect(request?.url).toContain("https://api.vk.com/method/groups.getById");
    expect(request?.url).toContain("access_token=legacy-token");
    expect(request?.authorization).toBeNull();
  });

  it("запрашивает поиск по числу участников только когда это явно выбрано", async () => {
    let requestUrl = "";
    const client = new VkCommunityClient({ tokenProvider: () => "token", timeoutMs: 1000, fetchImplementation: async (url) => {
      requestUrl = String(url);
      return new Response(JSON.stringify({ response: { count: 0, items: [] } }));
    } });
    await client.searchPage("курсы", 0, 100, undefined, undefined, undefined, "members");
    expect(new URL(requestUrl).searchParams.get("sort")).toBe("1");
  });

  it("фильтрует кандидатов и оценивает причины прозрачно", () => {
    const item = candidate({ id: 7, name: "Турнир", description: "Настольные игры", type: "group", members_count: 1000, is_verified: 1 });
    item.activity = analyze([{ date: Math.floor(Date.now() / 1000), text: "Новый турнир" }], ["турнир"], ["ставки"]);
    expect(includeCandidate(item, ["игры"], ["ставки"], ["group"], 500, 2000)).toBe(true);
    expect(score([item], { terms: ["турнир"], weights: { name_term: 25, description_term: 10, post_term: 30, activity_fresh: 20, members_range: 15 }, per_match_weights: { name_term: 25, description_term: 10, post_term: 30 }, members_range: { min: 500, max: 2000 } })[0]).toMatchObject({ id: 7, score: 90, reasons: expect.arrayContaining(["термины в названии: 1 совп. +25 из 25"]) });
  });

  it("ранжирует повторные и профессиональные совпадения, активность и тематические посты", () => {
    const item = candidate({ id: 9, name: "Уставщик и регент", description: "Уставщик", type: "group", members_count: 500 });
    item.activity = analyze([{ date: Math.floor(Date.now() / 1_000), text: "Уставщик ведёт занятие" }, { date: Math.floor(Date.now() / 1_000) - 604_800, text: "Новости" }], ["регент", "уставщик"], []);
    const result = score([item], { terms: ["регент", "уставщик"], term_weights: { "уставщик": 2 }, per_match_weights: { name_term: 5, description_term: 5, post_term: 5 }, weights: { name_term: 10, description_term: 10, post_term: 10, thematic_post_share: 20, activity_low_penalty: 15 }, min_posts_per_week: 3 })[0];
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons).toEqual(expect.arrayContaining([expect.stringContaining("тематические публикации"), "низкая активность: -15"]));
    expect(result.risk_flags).toContain("low_activity");
  });

  it("ограничивает вклад большого числа совпадений потолком сигнала", () => {
    const item = candidate({ id: 10, name: "Курсы", description: Array(20).fill("регент").join(" "), type: "group", members_count: 100 });
    const result = score([item], { terms: ["регент"], per_match_weights: { description_term: 5 }, weights: { description_term: 25 } })[0];
    expect(result.score).toBe(25);
    expect(result.reasons).toContain("термины в описании: 20 совп. +25 из 25");
  });

  it("штрафует слабую тематичность и не относит рискованный результат к строгому кластеру", () => {
    const item = candidate({ id: 11, name: "Регентские курсы", description: "Обучение", type: "group", members_count: 100 });
    item.activity = { last_post_at: new Date().toISOString(), posts_per_week: 2, posts_analyzed: 10, thematic_posts: 2, thematic_post_share: 0.2, term_matches: ["регент"], risk_flags: [] };
    const result = score([item], {
      terms: ["регент"],
      weights: { name_term: 20, thematic_post_share: 20, thematic_low_penalty: 15 },
      per_match_weights: { name_term: 10 },
      min_thematic_post_share: 0.5,
      min_score: 60,
      review_min_score: 45,
    }, [{ name: "strict", include_terms: ["регент"], min_score: 0, min_thematic_post_share: 0.5, require_no_risk_flags: true }])[0];
    expect(result).toMatchObject({ recommendation: "rejected", clusters: [] });
    expect(result.reasons).toContain("низкая тематичность: -15");
    expect(result.risk_flags).toContain("low_thematic_post_share");
  });

  it("помечает недоступные публикации как риск, не сохраняя их текст", () => {
    expect(analyze([], ["x"], ["y"])).toEqual({ last_post_at: null, posts_per_week: 0, posts_analyzed: 0, thematic_posts: 0, thematic_post_share: null, term_matches: [], risk_flags: [] });
  });
});
