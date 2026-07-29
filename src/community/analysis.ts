import type {
  CommunityType,
  VkCommunity,
  VkWallPost,
} from "./vk-client.js";

export interface Activity {
  last_post_at: string | null;
  posts_per_week: number | null;
  posts_analyzed: number;
  thematic_posts: number;
  thematic_post_share: number | null;
  term_matches: string[];
  term_match_counts: Record<string, number>;
  exclude_term_matches: string[];
  exclude_term_match_counts: Record<string, number>;
  analyzed_terms: string[];
  analyzed_exclude_terms: string[];
  post_term_sets: string[][];
  post_exclude_term_sets: string[][];
  risk_flags: string[];
}

export interface Candidate {
  id: number;
  url: string;
  name: string;
  description: string;
  type: string | null;
  members_count: number | null;
  verified: boolean;
  retrieved_at: string;
  risk_flags: string[];
  activity?: Activity;
}

export interface Score {
  id: number;
  score: number;
  recommendation: "recommended" | "review" | "rejected";
  clusters: string[];
  reasons: string[];
  risk_flags: string[];
}

const normalize = (value: string): string =>
  value.toLocaleLowerCase("ru-RU");

export const matches = (text: string, terms: string[]): string[] =>
  terms.filter((term) => normalize(text).includes(normalize(term)));

export type ExcludeMatchMode = "word_prefix" | "substring";

