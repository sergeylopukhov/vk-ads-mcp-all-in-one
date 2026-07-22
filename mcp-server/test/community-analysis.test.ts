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

  it("фильтрует кандидатов и оценивает причины прозрачно", () => {
    const item = candidate({ id: 7, name: "Турнир", description: "Настольные игры", type: "group", members_count: 1000, is_verified: 1 });
    item.activity = analyze([{ date: Math.floor(Date.now() / 1000), text: "Новый турнир" }], ["турнир"], ["ставки"]);
    expect(includeCandidate(item, ["игры"], ["ставки"], ["group"], 500, 2000)).toBe(true);
    expect(score([item], { terms: ["турнир"], weights: { name_term: 25, description_term: 10, post_term: 30, activity_fresh: 20, members_range: 15 }, members_range: { min: 500, max: 2000 } })[0]).toMatchObject({ id: 7, score: 90, reasons: expect.arrayContaining(["термин в названии: +25"]) });
  });

  it("помечает недоступные публикации как риск, не сохраняя их текст", () => {
    expect(analyze([], ["x"], ["y"])).toEqual({ last_post_at: null, posts_per_week: 0, term_matches: [], risk_flags: [] });
  });
});
