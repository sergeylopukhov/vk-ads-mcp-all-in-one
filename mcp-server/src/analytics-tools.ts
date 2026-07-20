import { z } from "zod";

import { buildRecommendations, comparePeriods, detectAnomalies, diagnoseDelivery, findInefficientRows, rankRows, type AnalyticsRow } from "./analytics.js";
import { VkAdsClient, type VkObject } from "./vk-client.js";

export const analyticsToolNames = [
  "analytics_compare_periods", "analytics_rank_campaigns", "analytics_find_inefficient_campaigns",
  "analytics_recommendations", "analytics_anomalies", "analytics_delivery_issues",
] as const;
export type AnalyticsToolName = (typeof analyticsToolNames)[number];

export const accountAuditInputSchema = z.object({
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  max_pages: z.number().int().min(1).max(10).default(3),
});

export async function buildAccountAudit(client: VkAdsClient, input: z.infer<typeof accountAuditInputSchema>): Promise<Record<string, unknown>> {
  const items: VkObject[] = [];
  let total = 0;
  for (let page = 0; page < input.max_pages; page += 1) {
    const response = await client.listAdPlans(page * 100, 100, ["id", "name", "status", "delivery"]);
    total = response.count;
    items.push(...response.items);
    if (items.length >= total || response.items.length === 0) break;
  }
  const ids = items.map((item) => item.id).filter((id): id is number => typeof id === "number" && Number.isInteger(id)).slice(0, 50);
  const statistics = ids.length === 0 ? { items: [], total: {} } : await client.getStatistics({ objectType: "ad_plans", period: "summary", ids, dateFrom: input.date_from, dateTo: input.date_to, metrics: "base" });
  const deliveryIssues = diagnoseDelivery(items.map((item) => ({
    id: typeof item.id === "string" || typeof item.id === "number" ? item.id : "unknown",
    ...(typeof item.name === "string" ? { name: item.name } : {}),
    ...(typeof item.status === "string" ? { status: item.status } : {}),
    ...(typeof item.delivery === "string" ? { delivery: item.delivery } : {}),
  })));
  return {
    period: { date_from: input.date_from, date_to: input.date_to }, scanned_ad_plans: items.length, total_ad_plans: total,
    data_complete: items.length >= total, limitation: items.length >= total ? null : `Достигнут лимит ${input.max_pages} страниц.`,
    facts: { statistics_total: statistics.total, statistics_items: statistics.items }, correlations: [], delivery_issues: deliveryIssues,
    recommendations: deliveryIssues.map((item) => ({ id: item.id, recommendation: "Проверить status, delivery и модерацию; изменений не выполнялось." })),
  };
}

export const analyticsRowSchema = z.object({
  id: z.union([z.string(), z.number()]), name: z.string().optional(), ctr: z.number().finite().optional(),
  cpc: z.number().finite().optional(), cpa: z.number().finite().optional(), spent: z.number().finite().optional(),
  clicks: z.number().finite().optional(), goals: z.number().finite().optional(),
});
export const analyticsThresholdsSchema = z.object({
  min_spent: z.number().finite().nonnegative().optional(), max_cpc: z.number().finite().nonnegative().optional(),
  max_cpa: z.number().finite().nonnegative().optional(), min_ctr: z.number().finite().nonnegative().optional(),
});
export const analyticsTimeSeriesPointSchema = z.object({
  id: z.union([z.string(), z.number()]), name: z.string().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), value: z.number().finite(),
});
export const deliveryDiagnosticInputSchema = z.object({
  id: z.union([z.string(), z.number()]), name: z.string().optional(), status: z.string().optional(),
  delivery: z.string().optional(), moderation_status: z.string().optional(),
});

export function runAnalyticsTool(name: AnalyticsToolName, args: Record<string, unknown>): Record<string, unknown> {
  switch (name) {
    case "analytics_compare_periods": {
      const { current, previous } = z.object({ current: z.record(z.string(), z.number().finite()), previous: z.record(z.string(), z.number().finite()) }).parse(args);
      return { items: comparePeriods(current, previous) };
    }
    case "analytics_rank_campaigns": {
      const { rows, metric } = z.object({ rows: z.array(analyticsRowSchema).min(1), metric: z.enum(["ctr", "cpc", "cpa", "spent"]) }).parse(args);
      return { items: rankRows(rows as AnalyticsRow[], metric) };
    }
    case "analytics_find_inefficient_campaigns": {
      const { rows, thresholds } = z.object({ rows: z.array(analyticsRowSchema).min(1), thresholds: analyticsThresholdsSchema }).parse(args);
      return { items: findInefficientRows(rows as AnalyticsRow[], toThresholds(thresholds)) };
    }
    case "analytics_recommendations": {
      const { rows, thresholds } = z.object({ rows: z.array(analyticsRowSchema).min(1), thresholds: analyticsThresholdsSchema }).parse(args);
      return { items: buildRecommendations(rows as AnalyticsRow[], toThresholds(thresholds)) };
    }
    case "analytics_anomalies": {
      const { points, threshold } = z.object({ points: z.array(analyticsTimeSeriesPointSchema).min(5).max(10_000), threshold: z.number().finite().min(1).max(20).default(3.5) }).parse(args);
      return { items: detectAnomalies(points, threshold) };
    }
    case "analytics_delivery_issues": {
      const { items } = z.object({ items: z.array(deliveryDiagnosticInputSchema).min(1).max(10_000) }).parse(args);
      return { items: diagnoseDelivery(items) };
    }
  }
}

function toThresholds(thresholds: z.infer<typeof analyticsThresholdsSchema>) {
  return {
    ...(thresholds.min_spent !== undefined ? { minSpent: thresholds.min_spent } : {}),
    ...(thresholds.max_cpc !== undefined ? { maxCpc: thresholds.max_cpc } : {}),
    ...(thresholds.max_cpa !== undefined ? { maxCpa: thresholds.max_cpa } : {}),
    ...(thresholds.min_ctr !== undefined ? { minCtr: thresholds.min_ctr } : {}),
  };
}