export function matchExcludedTerms(
  text: string,
  terms: string[],
  mode: ExcludeMatchMode = "word_prefix",
): string[] {
  if (mode === "substring") return matches(text, terms);
  const source = normalize(text);
  return terms.filter((term) => {
    const words = normalize(term).match(/[\p{L}\p{N}]+/gu) ?? [];
    if (words.length === 0) return false;
    const body = words
      .map((word, index) =>
        `${escapeRegExp(word)}${index === words.length - 1 ? "[\\p{L}\\p{N}]*" : ""}`,
      )
      .join("[^\\p{L}\\p{N}]+");
    return new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${body}(?=$|[^\\p{L}\\p{N}])`,
      "u",
    ).test(source);
  });
}

export function candidate(
  value: VkCommunity,
  retrievedAt = new Date().toISOString(),
): Candidate {
  const riskFlags: string[] = [];
  if (value.is_closed !== undefined && value.is_closed !== 0) {
    riskFlags.push("closed");
  }
  if (value.deactivated !== undefined) {
    riskFlags.push(value.deactivated);
  }
  return {
    id: value.id,
    url: `https://vk.com/${value.screen_name ?? `club${value.id}`}`,
    name: value.name,
    description: value.description ?? "",
    type: value.type ?? null,
    members_count: value.members_count ?? null,
    verified: value.is_verified === 1 || value.is_verified === true,
    retrieved_at: retrievedAt,
    risk_flags: riskFlags,
  };
}

export function includeCandidate(
  item: Candidate,
  include: string[],
  exclude: string[],
  types?: CommunityType[],
  min?: number,
  max?: number,
  excludeMatchMode: ExcludeMatchMode = "word_prefix",
): boolean {
  const text = `${item.name}\n${item.description}`;
  return (
    (types?.length
      ? item.type !== null && types.includes(item.type as CommunityType)
      : true) &&
    (min === undefined ||
      (item.members_count !== null && item.members_count >= min)) &&
    (max === undefined ||
      (item.members_count !== null && item.members_count <= max)) &&
    (include.length === 0 || matches(text, include).length > 0) &&
    matchExcludedTerms(text, exclude, excludeMatchMode).length === 0
  );
}

export function analyze(
  posts: VkWallPost[],
  terms: string[],
  excludes: string[],
  excludeMatchMode: ExcludeMatchMode = "word_prefix",
): Activity {
  const ordinary = posts.filter(
    (post) =>
      !post.is_pinned &&
      !post.marked_as_ads &&
      Number.isFinite(post.date),
  );
  const dates = ordinary
    .map((post) => Number(post.date))
    .sort((left, right) => right - left);
  const newest = dates[0];
  const oldest = dates.at(-1);
  const span =
    newest !== undefined && oldest !== undefined && dates.length > 1
      ? Math.max(1, newest - oldest)
      : 0;
  const postTermSets = ordinary.map((post) =>
    matches(post.text ?? "", terms),
  );
  const postExcludeTermSets = ordinary.map((post) =>
    matchExcludedTerms(post.text ?? "", excludes, excludeMatchMode),
  );
  const termMatchCounts = countTermSets(postTermSets);
  const excludeTermMatchCounts = countTermSets(postExcludeTermSets);
  const thematicPosts = postTermSets.filter(
    (matched) => matched.length > 0,
  ).length;

  return {
    last_post_at:
      dates[0] === undefined
        ? null
        : new Date(dates[0] * 1_000).toISOString(),
    posts_per_week: span
      ? Number((ordinary.length / (span / 604_800)).toFixed(2))
      : ordinary.length
        ? null
        : 0,
    posts_analyzed: ordinary.length,
    thematic_posts: thematicPosts,
    thematic_post_share: ordinary.length
      ? Number((thematicPosts / ordinary.length).toFixed(3))
      : null,
    term_matches: Object.keys(termMatchCounts),
    term_match_counts: termMatchCounts,
    exclude_term_matches: Object.keys(excludeTermMatchCounts),
    exclude_term_match_counts: excludeTermMatchCounts,
    analyzed_terms: [...new Set(terms)],
    analyzed_exclude_terms: [...new Set(excludes)],
    post_term_sets: postTermSets,
    post_exclude_term_sets: postExcludeTermSets,
    risk_flags:
      Object.keys(excludeTermMatchCounts).length > 0
        ? ["exclude_term_in_posts"]
        : [],
  };
}

export function reanalyzeDerivedActivity(
  activity: Activity,
  terms: string[],
  excludes: string[],
): { activity: Activity; missingTerms: string[]; missingExcludes: string[] } {
  if (
    !Array.isArray(activity.post_term_sets) ||
    !Array.isArray(activity.post_exclude_term_sets)
  ) {
    return {
      activity,
      missingTerms: [...terms],
      missingExcludes: [...excludes],
    };
  }
  const normalizedAnalyzedTerms = new Map(
    (activity.analyzed_terms ?? activity.term_matches).map((term) => [
      normalize(term),
      term,
    ]),
  );
  const normalizedAnalyzedExcludes = new Map(
    (activity.analyzed_exclude_terms ?? []).map((term) => [
      normalize(term),
      term,
    ]),
  );
  const selectedTerms = terms
    .map((term) => normalizedAnalyzedTerms.get(normalize(term)))
    .filter((term): term is string => term !== undefined);
  const selectedExcludes = excludes
    .map((term) => normalizedAnalyzedExcludes.get(normalize(term)))
    .filter((term): term is string => term !== undefined);
  const missingTerms = terms.filter(
    (term) => !normalizedAnalyzedTerms.has(normalize(term)),
  );
  const missingExcludes = excludes.filter(
    (term) => !normalizedAnalyzedExcludes.has(normalize(term)),
  );
  const selectedTermKeys = new Set(selectedTerms.map(normalize));
  const selectedExcludeKeys = new Set(selectedExcludes.map(normalize));
  const postTermSets = (activity.post_term_sets ?? []).map((set) =>
    set.filter((term) => selectedTermKeys.has(normalize(term))),
  );
  const postExcludeTermSets = (activity.post_exclude_term_sets ?? []).map((set) =>
    set.filter((term) => selectedExcludeKeys.has(normalize(term))),
  );
  const termMatchCounts = countTermSets(postTermSets);
  const excludeTermMatchCounts = countTermSets(postExcludeTermSets);
  const thematicPosts = postTermSets.filter((set) => set.length > 0).length;
  const riskFlags = activity.risk_flags.filter(
    (flag) => flag !== "exclude_term_in_posts",
  );
  if (Object.keys(excludeTermMatchCounts).length > 0) {
    riskFlags.push("exclude_term_in_posts");
  }
  return {
    activity: {
      ...activity,
      thematic_posts: thematicPosts,
      thematic_post_share: activity.posts_analyzed
        ? Number((thematicPosts / activity.posts_analyzed).toFixed(3))
        : null,
      term_matches: Object.keys(termMatchCounts),
      term_match_counts: termMatchCounts,
      exclude_term_matches: Object.keys(excludeTermMatchCounts),
      exclude_term_match_counts: excludeTermMatchCounts,
      risk_flags: riskFlags,
    },
    missingTerms,
    missingExcludes,
  };
}

export function score(
  items: Candidate[],
  rules: Record<string, unknown>,
  clusters: Array<Record<string, unknown>> = [],
  now = Date.now(),
): Score[] {
  const weights = object(rules.weights);
  const terms = strings(rules.terms);
  const excludes = strings(rules.exclude_terms);
  const memberRange = object(rules.members_range);
  const termWeights = object(rules.term_weights);
  const perMatchWeights = object(rules.per_match_weights);
  const freshDays = number(rules.activity_fresh_days, 30);
  const minPostsPerWeek = number(rules.min_posts_per_week, 0);
  const minThematicShare = number(
    rules.min_thematic_post_share,
    0,
  );
  const pass = number(rules.min_score, 0);
  const reviewMin = Math.min(
    pass,
    number(rules.review_min_score, Math.min(pass, 45)),
  );

  return items.map((item) => {
    let value = 0;
    const reasons: string[] = [];
    const text = `${item.name}\n${item.description}`;
    const addMatches = (
      key: string,
      source: string,
      label: string,
    ): void => {
      const limit = number(weights[key], 0);
      const matched = weightedOccurrences(
        source,
        terms,
        termWeights,
      );
      const perMatch = number(perMatchWeights[key], 1);
      if (limit > 0 && matched.score > 0) {
        const points = Math.min(limit, matched.score * perMatch);
        value += points;
        reasons.push(
          `${label}: ${matched.count} совп. +${formatPoints(points)} из ${limit}`,
        );
      }
    };
    const add = (key: string, yes: boolean, label: string): void => {
      const weight = number(weights[key], 0);
      if (yes && weight > 0) {
        value += weight;
        reasons.push(`${label}: +${weight}`);
      }
    };

    addMatches("name_term", item.name, "термины в названии");
    addMatches(
      "description_term",
      item.description,
      "термины в описании",
    );
    const postSource = item.activity === undefined
      ? ""
      : Object.entries(
          item.activity.term_match_counts ??
            Object.fromEntries(
              item.activity.term_matches.map((term) => [term, 1]),
            ),
        )
          .flatMap(([term, count]) =>
            Array.from({ length: count }, () => term),
          )
          .join(" ");
    addMatches("post_term", postSource, "термины в публикациях");
    const fresh =
      item.activity?.last_post_at !== null &&
      item.activity?.last_post_at !== undefined &&
      now - Date.parse(item.activity.last_post_at) <=
        freshDays * 86_400_000;
    add("activity_fresh", fresh, "свежая активность");

    const min =
      typeof memberRange.min === "number"
        ? memberRange.min
        : undefined;
    const max =
      typeof memberRange.max === "number"
        ? memberRange.max
        : undefined;
    add(
      "members_range",
      item.members_count !== null &&
        (min === undefined || item.members_count >= min) &&
        (max === undefined || item.members_count <= max),
      "размер сообщества",
    );

    const thematicShare = item.activity?.thematic_post_share;
    const thematicWeight = number(weights.thematic_post_share, 0);
    if (
      thematicWeight > 0 &&
      thematicShare !== null &&
      thematicShare !== undefined
    ) {
      const points = thematicWeight * thematicShare;
      value += points;
      reasons.push(
        `тематические публикации: ${Math.round(thematicShare * 100)}% +${formatPoints(points)}`,
      );
    }
    const lowThematic =
      thematicShare !== null &&
      thematicShare !== undefined &&
      thematicShare < minThematicShare;
    const lowThematicPenalty = number(
      weights.thematic_low_penalty,
      0,
    );
    if (lowThematic && lowThematicPenalty > 0) {
      value -= lowThematicPenalty;
      reasons.push(`низкая тематичность: -${lowThematicPenalty}`);
    }
    const excludePenalty = number(
      weights.exclude_term_penalty,
      0,
    );
    const metadataExcludes = matchExcludedTerms(text, excludes);
    const postExcludes = item.activity?.exclude_term_matches ?? [];
    if (
      (metadataExcludes.length > 0 || postExcludes.length > 0) &&
      excludePenalty > 0
    ) {
      value -= Math.abs(excludePenalty);
      reasons.push(
        `исключающий термин (${metadataExcludes.length > 0 ? "metadata" : "posts"}): -${Math.abs(excludePenalty)}`,
      );
    }
    const lowActivity =
      item.activity?.posts_per_week !== null &&
      item.activity?.posts_per_week !== undefined &&
      item.activity.posts_per_week < minPostsPerWeek;
    const lowActivityPenalty = number(
      weights.activity_low_penalty,
      0,
    );
    if (lowActivity && lowActivityPenalty > 0) {
      value -= lowActivityPenalty;
      reasons.push(`низкая активность: -${lowActivityPenalty}`);
    }

    const riskFlags = [
      ...item.risk_flags,
      ...(item.activity?.risk_flags ?? []),
    ];
    if (!fresh) riskFlags.push("inactive_or_no_posts");
    if (lowActivity) riskFlags.push("low_activity");
    if (lowThematic) riskFlags.push("low_thematic_post_share");
    const finalScore = Math.max(0, Math.min(100, Math.round(value)));
    const matchedClusters = clusters
      .filter((cluster) => {
        const include = strings(cluster.include_terms);
        const exclude = strings(cluster.exclude_terms);
        const mode = cluster.match_mode === "all" ? "all" : "any";
        const clusterText = `${text}\n${item.activity?.term_matches.join("\n") ?? ""}`;
        const included =
          include.length === 0 ||
          (mode === "all"
            ? include.every(
                (term) => matches(clusterText, [term]).length > 0,
              )
            : matches(clusterText, include).length > 0);
        return (
          finalScore >= number(cluster.min_score, 0) &&
          included &&
          matches(clusterText, exclude).length === 0 &&
          (thematicShare === null ||
            thematicShare === undefined ||
            thematicShare >=
              number(cluster.min_thematic_post_share, 0)) &&
          (item.activity?.posts_per_week === null ||
            item.activity?.posts_per_week === undefined ||
            item.activity.posts_per_week >=
              number(cluster.min_posts_per_week, 0)) &&
          (!cluster.require_no_risk_flags || riskFlags.length === 0) &&
          !strings(cluster.exclude_risk_flags).some((flag) =>
            riskFlags.includes(flag),
          )
        );
      })
      .map((cluster) => String(cluster.name))
      .filter(Boolean);
    if (finalScore < pass) riskFlags.push("below_min_score");

    return {
      id: item.id,
      score: finalScore,
      recommendation:
        finalScore >= pass
          ? "recommended"
          : finalScore >= reviewMin
            ? "review"
            : "rejected",
      clusters: matchedClusters,
      reasons,
      risk_flags: [...new Set(riskFlags)],
    };
  });
}

function object(value: unknown): Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}

function weightedOccurrences(
  text: string,
  terms: string[],
  termWeights: Record<string, unknown>,
): { count: number; score: number } {
  const source = normalize(text);
  let count = 0;
  let result = 0;
  for (const term of [...new Set(terms.map(normalize))]) {
    if (term === "") continue;
    let from = 0;
    let occurrences = 0;
    while (true) {
      const index = source.indexOf(term, from);
      if (index < 0) break;
      occurrences += 1;
      from = index + term.length;
    }
    count += occurrences;
    result += occurrences * number(termWeights[term], 1);
  }
  return { count, score: result };
}

function countTermSets(sets: string[][]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const set of sets) {
    for (const term of [...new Set(set)]) {
      result[term] = (result[term] ?? 0) + 1;
    }
  }
  return result;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
