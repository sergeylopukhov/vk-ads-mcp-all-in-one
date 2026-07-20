import assert from "node:assert/strict";
import test from "node:test";

import { VkAdsApiError, VkAdsClient } from "../dist/vk-client.js";

function clientWith(responses, options = {}) {
  let index = 0;
  return new VkAdsClient({
    tokenProvider: () => "old-token",
    timeoutMs: 1_000,
    fetchImplementation: async () => responses[index++],
    ...options,
  });
}

test("GET обновляет токен после 401", async () => {
  const tokens = [];
  const client = new VkAdsClient({
    tokenProvider: () => "old-token",
    tokenRefresher: async () => "new-token",
    timeoutMs: 1_000,
    fetchImplementation: async (_url, init) => {
      tokens.push(new Headers(init.headers).get("authorization"));
      return tokens.length === 1
        ? new Response("{}", { status: 401 })
        : new Response(JSON.stringify({ id: 7 }), { status: 200 });
    },
  });
  assert.deepEqual(await client.getUser(), { id: 7 });
  assert.deepEqual(tokens, ["Bearer old-token", "Bearer new-token"]);
});

test("GET повторяет 429 один раз с Retry-After", async () => {
  const pauses = [];
  const client = clientWith([
    new Response("{}", { status: 429, headers: { "retry-after": "2" } }),
    new Response(JSON.stringify({ id: 7 }), { status: 200 }),
  ], { sleep: async (milliseconds) => { pauses.push(milliseconds); } });
  assert.deepEqual(await client.getUser(), { id: 7 });
  assert.deepEqual(pauses, [2_000]);
});

test("GET возвращает типизированную ошибку HTTP", async () => {
  const client = clientWith([new Response("{}", { status: 403 })]);
  await assert.rejects(() => client.getUser(), (error) => error instanceof VkAdsApiError && error.status === 403);
});

test("GET отклоняет не-JSON ответ", async () => {
  const client = clientWith([new Response("not-json", { status: 200 })]);
  await assert.rejects(() => client.getUser());
});
