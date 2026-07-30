import assert from "node:assert/strict";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import {
  BANNER_GET_TOOL,
  BANNERS_LIST_TOOL,
  createVkAdsMcpServer,
} from "../src/server.js";
import {
  VkAdsApiClient,
  type VkAdsBanner,
} from "../src/vk-ads/client.js";

const creativeBanner: VkAdsBanner = {
  id: 101,
  adGroupId: 202,
  created: "2026-07-30 10:00:00",
  updated: "2026-07-30 11:00:00",
  name: "Креатив",
  status: "active",
  delivery: "delivering",
  moderationStatus: "allowed",
  ordMarker: "erid-example",
  content: {
    image: {
      id: 303,
      type: "static",
      variants: {
        original: {
          width: 1080,
          height: 607,
          size: 123456,
          url: "https://cdn.example/image.jpg",
        },
      },
    },
    video: {
      id: 304,
      type: "video",
      variants: {
        landscape: {
          width: 1920,
          height: 1080,
          size: 987654,
          url: "https://cdn.example/video.mp4",
        },
      },
    },
  },
  textblocks: {
    title_25: { title: "Заголовок" },
    text_90: { text: "Текст объявления" },
    button: { text: "Узнать больше" },
  },
  urls: {
    primary: {
      id: 404,
      url: "https://example.com/landing",
      urlObjectId: "505",
      urlObjectType: "site",
      urlTypes: ["external"],
    },
  },
};

const sparseBanner: VkAdsBanner = {
  id: 102,
  adGroupId: 202,
  status: "deleted",
};

async function createClient(banners: VkAdsBanner[]) {
  const provider = {
    async listBanners() {
      return { count: banners.length, offset: 0, items: banners };
    },
    async getBanner(id: number) {
      const banner = banners.find((item) => item.id === id);
      assert.ok(banner);
      return banner;
    },
  };
  const server = createVkAdsMcpServer(provider as never, {
    async ensureReady() {},
    async record() {},
  });
  const client = new Client({ name: "banner-contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

test("banners list returns complete nested creative data and old fields", async () => {
  const client = await createClient([creativeBanner, sparseBanner]);
  const response = await client.callTool({
    name: BANNERS_LIST_TOOL,
    arguments: {},
  });

  assert.equal(response.isError, undefined);
  const result = response.structuredContent as {
    items: VkAdsBanner[];
  };
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]?.id, 101);
  assert.equal(result.items[0]?.name, "Креатив");
  assert.equal(result.items[0]?.status, "active");
  assert.equal(result.items[0]?.moderationStatus, "allowed");
  assert.equal(result.items[0]?.textblocks?.button?.text, "Узнать больше");
  assert.equal(result.items[0]?.urls?.primary?.url, "https://example.com/landing");
  assert.equal(result.items[0]?.content?.video?.variants.landscape.width, 1920);
  assert.equal(result.items[0]?.ordMarker, "erid-example");
  assert.deepEqual(result.items[1], sparseBanner);
});

test("banner get returns the same complete object for one ad", async () => {
  const client = await createClient([creativeBanner]);
  const response = await client.callTool({
    name: BANNER_GET_TOOL,
    arguments: { id: 101 },
  });

  assert.equal(response.isError, undefined);
  assert.deepEqual(response.structuredContent, creativeBanner);
});

test("banner client requests and normalizes the documented creative fields", async () => {
  const requests: string[] = [];
  const rawBanner = {
    id: 101,
    ad_group_id: 202,
    created: "2026-07-30 10:00:00",
    updated: "2026-07-30 11:00:00",
    name: "Креатив",
    status: "active",
    delivery: "delivering",
    issues: [],
    moderation_reasons: [],
    moderation_status: "allowed",
    ord_marker: "erid-example",
    content: creativeBanner.content,
    textblocks: {
      title_25: { title: "Заголовок" },
      text_90: { text: "Текст объявления" },
    },
    urls: {
      primary: {
        id: 404,
        url: "https://example.com/landing",
        url_object_id: "505",
        url_object_type: "site",
        url_types: ["external"],
      },
    },
  };
  const client = new VkAdsApiClient(
    {
      async getAccessToken() { return "test-token"; },
      async refreshAfterAuthenticationFailure() { return "test-token"; },
    } as never,
    {
      v2BaseUrl: "https://ads.example/api/v2",
      fetchImpl: async (input) => {
        const requestUrl = String(input);
        requests.push(requestUrl);
        const payload = requestUrl.includes("/banners/101.json")
          ? rawBanner
          : { count: 1, offset: 0, items: [rawBanner] };
        return new Response(JSON.stringify({
          ...payload,
        }), { status: 200, headers: { "content-type": "application/json" } });
      },
    },
  );

  const list = await client.listBanners();
  const banner = await client.getBanner(101);
  const expectedFields = [
    "id", "created", "updated", "name", "status", "ad_group_id",
    "content", "delivery", "issues", "moderation_reasons",
    "moderation_status", "textblocks", "urls", "ord_marker",
  ].join(",");

  assert.equal(new URL(requests[0]!).searchParams.get("fields"), expectedFields);
  assert.equal(new URL(requests[1]!).searchParams.get("fields"), expectedFields);
  assert.equal(list.items[0]?.textblocks?.title_25?.title, "Заголовок");
  assert.equal(list.items[0]?.urls?.primary?.urlObjectId, "505");
  assert.equal(list.items[0]?.ordMarker, "erid-example");
  assert.deepEqual(banner, list.items[0]);
});
