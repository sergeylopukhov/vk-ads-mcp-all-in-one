import type { CommunityType, VkCommunity, VkWallPost } from "./vk-community-client.js";

export interface Candidate { id: number; url: string; name: string; description: string; type: string | null; members_count: number | null; verified: boolean; retrieved_at: string; risk_flags: string[]; activity?: Activity | undefined }
export interface Activity { last_post_at: string | null; posts_per_week: number | null; term_matches: string[]; risk_flags: string[] }
export interface Score { id: number; score: number; clusters: string[]; reasons: string[]; risk_flags: string[] }

const normalized = (value: string) => value.toLocaleLowerCase("ru-RU");
export const matches = (text: string, terms: string[]) => terms.filter((term) => normalized(text).includes(normalized(term)));

export function candidate(value: VkCommunity, now = new Date().toISOString()): Candidate {
  const flags: string[] = [];
  if (value.is_closed && value.is_closed !== 0) flags.push("closed");
  if (value.deactivated) flags.push(value.deactivated);
  return { id: value.id, url: `https://vk.com/${value.screen_name || `club${value.id}`}`, name: value.name, description: value.description || "", type: value.type || null, members_count: value.members_count ?? null, verified: value.is_verified === 1 || value.is_verified === true, retrieved_at: now, risk_flags: flags };
}

export function includeCandidate(item: Candidate, include: string[], exclude: string[], types?: CommunityType[], min?: number, max?: number): boolean {
  const text = `${item.name}\n${item.description}`;
  return (!types?.length || (item.type !== null && types.includes(item.type as CommunityType)))
    && (min === undefined || (item.members_count !== null && item.members_count >= min))
    && (max === undefined || (item.members_count !== null && item.members_count <= max))
    && (!include.length || matches(text, include).length > 0)
    && matches(text, exclude).length === 0;
}

export function analyze(posts: VkWallPost[], terms: string[], excludes: string[]): Activity {
  const ordinary = posts.filter((post) => !post.is_pinned && !post.marked_as_ads && Number.isFinite(post.date));
  const dates = ordinary.map((post) => Number(post.date)).sort((a, b) => b - a);
  const newest = dates[0]; const oldest = dates.at(-1);
  const span = newest !== undefined && oldest !== undefined && dates.length > 1 ? Math.max(1, newest - oldest) : 0;
  const text = ordinary.map((post) => post.text || "").join("\n");
  const flags = matches(text, excludes).length ? ["exclude_term_in_posts"] : [];
  return { last_post_at: dates[0] ? new Date(dates[0] * 1000).toISOString() : null, posts_per_week: span ? Number((ordinary.length / (span / 604800)).toFixed(2)) : ordinary.length ? null : 0, term_matches: matches(text, terms), risk_flags: flags };
}

export function score(items: Candidate[], rules: Record<string, unknown>, clusters: Array<Record<string, unknown>> = [], now = Date.now()): Score[] {
  const weights = object(rules.weights);
  const terms = strings(rules.terms);
  const excludes = strings(rules.exclude_terms);
  const memberRange = object(rules.members_range);
  const freshDays = number(rules.activity_fresh_days, 30);
  const pass = number(rules.min_score, 0);
  return items.map((item) => {
    let value = 0; const reasons: string[] = []; const text = `${item.name}\n${item.description}`;
    const add = (key: string, yes: boolean, label: string) => { const weight = number(weights[key], 0); if (yes && weight) { value += weight; reasons.push(`${label}: +${weight}`); } };
    add("name_term", matches(item.name, terms).length > 0, "термин в названии");
    add("description_term", matches(item.description, terms).length > 0, "термин в описании");
    add("post_term", !!item.activity?.term_matches.length, "термин в публикациях");
    const fresh = item.activity?.last_post_at ? now - Date.parse(item.activity.last_post_at) <= freshDays * 86400000 : false;
    add("activity_fresh", fresh, "свежая активность");
    const min = typeof memberRange.min === "number" ? memberRange.min : undefined; const max = typeof memberRange.max === "number" ? memberRange.max : undefined;
    add("members_range", item.members_count !== null && (min === undefined || item.members_count >= min) && (max === undefined || item.members_count <= max), "размер сообщества");
    const penalty = number(weights.exclude_term_penalty, 0); if (matches(text, excludes).length && penalty) { value -= Math.abs(penalty); reasons.push(`исключающий термин: -${Math.abs(penalty)}`); }
    const risk_flags = [...item.risk_flags, ...(item.activity?.risk_flags || [])]; if (!fresh) risk_flags.push("inactive_or_no_posts");
    const clustersFound = clusters.filter((cluster) => {
      const include = strings(cluster.include_terms); const exclude = strings(cluster.exclude_terms); const minimum = number(cluster.min_score, 0);
      return value >= minimum && (!include.length || matches(text, include).length > 0) && matches(text, exclude).length === 0;
    }).map((cluster) => String(cluster.name)).filter(Boolean);
    if (value < pass) risk_flags.push("below_min_score");
    return { id: item.id, score: Math.max(0, Math.min(100, Math.round(value))), clusters: clustersFound, reasons, risk_flags: [...new Set(risk_flags)] };
  });
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function number(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
