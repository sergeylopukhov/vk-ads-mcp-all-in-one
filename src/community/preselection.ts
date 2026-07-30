import {
  matchConcepts,
  matchExcludedTerms,
  matchNegativeClusters,
  matches,
  matchesContextualSignals,
  score,
  type Candidate,
  type ConceptRule,
  type ContextualSignal,
  type NegativeCluster,
  type TermStrength,
} from "./analysis.js";

export interface AnalysisPolicy {
  mode: "efficient" | "exhaustive";
  initial_candidates: number;
  max_candidates: number;
  batch_size: number;
  primary_share: number;
  small_community_share: number;
  query_share: number;
  exploration_share: number;
  target_recommended: number;
  target_review: number;
  stable_batches: number;
}

export const DEFAULT_ANALYSIS_POLICY: AnalysisPolicy = {
  mode: "efficient",
  initial_candidates: 100,
  max_candidates: 300,
  batch_size: 25,
  primary_share: 0.65,
  small_community_share: 0.15,
  query_share: 0.1,
  exploration_share: 0.1,
  target_recommended: 20,
  target_review: 30,
  stable_batches: 3,
};

export interface PreselectionResult {
  selected: Candidate[];
  skipped: Candidate[];
  metadataScored: number;
  scoreCeilingRejected: number;
}

