import type { VkCommunity, VkWallPost } from "./vk-client.js";

export interface Activity {
  last_post_at: string | null;
  posts_per_week: number | null;
  posts_30d: number;
  posts_90d: number;
  posts_per_week_30d: number;
  posts_per_week_90d: number;
  median_posts_per_week_90d: number;
  posts_analyzed: number;
  thematic_posts: number;
  thematic_post_share: number | null;
  term_matches: string[];
  term_match_counts: Record<string, number>;
  exclude_term_matches: string[];
  exclude_term_match_counts: Record<string, number>;
  exclusion_post_share: number;
  intent_term_matches: string[];
  intent_term_match_counts: Record<string, number>;
  compatibility_term_matches: string[];
  compatibility_term_match_counts: Record<string, number>;
  analyzed_terms: string[];
  analyzed_exclude_terms: string[];
  analyzed_intent_terms: string[];
  analyzed_compatibility_terms: string[];
  post_term_sets: string[][];
  post_exclude_term_sets: string[][];
  post_intent_term_sets: string[][];
  post_compatibility_term_sets: string[][];
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
  raw_score: number;
  normalized_score: number;
  components: {
    content_relevance: number;
    audience_intent: number;
    activity: number;
    profile_fit: number;
    exclusion_risk: number;
  };
  compatibility_matches: string[];
  recommendation: "recommended" | "review" | "rejected";
  clusters: string[];
  reasons: string[];
  risk_flags: string[];
}

export type TermStrength = "strong" | "medium" | "weak";

const normalize = (value: string): string =>
  value
    .normalize("NFKC")
    .toLocaleLowerCase("ru-RU")
    .replaceAll("ё", "е");

const RUSSIAN_SUFFIXES = [
  "иями",
  "ями",
  "ами",
  "иях",
  "ого",
  "ему",
  "ому",
  "ыми",
  "ими",
  "иям",
  "ием",
  "иях",
  "ий",
  "ый",
  "ой",
  "ая",
  "яя",
  "ое",
  "ее",
  "ые",
  "ие",
  "ых",
  "их",
  "ую",
  "юю",
  "ов",
  "ев",
  "ей",
  "ам",
  "ям",
  "ах",
  "ях",
  "ом",
  "ем",
  "ия",
  "ья",
  "ы",
  "и",
  "а",
  "я",
  "у",
  "ю",
  "е",
  "о",
] as const;

const tokens = (value: string): string[] =>
  normalize(value).match(/[\p{L}\p{N}]+/gu) ?? [];

const stem = (word: string): string => {
  if (!/^[а-я]+$/u.test(word) || word.length < 5) return word;
  for (const suffix of RUSSIAN_SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 4) {
      const base = word.slice(0, -suffix.length);
      return base.endsWith("ск") && base.length > 6
        ? base.slice(0, -2)
        : base;
    }
  }
  return word;
};

const termMatchesTokens = (source: string[], term: string): boolean => {
  const expected = tokens(term).map(stem);
  if (expected.length === 0) return false;
  const actual = source.map(stem);
  if (expected.length === 1) return actual.includes(expected[0]!);
  const windowSize = expected.length + 2;
  for (let index = 0; index < actual.length; index += 1) {
    const window = actual.slice(index, index + windowSize);
    if (expected.every((word) => window.includes(word))) return true;
  }
  return false;
};

const termPrefixMatchesTokens = (source: string[], term: string): boolean => {
  const expectedTokens = tokens(term);
  if (expectedTokens.length === 0) return false;
  const expected = expectedTokens.map(stem);
  const actual = source.map((word) => ({
    word,
    stem: stem(word),
  }));
  const wordMatches = (
    candidate: (typeof actual)[number],
    index: number,
  ): boolean =>
    candidate.stem === expected[index] ||
    (expectedTokens[index]!.length >= 3 &&
      candidate.word.startsWith(expectedTokens[index]!));
  if (expected.length === 1) {
    return actual.some((candidate) => wordMatches(candidate, 0));
  }
  const windowSize = expected.length + 2;
  for (let index = 0; index < actual.length; index += 1) {
    const window = actual.slice(index, index + windowSize);
    if (
      expected.every((_word, expectedIndex) =>
        window.some((candidate) => wordMatches(candidate, expectedIndex))
      )
    ) {
      return true;
    }
  }
  return false;
};

