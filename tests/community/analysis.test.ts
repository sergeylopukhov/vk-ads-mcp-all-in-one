import { describe, expect, it } from "vitest";

import {
  analyze,
  candidate,
  includeCandidate,
  score,
} from "../../src/community/analysis.js";
import { VkCommunityClient } from "../../src/community/vk-client.js";

describe("community analysis", () => {
  it("caches metadata, deduplicates IDs and keeps Core VK token in header", async () => {
    let calls = 0;
    let request:
      | { url: string; authorization: string | null }
      | undefined;
    const client = new VkCommunityClient({
      tokenProvider: () => "token",
      timeoutMs: 1_000,
      fetchImplementation: async (url, init) => {
        calls += 1;
        request = {
          url: String(url),
          authorization: new Headers(init?.headers).get("authorization"),
        };
        return new Response(
          JSON.stringify({
            response: [
              {
                id: 7,
                name: "Клуб",
                screen_name: "club",
                members_count: 123,
                description: "Описание",
                is_verified: 1,
                users: [1],
              },
            ],
          }),
        );
      },
    });

    await expect(client.getByIds([7, 7])).resolves.toMatchObject([
      { id: 7, name: "Клуб", members_count: 123 },
    ]);
    await client.getByIds([7]);
    expect(calls).toBe(1);
    expect(request).toMatchObject({ authorization: "Bearer token" });
    expect(request?.url).not.toContain("access_token");
  });

  it("supports legacy OAuth response shape", async () => {
    let requestUrl = "";
    const client = new VkCommunityClient({
      tokenProvider: () => "legacy-token",
      tokenType: "legacy",
      timeoutMs: 1_000,
      fetchImplementation: async (url) => {
        requestUrl = String(url);
        return new Response(
          JSON.stringify({
            response: { groups: [{ id: 8, name: "Клуб" }] },
          }),
        );
      },
    });

    await expect(client.getByIds([8])).resolves.toMatchObject([
      { id: 8, name: "Клуб" },
    ]);
    expect(requestUrl).toContain("https://api.vk.com/method/groups.getById");
    expect(requestUrl).toContain("access_token=legacy-token");
  });

  it("refreshes a rejected VK ID token once and retries the request", async () => {
    let token = "expired-token";
    let calls = 0;
    const client = new VkCommunityClient({
      tokenProvider: () => token,
      timeoutMs: 1_000,
      refreshAfterAuthenticationFailure: async () => {
        token = "replacement-token";
        return token;
      },
      fetchImplementation: async (_url, init) => {
        calls += 1;
        const authorization = new Headers(init?.headers).get(
          "authorization",
        );
        if (authorization === "Bearer expired-token") {
          return new Response(
            JSON.stringify({
              error: { error_code: 5, error_msg: "User authorization failed" },
            }),
            { status: 401 },
          );
        }
        expect(authorization).toBe("Bearer replacement-token");
        return new Response(
          JSON.stringify({
            response: { groups: [{ id: 9, name: "Сообщество" }] },
          }),
        );
      },
    });

    await expect(client.getByIds([9])).resolves.toMatchObject([
      { id: 9, name: "Сообщество" },
    ]);
    expect(calls).toBe(2);
  });

  it("filters candidates and scores transparent reasons", () => {
    const item = candidate({
      id: 7,
      name: "Турнир",
      description: "Настольные игры",
      type: "group",
      members_count: 1_000,
      is_verified: 1,
    });
    item.activity = analyze(
      [{ date: Math.floor(Date.now() / 1_000), text: "Новый турнир" }],
      ["турнир"],
      ["ставки"],
    );

    expect(
      includeCandidate(
        item,
        ["игры"],
        ["ставки"],
        ["group"],
        500,
        2_000,
      ),
    ).toBe(true);
    expect(
      score([
        item,
      ], {
        terms: ["турнир"],
        weights: {
          name_term: 25,
          description_term: 10,
          post_term: 30,
          activity_fresh: 20,
          members_range: 15,
        },
        per_match_weights: {
          name_term: 25,
          description_term: 10,
          post_term: 30,
        },
        members_range: { min: 500, max: 2_000 },
      })[0],
    ).toMatchObject({
      id: 7,
      score: 90,
      reasons: expect.arrayContaining([
        "термины в названии: 1 совп. +25 из 25",
      ]),
    });
  });
});