export function preselectCandidates(
  items: Candidate[],
  rules: Record<string, unknown>,
  clusters: Array<Record<string, unknown>>,
  policy: AnalysisPolicy,
): PreselectionResult {
  const terms = stringArray(rules.terms);
  const strengths = termStrengthRecord(rules.term_strengths);
  const concepts = conceptArray(rules.concepts);
  const contextualSignals = contextualSignalArray(
    rules.contextual_signals,
  );
  const negativeClusters = negativeClusterArray(
    rules.negative_clusters,
  );
  const excludes = stringArray(rules.exclude_terms);
  const reviewMin = numeric(rules.review_min_score, 30);
  const scored = items.map((item) => {
    const text = `${item.name}\n${item.description}`;
    const termMatches = matches(text, terms);
    const strongTerms = termMatches.filter(
      (term) => strengths[term] === "strong",
    );
    const mediumTerms = termMatches.filter(
      (term) => (strengths[term] ?? "medium") === "medium",
    );
    const weakTerms = termMatches.filter(
      (term) => strengths[term] === "weak",
    );
    const conceptMatches = matchConcepts(text, concepts);
    const strongConcepts = conceptMatches.filter(
      (id) => concepts.find((concept) => concept.id === id)?.strength ===
        "strong",
    );
    const mediumConcepts = conceptMatches.filter(
      (id) => concepts.find((concept) => concept.id === id)?.strength ===
        "medium",
    );
    const weakConcepts = conceptMatches.filter(
      (id) => concepts.find((concept) => concept.id === id)?.strength ===
        "weak",
    );
    const contextualMatches = matchesContextualSignals(
      text,
      contextualSignals,
    );
    const negativeMatches = matchNegativeClusters(text, negativeClusters);
    const targetClusters = clusters
      .filter((cluster) =>
        clusterMatchesMetadata(text, cluster)
      )
      .map((cluster) => String(cluster.name))
      .filter(Boolean);
    const excludeMatches = matchExcludedTerms(
      text,
      excludes,
      rules.exclude_match_mode === "substring"
        ? "substring"
        : "word_prefix",
    );
    const relevanceRank = item.discovery?.best_relevance_rank;
    const relevanceBonus =
      relevanceRank === null || relevanceRank === undefined
        ? 0
        : Math.max(0, 30 - relevanceRank / 5);
    const queryCoverageBonus = Math.min(
      20,
      (item.discovery?.queries.length ?? 1) * 3,
    );
    const conceptWeight = (ids: string[]): number =>
      ids.reduce(
        (sum, id) =>
          sum +
          (concepts.find((concept) => concept.id === id)?.weight ?? 1),
        0,
      );
    const contextualWeight = contextualMatches.reduce(
      (sum, term) =>
        sum +
        (contextualSignals.find((signal) => signal.term === term)?.weight ??
          1),
      0,
    );
    const negativePenalty = negativeMatches.reduce((sum, id) => {
      const action = negativeClusters.find((cluster) => cluster.id === id)
        ?.metadata_action;
      return sum + (action === "reject" ? 120 : action === "review" ? 60 : 25);
    }, 0);
    const metadataScore =
      (strongTerms.length + conceptWeight(strongConcepts)) * 100 +
      (mediumTerms.length + conceptWeight(mediumConcepts)) * 30 +
      (weakTerms.length + conceptWeight(weakConcepts)) * 5 +
      contextualWeight * 25 +
      targetClusters.length * 60 +
      relevanceBonus +
      queryCoverageBonus -
      excludeMatches.length * 30 -
      negativePenalty;
    const { activity: _activity, ...metadataCandidate } = item;
    const baseScore = score([metadataCandidate], rules, clusters)[0]
      ?.raw_score ?? 0;
    const weights = record(rules.weights);
    const metadataReject = negativeMatches.some(
      (id) =>
        negativeClusters.find((cluster) => cluster.id === id)
          ?.metadata_action === "reject",
    );
    const scoreCeiling = metadataReject
      ? 0
      : Math.max(
      0,
      Math.min(
        100,
        Math.round(
          baseScore +
            numeric(weights.post_term, 0) +
            numeric(weights.intent_term, 0) +
            numeric(weights.activity_fresh, 0) +
            numeric(weights.thematic_post_share, 0),
        ),
      ),
      );
    if (metadataReject) {
      item.risk_flags.push("negative_cluster_reject");
    }
    item.preselection = {
      metadata_score: Number(metadataScore.toFixed(2)),
      score_ceiling: scoreCeiling,
      matched_strong_signals: [...strongTerms, ...strongConcepts],
      matched_medium_signals: [...mediumTerms, ...mediumConcepts],
      matched_weak_signals: [...weakTerms, ...weakConcepts],
      matched_target_clusters: targetClusters,
      matched_negative_clusters: negativeMatches,
      selection_reasons: [],
    };
    return item;
  });
  if (policy.mode === "exhaustive") {
    const selected = [...scored].sort(comparePreselection);
    for (const item of selected) {
      item.preselection?.selection_reasons.push("exhaustive");
    }
    return {
      selected,
      skipped: [],
      metadataScored: scored.length,
      scoreCeilingRejected: 0,
    };
  }
  const eligible = scored
    .filter((item) => (item.preselection?.score_ceiling ?? 0) >= reviewMin)
    .sort(comparePreselection);
  const skippedByCeiling = scored
    .filter((item) => (item.preselection?.score_ceiling ?? 0) < reviewMin)
    .map((item) => {
      item.risk_flags.push("score_ceiling_below_review_threshold");
      item.preselection?.selection_reasons.push(
        "score_ceiling_below_review_threshold",
      );
      return item;
    });
  const limit = Math.min(policy.max_candidates, eligible.length);
  const selected = new Map<number, Candidate>();
  const take = (
    source: Candidate[],
    count: number,
    reason: string,
  ): void => {
    for (const item of source) {
      if (selected.size >= limit || count <= 0) break;
      if (!selected.has(item.id)) {
        selected.set(item.id, item);
        item.preselection?.selection_reasons.push(reason);
        count -= 1;
      }
    }
  };

  const requestedCounts = {
    primary: Math.round(
      limit *
        (policy.primary_share ?? DEFAULT_ANALYSIS_POLICY.primary_share),
    ),
    small: Math.round(
      limit *
        (policy.small_community_share ??
          DEFAULT_ANALYSIS_POLICY.small_community_share),
    ),
    query: Math.round(
      limit * (policy.query_share ?? DEFAULT_ANALYSIS_POLICY.query_share),
    ),
    exploration: Math.round(limit * policy.exploration_share),
  };
  const requestedTotal = Object.values(requestedCounts).reduce(
    (sum, value) => sum + value,
    0,
  );
  const overflow = Math.max(0, requestedTotal - limit);
  const primaryCount = Math.max(0, requestedCounts.primary - overflow);
  const smallCount = requestedCounts.small;
  const queryCount = requestedCounts.query;
  const explorationCount =
    policy.exploration_share > 0
      ? Math.max(1, requestedCounts.exploration)
      : 0;
  take(eligible, primaryCount, "metadata_relevance");

  const memberValues = eligible
    .map((item) => item.members_count)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  const smallLimit =
    memberValues[Math.floor(memberValues.length / 2)] ?? Number.MAX_SAFE_INTEGER;
  take(
    eligible.filter(
      (item) =>
        item.members_count !== null &&
        item.members_count <= smallLimit &&
        (item.preselection?.matched_strong_signals.length ?? 0) > 0,
    ),
    smallCount,
    "small_or_medium_strong_match",
  );

  const queries = [
    ...new Set(
      eligible.flatMap((item) => item.discovery?.queries ?? []),
    ),
  ].sort((left, right) => left.localeCompare(right, "ru"));
  const perQuery = Math.max(1, Math.ceil(queryCount / Math.max(1, queries.length)));
  for (const query of queries) {
    take(
      eligible.filter((item) => item.discovery?.queries.includes(query)),
      perQuery,
      `query:${query}`,
    );
  }

  take(
    [...eligible].sort(
      (left, right) =>
        deterministicKey(left.id) - deterministicKey(right.id) ||
        left.id - right.id,
    ),
    explorationCount,
    "exploration",
  );
  take(eligible, limit - selected.size, "metadata_relevance_fill");

  const selectedItems = [...selected.values()].sort(comparePreselection);
  const selectedIds = new Set(selectedItems.map((item) => item.id));
  const budgetSkipped = eligible
    .filter((item) => !selectedIds.has(item.id))
    .map((item) => {
      item.risk_flags.push("analysis_budget_not_selected");
      return item;
    });
  return {
    selected: selectedItems,
    skipped: [...skippedByCeiling, ...budgetSkipped],
    metadataScored: scored.length,
    scoreCeilingRejected: skippedByCeiling.length,
  };
}

