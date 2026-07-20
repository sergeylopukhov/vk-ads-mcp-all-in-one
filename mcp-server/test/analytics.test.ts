import { describe, expect, it } from "vitest";

import { buildRecommendations, comparePeriods, detectAnomalies, diagnoseDelivery, findInefficientRows, rankRows } from "../src/analytics.js";
import { toolCatalog } from "../src/tool-catalog.js";

describe("аналитический слой", () => {
  it("ранжирует CTR по убыванию и CPC по возрастанию", () => {
    const rows = [{ id: 1, ctr: 1.2, cpc: 20 }, { id: 2, ctr: 2.1, cpc: 10 }];
    expect(rankRows(rows, "ctr").map((row) => row.id)).toEqual([2, 1]);
    expect(rankRows(rows, "cpc").map((row) => row.id)).toEqual([2, 1]);
  });

  it("сравнивает периоды и не делит на ноль", () => {
    expect(comparePeriods({ spent: 120, clicks: 0 }, { spent: 100, clicks: 0 })).toEqual([
      { metric: "clicks", current: 0, previous: 0, delta: 0, percent_change: null },
      { metric: "spent", current: 120, previous: 100, delta: 20, percent_change: 20 },
    ]);
  });

  it("возвращает причину неэффективности и безопасную рекомендацию", () => {
    const rows = [{ id: 1, name: "Тест", ctr: 0.4, cpc: 80, cpa: 400 }];
    expect(findInefficientRows(rows, { minCtr: 0.8, maxCpc: 50, maxCpa: 300 })[0]?.reasons).toHaveLength(3);
    expect(buildRecommendations(rows, { maxCpa: 300 })[0]).toMatchObject({ id: 1, priority: "high" });
  });

  it("не ограничивает каталог искусственным числом и не содержит повторов", () => {
    expect(toolCatalog.length).toBeGreaterThanOrEqual(100);
    expect(new Set(toolCatalog.map((tool) => tool.name)).size).toBe(toolCatalog.length);
    expect(toolCatalog.filter((tool) => tool.status !== "planned").length).toBeGreaterThanOrEqual(91);
  });

  it("находит выброс только при достаточной длине ряда", () => {
    const points = [10, 11, 10, 9, 10, 60].map((value, index) => ({ id: 1, date: `2026-07-0${index + 1}`, value }));
    expect(detectAnomalies(points)).toMatchObject([{ value: 60, direction: "high", baseline_median: 10 }]);
    expect(detectAnomalies(points.slice(0, 4))).toEqual([]);
  });

  it("объясняет проблемы delivery без изменения объектов", () => {
    expect(diagnoseDelivery([{ id: 1, status: "blocked", delivery: "not_delivering", moderation_status: "pending" }])).toMatchObject([
      { id: 1, reasons: [expect.stringContaining("blocked"), expect.stringContaining("not_delivering"), expect.stringContaining("ожидает")] },
    ]);
  });
});
