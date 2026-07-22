import type { CommunityType, VkCommunity, VkWallPost } from "./vk-community-client.js";

export interface Candidate { id: number; url: string; name: string; description: string; type: string | null; members_count: number | null; verified: boolean; retrieved_at: string; risk_flags: string[]; activity?: Activity | undefined }
export interface Activity { last_post_at: string | null; posts_per_week: number | null; posts_analyzed: number; thematic_posts: number; thematic_post_share: number | null; term_matches: string[]; risk_flags: string[] }
export interface Score { id: number; score: number; recommendation: "recommended" | "review" | "rejected"; clusters: string[]; reasons: string[]; risk_flags: string[] }

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
  const thematicPosts = ordinary.filter((post) => matches(post.text || "", terms).length > 0).length;
  const flags = matches(text, excludes).length ? ["exclude_term_in_posts"] : [];
  return { last_post_at: dates[0] ? new Date(dates[0] * 1000).toISOString() : null, posts_per_week: span ? Number((ordinary.length / (span / 604800)).toFixed(2)) : ordinary.length ? null : 0, posts_analyzed: ordinary.length, thematic_posts: thematicPosts, thematic_post_share: ordinary.length ? Number((thematicPosts / ordinary.length).toFixed(3)) : null, term_matches: matches(text, terms), risk_flags: flags };
}

export function score(items: Candidate[], rules: Record<string, unknown>, clusters: Array<Record<string, unknown>> = [], now = Date.now()): Score[] {
  const weights = object(rules.weights);
  const terms = strings(rules.terms);
  const excludes = strings(rules.exclude_terms);
  const memberRange = object(rules.members_range);
  const termWeights = object(rules.term_weights);
  const perMatchWeights = object(rules.per_match_weights);
  const freshDays = number(rules.activity_fresh_days, 30);
  const minPostsPerWeek = number(rules.min_posts_per_week, 0);
  const minThematicShare = number(rules.min_thematic_post_share, 0);
  const pass = number(rules.min_score, 0);
  const reviewMin = Math.min(pass, number(rules.review_min_score, Math.min(pass, 45)));
  return items.map((item) => {
    let value = 0; const reasons: string[] = []; const text = `${item.name}\n${item.description}`;
    const add = (key: string, yes: boolean, label: string) => { const weight = number(weights[key], 0); if (yes && weight) { value += weight; reasons.push(`${label}: +${weight}`); } };
    const addMatches = (key: string, source: string, label: string) => {
      const limit = number(weights[key], 0); const matched = weightedOccurrences(source, terms, termWeights); const perMatch = number(perMatchWeights[key], 1);
      if (limit && matched.score) { const points = Math.min(limit, matched.score * perMatch); value += points; reasons.push(`${label}: ${matched.count} совп. +${formatPoints(points)} из ${limit}`); }
    };
    addMatches("name_term", item.name, "термины в названии");
    addMatches("description_term", item.description, "термины в описании");
    addMatches("post_term", item.activity?.term_matches.join(" ") || "", "термины в публикациях");
    const fresh = item.activity?.last_post_at ? now - Date.parse(item.activity.last_post_at) <= freshDays * 86400000 : false;
    add("activity_fresh", fresh, "свежая активность");
    const min = typeof memberRange.min === "number" ? memberRange.min : undefined; const max = typeof memberRange.max === "number" ? memberRange.max : undefined;
    add("members_range", item.members_count !== null && (min === undefined || item.members_count >= min) && (max === undefined || item.members_count <= max), "размер сообщества");
    const thematicShare = item.activity?.thematic_post_share;
    const thematicWeight = number(weights.thematic_post_share, 0); if (thematicWeight && thematicShare !== null && thematicShare !== undefined) { const points = thematicWeight * thematicShare; value += points; reasons.push(`тематические публикации: ${Math.round(thematicShare * 100)}% +${formatPoints(points)}`); }
    const lowThematic = thematicShare !== null && thematicShare !== undefined && thematicShare < minThematicShare;
    const lowThematicPenalty = number(weights.thematic_low_penalty, 0); if (lowThematic && lowThematicPenalty) { value -= lowThematicPenalty; reasons.push(`низкая тематичность: -${lowThematicPenalty}`); }
    const penalty = number(weights.exclude_term_penalty, 0); if (matches(text, excludes).length && penalty) { value -= Math.abs(penalty); reasons.push(`исключающий термин: -${Math.abs(penalty)}`); }
    const lowActivity = item.activity?.posts_per_week !== null && item.activity?.posts_per_week !== undefined && item.activity.posts_per_week < minPostsPerWeek;
    const lowActivityPenalty = number(weights.activity_low_penalty, 0); if (lowActivity && lowActivityPenalty) { value -= lowActivityPenalty; reasons.push(`низкая активность: -${lowActivityPenalty}`); }
    const risk_flags = [...item.risk_flags, ...(item.activity?.risk_flags || [])]; if (!fresh) risk_flags.push("inactive_or_no_posts"); if (lowActivity) risk_flags.push("low_activity"); if (lowThematic) risk_flags.push("low_thematic_post_share");
    const finalScore = Math.max(0, Math.min(100, Math.round(value)));
    const clustersFound = clusters.filter((cluster) => {
      const include = strings(cluster.include_terms); const exclude = strings(cluster.exclude_terms); const minimum = number(cluster.min_score, 0); const mode = cluster.match_mode === "all" ? "all" : "any";
      const clusterText = `${text}\n${item.activity?.term_matches.join("\n") || ""}`;
      const included = !include.length || (mode === "all" ? include.every((term) => matches(clusterText, [term]).length > 0) : matches(clusterText, include).length > 0);
      const enoughThematic = thematicShare === null || thematicShare === undefined || thematicShare >= number(cluster.min_thematic_post_share, 0);
      const enoughActivity = item.activity?.posts_per_week === null || item.activity?.posts_per_week === undefined || item.activity.posts_per_week >= number(cluster.min_posts_per_week, 0);
      const forbiddenRisks = strings(cluster.exclude_risk_flags);
      return finalScore >= minimum && included && matches(clusterText, exclude).length === 0 && enoughThematic && enoughActivity && (!cluster.require_no_risk_flags || !risk_flags.length) && !forbiddenRisks.some((flag) => risk_flags.includes(flag));
    }).map((cluster) => String(cluster.name)).filter(Boolean);
    if (finalScore < pass) risk_flags.push("below_min_score");
    return { id: item.id, score: finalScore, recommendation: finalScore >= pass ? "recommended" : finalScore >= reviewMin ? "review" : "rejected", clusters: clustersFound, reasons, risk_flags: [...new Set(risk_flags)] };
  });
}
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []; }
function number(value: unknown, fallback: number): number { return typeof value === "number" && Number.isFinite(value) ? value : fallback; }
function weightedOccurrences(text: string, terms: string[], termWeights: Record<string, unknown>): { count: number; score: number } { const source = normalized(text); let count = 0; let score = 0; for (const term of [...new Set(terms.map(normalized))]) { if (!term) continue; let from = 0; let occurrences = 0; while (true) { const index = source.indexOf(term, from); if (index < 0) break; occurrences += 1; from = index + term.length; } count += occurrences; score += occurrences * number(termWeights[term], 1); } return { count, score }; }
function formatPoints(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }
