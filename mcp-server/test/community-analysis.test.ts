import { describe, expect, it } from "vitest";
import { analyze, candidate, includeCandidate, score } from "../src/community-analysis.js";
import { VkCommunityClient } from "../src/vk-community-client.js";

describe("сообщества VK", () => {
  it("кеширует metadata, дедуплицирует ID и не отдаёт лишние поля", async () => {
    let calls = 0;
    const client = new VkCommunityClient({ tokenProvider: () => "token", timeoutMs: 1000, fetchImplementation: async () => {
      calls += 1; return new Response(JSON.stringify({ response: [{ id: 7, name: "Клуб", screen_name: "club", members_count: 123, description: "Описание", is_verified: 1, users: [1] }] }));
    } });
    expect(await client.getByIds([7, 7])).toMatchObject([{ id: 7, name: "Клуб", members_count: 123 }]);
    await client.getByIds([7]);
    expect(calls).toBe(1);
  });

  it("отправляет добавление сообществ в сегмент только фиксированным Core VK API методом", async () => {
    let request: { url: string; method: string; body: string } | undefined;
    const client = new VkCommunityClient({ tokenProvider: () => "token", timeoutMs: 1000, adsAccountId: 9, fetchImplementation: async (url, init) => {
      request = { url: String(url), method: init?.method ?? "GET", body: String(init?.body ?? "") };
      return new Response(JSON.stringify({ response: 1 }));
    } });
    await expect(client.addCommunitiesToTargetGroup(42, [7, 7, 8])).resolves.toEqual({ id: 42 });
    expect(request?.url).toBe("https://api.vk.com/method/ads.updateTargetGroup");
    expect(request?.method).toBe("POST");
    expect(request?.body).toContain("target_group_id=42");
    expect(request?.body).toContain("account_id=9");
    expect(request?.body).toContain("group_ids=7%2C8");
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
