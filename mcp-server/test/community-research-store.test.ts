import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { CommunityResearchStore } from "../src/community-research-store.js";

describe("снимки исследований сообществ", () => {
  it("сохраняет и возвращает снимок до истечения TTL", async () => {
    const directory = await mkdtemp(join(tmpdir(), "vk-community-research-"));
    try {
      let time = Date.parse("2026-07-22T12:00:00.000Z");
      const store = new CommunityResearchStore(join(directory, "runs.json"), 24 * 60 * 60 * 1_000, () => time);
      const run = { run_id: "00000000-0000-4000-8000-000000000001", created_at: new Date(time).toISOString(), expires_at: store.expiresAt(), request: { keywords: ["регент"] }, passed: [], rejected: [] };

      await store.save(run);
      await expect(store.get(run.run_id)).resolves.toEqual(run);

      time += 24 * 60 * 60 * 1_000;
      await expect(store.get(run.run_id)).rejects.toThrow("не найден");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