function comparePreselection(left: Candidate, right: Candidate): number {
  return (
    (right.preselection?.metadata_score ?? 0) -
      (left.preselection?.metadata_score ?? 0) ||
    (left.discovery?.best_relevance_rank ?? Number.MAX_SAFE_INTEGER) -
      (right.discovery?.best_relevance_rank ?? Number.MAX_SAFE_INTEGER) ||
    (right.members_count ?? 0) - (left.members_count ?? 0) ||
    left.id - right.id
  );
}

function deterministicKey(id: number): number {
  return Math.imul(id, 2_654_435_761) >>> 0;
}

function clusterMatchesMetadata(
  text: string,
  cluster: Record<string, unknown>,
): boolean {
  const include = stringArray(cluster.include_terms);
  const exclude = stringArray(cluster.exclude_terms);
  const mode = cluster.match_mode === "all" ? "all" : "any";
  return (
    (include.length === 0 ||
      (mode === "all"
        ? include.every((term) => matches(text, [term]).length > 0)
        : matches(text, include).length > 0)) &&
    matches(text, exclude).length === 0
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function termStrengthRecord(value: unknown): Record<string, TermStrength> {
  const source = record(value);
  return Object.fromEntries(
    Object.entries(source).filter(
      (entry): entry is [string, TermStrength] =>
        entry[1] === "strong" ||
        entry[1] === "medium" ||
        entry[1] === "weak",
    ),
  );
}

function conceptArray(value: unknown): ConceptRule[] {
  return Array.isArray(value) ? (value as ConceptRule[]) : [];
}

function contextualSignalArray(value: unknown): ContextualSignal[] {
  return Array.isArray(value) ? (value as ContextualSignal[]) : [];
}

function negativeClusterArray(value: unknown): NegativeCluster[] {
  return Array.isArray(value) ? (value as NegativeCluster[]) : [];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numeric(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : fallback;
}