export const matches = (text: string, terms: string[]): string[] => {
  const source = tokens(text);
  return [...new Set(terms)].filter((term) =>
    termMatchesTokens(source, term)
  );
};

export type ExcludeMatchMode = "word_prefix" | "substring";

export function matchExcludedTerms(
  text: string,
  terms: string[],
  mode: ExcludeMatchMode = "word_prefix",
): string[] {
  if (mode === "substring") {
    const source = normalize(text);
    return [...new Set(terms)].filter((term) =>
      source.includes(normalize(term))
    );
  }
  const source = tokens(text);
  return [...new Set(terms)].filter((term) =>
    termPrefixMatchesTokens(source, term)
  );
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

export function analyze(
  posts: VkWallPost[],
  terms: string[],
  excludes: string[],
  excludeMatchMode: ExcludeMatchMode = "word_prefix",
  options: {
    termStrengths?: Record<string, TermStrength>;
    minWeakMatches?: number;
    intentTerms?: string[];
    compatibilityTerms?: string[];
    now?: number;
  } = {},
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
  const nowSeconds = Math.floor((options.now ?? Date.now()) / 1_000);
  const countWithinDays = (days: number): number =>
    dates.filter(
      (date) => date <= nowSeconds && nowSeconds - date <= days * 86_400,
    ).length;
  const posts30d = countWithinDays(30);
  const posts90d = countWithinDays(90);
  const postTermSets = ordinary.map((post) =>
    matches(post.text ?? "", terms),
  );
  const postExcludeTermSets = ordinary.map((post) =>
    matchExcludedTerms(post.text ?? "", excludes, excludeMatchMode),
  );
  const intentTerms = options.intentTerms ?? [];
  const compatibilityTerms = options.compatibilityTerms ?? [];
  const postIntentTermSets = ordinary.map((post) =>
    matches(post.text ?? "", intentTerms),
  );
  const postCompatibilityTermSets = ordinary.map((post) =>
    matches(post.text ?? "", compatibilityTerms),
  );
  const termMatchCounts = countTermSets(postTermSets);
  const excludeTermMatchCounts = countTermSets(postExcludeTermSets);
  const intentTermMatchCounts = countTermSets(postIntentTermSets);
  const compatibilityTermMatchCounts = countTermSets(
    postCompatibilityTermSets,
  );
  const normalizedStrengths = new Map(
    Object.entries(options.termStrengths ?? {}).map(([term, strength]) => [
      normalize(term),
      strength,
    ]),
  );
  const minWeakMatches = Math.max(2, options.minWeakMatches ?? 2);
  const thematicPosts = postTermSets.filter(
    (matched) => {
      const strengths = matched.map(
        (term) => normalizedStrengths.get(normalize(term)) ?? "medium",
      );
      return (
        strengths.some((strength) => strength !== "weak") ||
        strengths.filter((strength) => strength === "weak").length >=
          minWeakMatches
      );
    },
  ).length;
  const exclusionPosts = postExcludeTermSets.filter(
    (matched) => matched.length > 0,
  ).length;
  const weeklyBuckets = Array.from({ length: 13 }, (_, bucket) =>
    dates.filter((date) => {
      const age = nowSeconds - date;
      return (
        age >= bucket * 604_800 &&
        age < (bucket + 1) * 604_800
      );
    }).length
  ).sort((left, right) => left - right);

  return {
    last_post_at:
      dates[0] === undefined
        ? null
        : new Date(dates[0] * 1_000).toISOString(),
    posts_per_week: Number(((posts90d / 90) * 7).toFixed(2)),
    posts_30d: posts30d,
    posts_90d: posts90d,
    posts_per_week_30d: Number(((posts30d / 30) * 7).toFixed(2)),
    posts_per_week_90d: Number(((posts90d / 90) * 7).toFixed(2)),
    median_posts_per_week_90d: weeklyBuckets[6] ?? 0,
    posts_analyzed: ordinary.length,
    thematic_posts: thematicPosts,
    thematic_post_share: ordinary.length
      ? Number((thematicPosts / ordinary.length).toFixed(3))
      : null,
    term_matches: Object.keys(termMatchCounts),
    term_match_counts: termMatchCounts,
    exclude_term_matches: Object.keys(excludeTermMatchCounts),
    exclude_term_match_counts: excludeTermMatchCounts,
    exclusion_post_share: ordinary.length
      ? Number((exclusionPosts / ordinary.length).toFixed(3))
      : 0,
    intent_term_matches: Object.keys(intentTermMatchCounts),
    intent_term_match_counts: intentTermMatchCounts,
    compatibility_term_matches: Object.keys(compatibilityTermMatchCounts),
    compatibility_term_match_counts: compatibilityTermMatchCounts,
    analyzed_terms: [...new Set(terms)],
    analyzed_exclude_terms: [...new Set(excludes)],
    analyzed_intent_terms: [...new Set(intentTerms)],
    analyzed_compatibility_terms: [...new Set(compatibilityTerms)],
    post_term_sets: postTermSets,
    post_exclude_term_sets: postExcludeTermSets,
    post_intent_term_sets: postIntentTermSets,
    post_compatibility_term_sets: postCompatibilityTermSets,
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
  options: {
    intentTerms?: string[];
    compatibilityTerms?: string[];
    termStrengths?: Record<string, TermStrength>;
    minWeakMatches?: number;
  } = {},
): {
  activity: Activity;
  missingTerms: string[];
  missingExcludes: string[];
  missingIntentTerms: string[];
  missingCompatibilityTerms: string[];
} {
  const intentTerms = options.intentTerms ?? [];
  const compatibilityTerms = options.compatibilityTerms ?? [];
  if (
    !Array.isArray(activity.post_term_sets) ||
    !Array.isArray(activity.post_exclude_term_sets)
  ) {
    return {
      activity,
      missingTerms: [...terms],
      missingExcludes: [...excludes],
      missingIntentTerms: [...intentTerms],
      missingCompatibilityTerms: [...compatibilityTerms],
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
  const normalizedAnalyzedIntentTerms = new Map(
    (activity.analyzed_intent_terms ?? []).map((term) => [
      normalize(term),
      term,
    ]),
  );
  const normalizedAnalyzedCompatibilityTerms = new Map(
    (activity.analyzed_compatibility_terms ?? []).map((term) => [
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
  const selectedIntentTerms = intentTerms
    .map((term) => normalizedAnalyzedIntentTerms.get(normalize(term)))
    .filter((term): term is string => term !== undefined);
  const selectedCompatibilityTerms = compatibilityTerms
    .map((term) =>
      normalizedAnalyzedCompatibilityTerms.get(normalize(term))
    )
    .filter((term): term is string => term !== undefined);
  const missingIntentTerms = intentTerms.filter(
    (term) => !normalizedAnalyzedIntentTerms.has(normalize(term)),
  );
  const missingCompatibilityTerms = compatibilityTerms.filter(
    (term) => !normalizedAnalyzedCompatibilityTerms.has(normalize(term)),
  );
  const selectedTermKeys = new Set(selectedTerms.map(normalize));
  const selectedExcludeKeys = new Set(selectedExcludes.map(normalize));
  const selectedIntentKeys = new Set(selectedIntentTerms.map(normalize));
  const selectedCompatibilityKeys = new Set(
    selectedCompatibilityTerms.map(normalize),
  );
  const postTermSets = (activity.post_term_sets ?? []).map((set) =>
    set.filter((term) => selectedTermKeys.has(normalize(term))),
  );
  const postExcludeTermSets = (activity.post_exclude_term_sets ?? []).map((set) =>
    set.filter((term) => selectedExcludeKeys.has(normalize(term))),
  );
  const postIntentTermSets = (activity.post_intent_term_sets ?? []).map((set) =>
    set.filter((term) => selectedIntentKeys.has(normalize(term))),
  );
  const postCompatibilityTermSets = (
    activity.post_compatibility_term_sets ?? []
  ).map((set) =>
    set.filter((term) => selectedCompatibilityKeys.has(normalize(term)))
  );
  const termMatchCounts = countTermSets(postTermSets);
  const excludeTermMatchCounts = countTermSets(postExcludeTermSets);
  const intentTermMatchCounts = countTermSets(postIntentTermSets);
  const compatibilityTermMatchCounts = countTermSets(
    postCompatibilityTermSets,
  );
  const normalizedStrengths = new Map(
    Object.entries(options.termStrengths ?? {}).map(([term, strength]) => [
      normalize(term),
      strength,
    ]),
  );
  const minWeakMatches = Math.max(2, options.minWeakMatches ?? 2);
  const thematicPosts = postTermSets.filter((set) => {
    const strengths = set.map(
      (term) => normalizedStrengths.get(normalize(term)) ?? "medium",
    );
    return (
      strengths.some((strength) => strength !== "weak") ||
      strengths.filter((strength) => strength === "weak").length >=
        minWeakMatches
    );
  }).length;
  const exclusionPosts = postExcludeTermSets.filter(
    (set) => set.length > 0,
  ).length;
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
      exclusion_post_share: activity.posts_analyzed
        ? Number((exclusionPosts / activity.posts_analyzed).toFixed(3))
        : 0,
      intent_term_matches: Object.keys(intentTermMatchCounts),
      intent_term_match_counts: intentTermMatchCounts,
      compatibility_term_matches: Object.keys(compatibilityTermMatchCounts),
      compatibility_term_match_counts: compatibilityTermMatchCounts,
      post_intent_term_sets: postIntentTermSets,
      post_compatibility_term_sets: postCompatibilityTermSets,
      risk_flags: riskFlags,
    },
    missingTerms,
    missingExcludes,
    missingIntentTerms,
    missingCompatibilityTerms,
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
  const intentTermWeights = object(rules.intent_term_weights);
  const perMatchWeights = object(rules.per_match_weights);
  const intentTerms = strings(rules.intent_terms);
  const compatibilityTerms = strings(rules.compatibility_terms);
  const excludeMatchMode: ExcludeMatchMode =
    rules.exclude_match_mode === "substring" ? "substring" : "word_prefix";
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
    const components = {
      content_relevance: 0,
      audience_intent: 0,
      activity: 0,
      profile_fit: 0,
      exclusion_risk: 0,
    };
    const reasons: string[] = [];
    const text = `${item.name}\n${item.description}`;
    const addMatches = (
      key: string,
      source: string,
      label: string,
      component: keyof typeof components,
      selectedTerms = terms,
      selectedTermWeights = termWeights,
    ): void => {
      const limit = number(weights[key], 0);
      const matched = weightedOccurrences(
        source,
        selectedTerms,
        selectedTermWeights,
      );
      const perMatch = number(perMatchWeights[key], 1);
      if (limit > 0 && matched.score > 0) {
        const points = Math.min(limit, matched.score * perMatch);
        value += points;
        components[component] += points;
        reasons.push(
          `${label}: ${matched.count} совп. +${formatPoints(points)} из ${limit}`,
        );
      }
    };
    const add = (
      key: string,
      yes: boolean,
      label: string,
      component: keyof typeof components,
    ): void => {
      const weight = number(weights[key], 0);
      if (yes && weight > 0) {
        value += weight;
        components[component] += weight;
        reasons.push(`${label}: +${weight}`);
      }
    };

    addMatches(
      "name_term",
      item.name,
      "термины в названии",
      "profile_fit",
    );
    addMatches(
      "description_term",
      item.description,
      "термины в описании",
      "profile_fit",
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
    addMatches(
      "post_term",
      postSource,
      "термины в публикациях",
      "content_relevance",
    );
    const intentSource = [
      text,
      ...Object.entries(item.activity?.intent_term_match_counts ?? {})
        .flatMap(([term, count]) =>
          Array.from({ length: count }, () => term)
        ),
    ].join(" ");
    addMatches(
      "intent_term",
      intentSource,
      "признаки намерения аудитории",
      "audience_intent",
      intentTerms,
      intentTermWeights,
    );
    const fresh =
      item.activity?.last_post_at !== null &&
      item.activity?.last_post_at !== undefined &&
      now - Date.parse(item.activity.last_post_at) <=
        freshDays * 86_400_000;
    add("activity_fresh", fresh, "свежая активность", "activity");

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
      "profile_fit",
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
      components.content_relevance += points;
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
      components.content_relevance -= lowThematicPenalty;
      reasons.push(`низкая тематичность: -${lowThematicPenalty}`);
    }
    const legacyExcludePenalty = number(
      weights.exclude_term_penalty,
      15,
    );
    const metadataExcludes = matchExcludedTerms(
      text,
      excludes,
      excludeMatchMode,
    );
    const postExcludes = item.activity?.exclude_term_matches ?? [];
    const metadataExcludePenalty = number(
      weights.exclude_metadata_penalty,
      legacyExcludePenalty,
    );
    if (metadataExcludes.length > 0 && metadataExcludePenalty > 0) {
      value -= metadataExcludePenalty;
      components.exclusion_risk -= metadataExcludePenalty;
      reasons.push(
        `исключающий термин в названии или описании: -${formatPoints(metadataExcludePenalty)}`,
      );
    }
    const exclusionPostShare = item.activity?.exclusion_post_share ?? 0;
    const postExcludePenaltyCap = number(
      weights.exclude_post_share_penalty,
      legacyExcludePenalty,
    );
    if (postExcludes.length > 0 && postExcludePenaltyCap > 0) {
      const penalty = postExcludePenaltyCap * exclusionPostShare;
      value -= penalty;
      components.exclusion_risk -= penalty;
      reasons.push(
        `исключения в публикациях: ${Math.round(exclusionPostShare * 100)}% -${formatPoints(penalty)}`,
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
      components.activity -= lowActivityPenalty;
      reasons.push(`низкая активность: -${lowActivityPenalty}`);
    }

    const compatibilityMatches = [
      ...matches(text, compatibilityTerms),
      ...(item.activity?.compatibility_term_matches ?? []),
    ];
    const riskFlags = [
      ...item.risk_flags,
      ...(item.activity?.risk_flags ?? []),
    ];
    if (compatibilityMatches.length > 0) {
      riskFlags.push("compatibility_review_required");
      reasons.push("обнаружены признаки совместимости: требуется проверка");
    }
    if (!fresh) riskFlags.push("inactive_or_no_posts");
    if (lowActivity) riskFlags.push("low_activity");
    if (lowThematic) riskFlags.push("low_thematic_post_share");
    const rawScore = Number(value.toFixed(2));
    const finalScore = Math.max(0, Math.min(100, Math.round(rawScore)));
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
      raw_score: rawScore,
      normalized_score: finalScore,
      components: Object.fromEntries(
        Object.entries(components).map(([key, points]) => [
          key,
          Number(points.toFixed(2)),
        ]),
      ) as Score["components"],
      compatibility_matches: [...new Set(compatibilityMatches)],
      recommendation:
        finalScore >= pass && compatibilityMatches.length === 0
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
  const normalizedWeights = new Map(
    Object.entries(termWeights).map(([term, weight]) => [
      normalize(term),
      weight,
    ]),
  );
  const found = matches(text, terms);
  return {
    count: found.length,
    score: found.reduce(
      (result, term) =>
        result + number(normalizedWeights.get(normalize(term)), 1),
      0,
    ),
  };
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

function formatPoints(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
