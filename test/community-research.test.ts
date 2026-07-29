import assert from "node:assert/strict";
import test from "node:test";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  DEFAULT_RECOMMENDATION_SCORE,
  DEFAULT_REVIEW_SCORE,
  registerVkCommunityTools,
  researchInputSchema,
} from "../src/community/tools.js";
import { CommunityResearchStore } from "../src/community/research-store.js";
import type {
  VkCommunity,
  VkCommunityClient,
} from "../src/community/vk-client.js";

test("high-level research ignores the removed legacy result limit", () => {
  const parsed = z.object(researchInputSchema).parse({
    keywords: ["церковное пение"],
    limit: 100,
  });

  assert.equal(Object.hasOwn(parsed, "limit"), false);
});

test("default recommendation and review thresholds are 45 and 30", () => {
  assert.equal(DEFAULT_RECOMMENDATION_SCORE, 45);
  assert.equal(DEFAULT_REVIEW_SCORE, 30);
});

test("one-call research analyzes every metadata-qualified community", async () => {
  const communities: VkCommunity[] = Array.from(
    { length: 143 },
    (_, index) => ({
      id: index + 1,
      name: `Церковное пение ${index + 1}`,
      description: "Сообщество о церковном пении",
      screen_name: `church_music_${index + 1}`,
      type: "group",
      members_count: 10_000 - index,
      is_closed: 0,
    }),
  );
  const registrations = new Map<string, unknown>();
  const server = {
    registerTool(name: string, _definition: unknown, handler: unknown) {
      registrations.set(name, handler);
    },
  } as unknown as McpServer;
  const client = {
    async searchPage(
      _query: string,
      offset: number,
      count: number,
    ) {
      return {
        count: communities.length,
        offset,
        items: communities.slice(offset, offset + count),
      };
    },
    async getByIds(ids: number[]) {
      const selected = new Set(ids);
      return communities.filter((item) => selected.has(item.id));
    },
    async wall() {
      return [];
    },
  } as unknown as VkCommunityClient;
  registerVkCommunityTools(server, {
    client,
    store: new CommunityResearchStore(
      "/tmp/vk-ads-mcp-community-regression.json",
      86_400_000,
    ),
  });
  const handler = registrations.get("vk_find_community_candidates") as (
    input: z.infer<ReturnType<typeof z.object<typeof researchInputSchema>>>,
  ) => Promise<{
    structuredContent: { items: unknown[] };
  }>;
  const input = z.object(researchInputSchema).parse({
    keywords: ["церковное пение"],
    limit: 100,
  });

  const response = await handler(input);

  assert.equal(response.structuredContent.items.length, 143);
});
