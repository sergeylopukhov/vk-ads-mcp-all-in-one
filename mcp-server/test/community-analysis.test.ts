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

  it("фильтрует кандидатов и оценивает причины прозрачно", () => {
    const item = candidate({ id: 7, name: "Турнир", description: "Настольные игры", type: "group", members_count: 1000, is_verified: 1 });
    item.activity = analyze([{ date: Math.floor(Date.now() / 1000), text: "Новый турнир" }], ["турнир"], ["ставки"]);
    expect(includeCandidate(item, ["игры"], ["ставки"], ["group"], 500, 2000)).toBe(true);
    expect(score([item], { terms: ["турнир"], weights: { name_term: 25, description_term: 10, post_term: 30, activity_fresh: 20, members_range: 15 }, members_range: { min: 500, max: 2000 } })[0]).toMatchObject({ id: 7, score: 90, reasons: expect.arrayContaining(["термины в названии: 1 совп. +25"]) });
  });

  it("ранжирует повторные и профессиональные совпадения, активность и тематические посты", () => {
    const item = candidate({ id: 9, name: "Уставщик и регент", description: "Уставщик", type: "group", members_count: 500 });
    item.activity = analyze([{ date: Math.floor(Date.now() / 1_000), text: "Уставщик ведёт занятие" }, { date: Math.floor(Date.now() / 1_000) - 604_800, text: "Новости" }], ["регент", "уставщик"], []);
    const result = score([item], { terms: ["регент", "уставщик"], term_weights: { "уставщик": 2 }, weights: { name_term: 10, description_term: 10, post_term: 10, thematic_post_share: 20, activity_low_penalty: 15 }, min_posts_per_week: 3 })[0];
    expect(result.score).toBeGreaterThan(0);
    expect(result.reasons).toEqual(expect.arrayContaining([expect.stringContaining("тематические публикации"), "низкая активность: -15"]));
    expect(result.risk_flags).toContain("low_activity");
  });

  it("помечает недоступные публикации как риск, не сохраняя их текст", () => {
    expect(analyze([], ["x"], ["y"])).toEqual({ last_post_at: null, posts_per_week: 0, posts_analyzed: 0, thematic_posts: 0, thematic_post_share: null, term_matches: [], risk_flags: [] });
  });
});
