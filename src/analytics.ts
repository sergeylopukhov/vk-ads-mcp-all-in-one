export type MetricName = "ctr" | "cpc" | "cpa" | "spent";

export interface AnalyticsRow {
  id: string | number;
  name?: string | undefined;
  ctr?: number | undefined;
  cpc?: number | undefined;
  cpa?: number | undefined;
  spent?: number | undefined;
  clicks?: number | undefined;
  goals?: number | undefined;
}

export interface RankedRow extends AnalyticsRow {
  metric_value: number;
  rank: number;
}

function finite(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function metricValue(row: AnalyticsRow, metric: MetricName): number | undefined {
  return finite(row[metric]);
}

export function rankRows(rows: AnalyticsRow[], metric: MetricName): RankedRow[] {
  const descending = metric === "ctr" || metric === "spent";
  return rows
    .flatMap((row) => {
      const value = metricValue(row, metric);
      return value === undefined ? [] : [{ ...row, metric_value: value }];
    })
    .sort((left, right) => (descending ? right.metric_value - left.metric_value : left.metric_value - right.metric_value))
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

export function comparePeriods(
  current: Record<string, number>,
  previous: Record<string, number>,
): Array<{ metric: string; current: number; previous: number; delta: number; percent_change: number | null }> {
  const metrics = new Set([...Object.keys(current), ...Object.keys(previous)]);
  return [...metrics].sort().flatMap((metric) => {
    const currentValue = finite(current[metric]);
    const previousValue = finite(previous[metric]);
    if (currentValue === undefined || previousValue === undefined) return [];
    const delta = currentValue - previousValue;
    return [{
      metric,
      current: currentValue,
      previous: previousValue,
      delta,
      percent_change: previousValue === 0 ? null : (delta / previousValue) * 100,
    }];
  });
}

export function findInefficientRows(
  rows: AnalyticsRow[],
  thresholds: { minSpent?: number; maxCpc?: number; maxCpa?: number; minCtr?: number },
): Array<AnalyticsRow & { reasons: string[] }> {
  return rows.flatMap((row) => {
    const reasons: string[] = [];
    const spent = finite(row.spent);
    if (thresholds.minSpent !== undefined && spent !== undefined && spent < thresholds.minSpent) reasons.push("Расход ниже минимального порога.");
    if (thresholds.maxCpc !== undefined && finite(row.cpc) !== undefined && row.cpc! > thresholds.maxCpc) reasons.push("CPC выше допустимого порога.");
    if (thresholds.maxCpa !== undefined && finite(row.cpa) !== undefined && row.cpa! > thresholds.maxCpa) reasons.push("CPA выше допустимого порога.");
    if (thresholds.minCtr !== undefined && finite(row.ctr) !== undefined && row.ctr! < thresholds.minCtr) reasons.push("CTR ниже минимального порога.");
    return reasons.length === 0 ? [] : [{ ...row, reasons }];
  });
}

export interface Recommendation {
  id: string | number;
  name?: string | undefined;
  priority: "high" | "medium";
  recommendation: string;
}

export interface TimeSeriesPoint {
  id: string | number;
  date: string;
  value: number;
  name?: string | undefined;
}

export interface DetectedAnomaly extends TimeSeriesPoint {
  baseline_median: number;
  robust_z_score: number;
  direction: "high" | "low";
}

export interface DeliveryDiagnostic {
  id: string | number;
  name?: string | undefined;
  status?: string | undefined;
  delivery?: string | undefined;
  moderation_status?: string | undefined;
  reasons: string[];
}

export function diagnoseDelivery(items: Array<Omit<DeliveryDiagnostic, "reasons">>): DeliveryDiagnostic[] {
  return items.flatMap((item) => {
    const reasons: string[] = [];
    if (item.status === "blocked") reasons.push("Объект остановлен: status=blocked.");
    if (item.status === "deleted") reasons.push("Объект удалён: status=deleted.");
    if (item.delivery && item.delivery !== "delivering") reasons.push(`Нет активной доставки: delivery=${item.delivery}.`);
    if (item.moderation_status === "banned") reasons.push("Модерация отклонила объект.");
    if (item.moderation_status === "pending") reasons.push("Объект ожидает модерацию.");
    return reasons.length === 0 ? [] : [{ ...item, reasons }];
  });
}

function median(values: number[]): number {
  if (values.length === 0) throw new Error("Median требует хотя бы одно значение.");
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) throw new Error("Median не смог получить значение.");
  if (sorted.length % 2 !== 0) return upper;
  const lower = sorted[middle - 1];
  if (lower === undefined) throw new Error("Median не смог получить значение.");
  return (lower + upper) / 2;
}

/** Ищет выбросы методом median absolute deviation; не делает статистических выводов при <5 точках. */
export function detectAnomalies(points: TimeSeriesPoint[], threshold = 3.5): DetectedAnomaly[] {
  const grouped = new Map<string | number, TimeSeriesPoint[]>();
  for (const point of points) grouped.set(point.id, [...(grouped.get(point.id) ?? []), point]);
  const anomalies: DetectedAnomaly[] = [];
  for (const series of grouped.values()) {
    if (series.length < 5) continue;
    const baseline = median(series.map((point) => point.value));
    const mad = median(series.map((point) => Math.abs(point.value - baseline)));
    for (const point of series) {
      const z = mad === 0
        ? (point.value === baseline ? 0 : (point.value > baseline ? threshold : -threshold))
        : 0.6745 * (point.value - baseline) / mad;
      if (Math.abs(z) >= threshold) {
        anomalies.push({ ...point, baseline_median: baseline, robust_z_score: z, direction: z > 0 ? "high" : "low" });
      }
    }
  }
  return anomalies.sort((left, right) => Math.abs(right.robust_z_score) - Math.abs(left.robust_z_score));
}

export function buildRecommendations(
  rows: AnalyticsRow[],
  thresholds: { maxCpc?: number; maxCpa?: number; minCtr?: number },
): Recommendation[] {
  return rows.flatMap<Recommendation>((row) => {
    if (thresholds.maxCpa !== undefined && finite(row.cpa) !== undefined && row.cpa! > thresholds.maxCpa) {
      return [{ id: row.id, ...(row.name ? { name: row.name } : {}), priority: "high" as const, recommendation: "Проверить оффер, аудиторию и посадочную страницу: CPA выше целевого порога." }];
    }
    if (thresholds.maxCpc !== undefined && finite(row.cpc) !== undefined && row.cpc! > thresholds.maxCpc) {
      return [{ id: row.id, ...(row.name ? { name: row.name } : {}), priority: "medium" as const, recommendation: "Проверить ставку, креатив и сегмент: CPC выше целевого порога." }];
    }
    if (thresholds.minCtr !== undefined && finite(row.ctr) !== undefined && row.ctr! < thresholds.minCtr) {
      return [{ id: row.id, ...(row.name ? { name: row.name } : {}), priority: "medium" as const, recommendation: "Обновить креатив или уточнить таргетинг: CTR ниже минимального порога." }];
    }
    return [];
  });
}
