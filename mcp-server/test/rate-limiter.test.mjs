import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TokenRateLimiter } from "../dist/rate-limiter.js";

test("процессы с одним fingerprint резервируют разные интервалы", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vk-ads-rate-test-"));
  const pauses = [];
  try {
    const options = { credentialFingerprint: "a".repeat(64), directory, now: () => 1_000, sleep: async (milliseconds) => { pauses.push(milliseconds); } };
    const first = new TokenRateLimiter(options);
    const second = new TokenRateLimiter(options);
    await first.wait();
    await second.wait();
    assert.deepEqual(pauses, [1_000]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
