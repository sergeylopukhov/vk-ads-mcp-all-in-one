import { randomUUID } from "node:crypto";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  analyze,
  candidate,
  matchExcludedTerms,
  matches,
  reanalyzeDerivedActivity,
  score,
  type Candidate,
  type ExcludeMatchMode,
  type Score,
} from "./analysis.js";
import {
  CommunityResearchStore,
  type CommunityResearchRun,
} from "./research-store.js";
import {
  VkCommunityClient,
  type CommunitySearchSort,
  type CommunityType,
} from "./vk-client.js";

export const COMMUNITY_TOOL_NAMES = [
  "vk_start_community_research",
  "vk_research_communities",
  "vk_get_community_research_progress",
  "vk_get_community_research_run",
  "vk_rescore_community_research_run",
  "vk_find_community_candidates",
  "vk_discover_communities",
  "vk_analyze_communities",
  "vk_score_communities",
  "vk_export_community_candidates",
] as const;

export interface VkCommunityToolDependencies {
  client: VkCommunityClient;
  store: CommunityResearchStore;
  progressIntervalMs?: number;
}

type ResearchItem = Candidate &
  Omit<Score, "id">;
type ResearchInput = {
  keywords: string[];
  include_terms: string[];
  exclude_terms: string[];
  exclude_match_mode: ExcludeMatchMode;
  exclude_policy: "soft" | "hard";
  search_sort?: CommunitySearchSort | undefined;
  search_budget: {
    max_pages_per_query: number;
    max_candidates_per_query: number;
    oversample_factor: number;
  };
  country_id?: number | undefined;
  city_id?: number | undefined;
  community_types?: CommunityType[] | undefined;
  min_members?: number | undefined;
  max_members?: number | undefined;
  posts_limit: number;
  scoring_rules?: Record<string, unknown> | undefined;
  clusters: Array<Record<string, unknown>>;
};

const communityTypeSchema = z.enum(["group", "page", "event"]);
const activitySchema = z.object({
  last_post_at: z.string().nullable(),
  posts_per_week: z.number().nullable(),
  posts_analyzed: z.number().int().nonnegative(),
  thematic_posts: z.number().int().nonnegative(),
  thematic_post_share: z.number().min(0).max(1).nullable(),
  term_matches: z.array(z.string()),
  term_match_counts: z
    .record(z.string(), z.number().int().nonnegative())
    .default({}),
  exclude_term_matches: z.array(z.string()).default([]),
  exclude_term_match_counts: z.record(
    z.string(),
    z.number().int().nonnegative(),
  ).default({}),
  analyzed_terms: z.array(z.string()).default([]),
  analyzed_exclude_terms: z.array(z.string()).default([]),
  post_term_sets: z.array(z.array(z.string())).default([]),
  post_exclude_term_sets: z.array(z.array(z.string())).default([]),
  risk_flags: z.array(z.string()),
});
const candidateSchema = z.object({
  id: z.number().int().positive(),
  url: z.string().url(),
  name: z.string(),
  description: z.string(),
  type: z.string().nullable(),
  members_count: z.number().int().nonnegative().nullable(),
  verified: z.boolean(),
  retrieved_at: z.string(),
  risk_flags: z.array(z.string()),
  activity: activitySchema.optional(),
});
const DEFAULT_SCORING_WEIGHTS = {
  name_term: 20,
  description_term: 20,
  post_term: 20,
  activity_fresh: 15,
  thematic_post_share: 20,
  thematic_low_penalty: 15,
  activity_low_penalty: 20,
  exclude_term_penalty: 15,
} as const;
export const DEFAULT_RECOMMENDATION_SCORE = 45;
export const DEFAULT_REVIEW_SCORE = 30;
const scoreSchema = z.object({
  id: z.number().int().positive(),
  score: z.number().min(0).max(100),
  recommendation: z.enum(["recommended", "review", "rejected"]),
  clusters: z.array(z.string()),
  reasons: z.array(z.string()),
  risk_flags: z.array(z.string()),
});
const scoringRulesSchema = z
  .object({
    terms: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    exclude_terms: z
      .array(z.string().trim().min(1).max(120))
      .max(50)
      .optional(),
    weights: z
      .object({
        name_term: z.number().finite().nonnegative().optional(),
        description_term: z.number().finite().nonnegative().optional(),
        post_term: z.number().finite().nonnegative().optional(),
        activity_fresh: z.number().finite().nonnegative().optional(),
        activity_low_penalty: z.number().finite().nonnegative().optional(),
        thematic_post_share: z.number().finite().nonnegative().optional(),
        thematic_low_penalty: z.number().finite().nonnegative().optional(),
        members_range: z.number().finite().nonnegative().optional(),
        exclude_term_penalty: z.number().finite().nonnegative().optional(),
      })
      .strict()
      .refine(
        (weights) =>
          Object.values(weights).some(
            (value) => typeof value === "number" && value > 0,
          ),
        "Укажите хотя бы один положительный вес.",
      )
      .optional(),
    term_weights: z
      .record(
        z.string().trim().min(1).max(120),
        z.number().finite().positive(),
      )
      .optional(),
    per_match_weights: z
      .object({
        name_term: z.number().finite().positive().optional(),
        description_term: z.number().finite().positive().optional(),
        post_term: z.number().finite().positive().optional(),
      })
      .strict()
      .optional(),
    activity_fresh_days: z.number().int().positive().max(3650).optional(),
    min_posts_per_week: z.number().nonnegative().max(10_000).optional(),
    min_thematic_post_share: z.number().min(0).max(1).optional(),
    members_range: z
      .object({
        min: z.number().int().nonnegative().optional(),
        max: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    min_score: z.number().min(0).max(100).optional(),
    review_min_score: z.number().min(0).max(100).optional(),
  })
  .strict()
  .superRefine((rules, context) => {
    if (
      rules.members_range?.min !== undefined &&
      rules.members_range.max !== undefined &&
      rules.members_range.min > rules.members_range.max
    ) {
      context.addIssue({
        code: "custom",
        path: ["members_range"],
        message: "min не может быть больше max.",
      });
    }
    if (rules.terms !== undefined && rules.term_weights !== undefined) {
      const terms = new Set(
        rules.terms.map((term) => term.toLocaleLowerCase("ru-RU")),
      );
      for (const term of Object.keys(rules.term_weights)) {
        if (!terms.has(term.toLocaleLowerCase("ru-RU"))) {
          context.addIssue({
            code: "custom",
            path: ["term_weights", term],
            message:
              "Ключ term_weights должен точно совпадать с одним из terms.",
          });
        }
      }
    }
    const maximumPositiveScore =
      (rules.weights?.name_term ??
        DEFAULT_SCORING_WEIGHTS.name_term) +
      (rules.weights?.description_term ??
        DEFAULT_SCORING_WEIGHTS.description_term) +
      (rules.weights?.post_term ??
        DEFAULT_SCORING_WEIGHTS.post_term) +
      (rules.weights?.activity_fresh ??
        DEFAULT_SCORING_WEIGHTS.activity_fresh) +
      (rules.weights?.thematic_post_share ??
        DEFAULT_SCORING_WEIGHTS.thematic_post_share) +
      (rules.weights?.members_range ?? 0);
    const minimumScore =
      rules.min_score ?? DEFAULT_RECOMMENDATION_SCORE;
    if (maximumPositiveScore < minimumScore) {
      context.addIssue({
        code: "custom",
        path: ["min_score"],
        message:
          "min_score недостижим при заданных положительных весах.",
      });
    }
    const reviewMinimum =
      rules.review_min_score ?? DEFAULT_REVIEW_SCORE;
    if (reviewMinimum > minimumScore) {
      context.addIssue({
        code: "custom",
        path: ["review_min_score"],
        message: "review_min_score не может быть больше min_score.",
      });
    }
  });
const clusterSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    include_terms: z
      .array(z.string().trim().min(1).max(120))
      .max(50)
      .default([]),
    exclude_terms: z
      .array(z.string().trim().min(1).max(120))
      .max(50)
      .default([]),
    match_mode: z.enum(["any", "all"]).default("any"),
    min_score: z.number().min(0).max(100).default(0),
    min_thematic_post_share: z.number().min(0).max(1).default(0),
    min_posts_per_week: z.number().nonnegative().max(10_000).default(0),
    require_no_risk_flags: z.boolean().default(false),
    exclude_risk_flags: z
      .array(z.string().trim().min(1).max(120))
      .max(30)
      .default([]),
  })
  .strict();
export const researchInputSchema = {
  keywords: z
    .array(z.string().trim().min(1).max(120))
    .min(1)
    .max(20),
  include_terms: z
    .array(z.string().trim().min(1).max(120))
    .max(50)
    .default([]),
  exclude_match_mode: z
    .enum(["word_prefix", "substring"])
    .default("word_prefix"),
  exclude_policy: z.enum(["soft", "hard"]).default("soft"),
  search_sort: z.enum(["relevance", "members"]).default("members"),
  search_budget: z
    .object({
      max_pages_per_query: z.number().int().min(1).max(10).default(10),
      max_candidates_per_query: z
        .number()
        .int()
        .min(1)
        .max(1_000)
        .default(1_000),
      oversample_factor: z.number().int().min(1).max(10).default(10),
    })
    .strict()
    .default({
      max_pages_per_query: 10,
      max_candidates_per_query: 1_000,
      oversample_factor: 10,
    }),
  exclude_terms: z
    .array(z.string().trim().min(1).max(120))
    .max(50)
    .default([]),
  country_id: z.number().int().positive().optional(),
  city_id: z.number().int().positive().optional(),
  community_types: z.array(communityTypeSchema).max(3).optional(),
  min_members: z.number().int().nonnegative().optional(),
  max_members: z.number().int().nonnegative().optional(),
  posts_limit: z.number().int().min(1).max(100).default(30),
  scoring_rules: scoringRulesSchema.optional(),
  clusters: z.array(clusterSchema).max(50).default([]),
};
const researchItemSchema = candidateSchema.merge(
  scoreSchema.omit({ id: true }),
);
const runOutputSchema = {
  run_id: z.string().uuid(),
  created_at: z.string(),
  expires_at: z.string(),
  scoring_version: z.literal("community-research-v2"),
  status: z.enum(["queued", "running", "completed", "failed"]),
  request: z.record(z.string(), z.unknown()),
  progress: z.object({
    phase: z
      .enum(["queued", "discovering", "analyzing", "completed"])
      .default("analyzing"),
    discovered: z.number().int().nonnegative(),
    selected: z.number().int().nonnegative(),
    processed: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    batch_size: z.number().int().positive(),
    batches_total: z.number().int().nonnegative(),
    batches_completed: z.number().int().nonnegative(),
  }),
  summary: z.object({
    source_matches: z.number().int().nonnegative(),
    provider_reported_matches: z.number().int().nonnegative().default(0),
    metadata_excluded: z.number().int().nonnegative().default(0),
    metadata_flagged: z.number().int().nonnegative().default(0),
    metadata_exclusion_matches: z.record(
      z.string(),
      z.number().int().nonnegative(),
    ).default({}),
    positive_metadata_unmatched: z.number().int().nonnegative().default(0),
    structural_excluded: z.number().int().nonnegative().default(0),
    structural_exclusion_reasons: z.record(
      z.string(),
      z.number().int().nonnegative(),
    ).default({}),
    metadata_unavailable: z.number().int().nonnegative().default(0),
    matched_filters: z.number().int().nonnegative(),
    selected: z.number().int().nonnegative(),
    analyzed: z.number().int().nonnegative(),
    analysis_batch_size: z.number().int().positive(),
    analysis_batches: z.number().int().nonnegative(),
    posts_unavailable: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    review: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
    search_pages: z.number().int().nonnegative(),
    incomplete: z.boolean(),
    incomplete_reasons: z.array(z.string()),
  }),
  passed: z.array(researchItemSchema),
  review: z.array(researchItemSchema),
  rejected: z.array(researchItemSchema),
  error: z.string().optional(),
  rescore_of: z.string().uuid().optional(),
};

export function registerVkCommunityTools(
  server: McpServer,
  dependencies: VkCommunityToolDependencies,
): void {
  const { client, store } = dependencies;
  const batchSize = 25;
  const running = new Map<string, Promise<void>>();
  const subscribers = new Map<string, Set<string | undefined>>();

  const discover = async (
    input: Pick<
      ResearchInput,
      | "keywords"
      | "include_terms"
      | "exclude_terms"
      | "exclude_match_mode"
      | "exclude_policy"
      | "search_sort"
      | "search_budget"
      | "country_id"
      | "city_id"
      | "community_types"
      | "min_members"
      | "max_members"
    >,
  ): Promise<{
    items: Candidate[];
    searchPages: number;
    sourceMatches: number;
    providerReportedMatches: number;
    metadataExcluded: number;
    metadataFlagged: number;
    metadataExclusionMatches: Record<string, number>;
    positiveMetadataUnmatched: number;
    structuralExcluded: number;
    structuralExclusionReasons: Record<string, number>;
    metadataUnavailable: number;
    providerLimited: boolean;
    budgetLimited: boolean;
  }> => {
    if (input.keywords.length === 0) {
      throw new Error("Укажите хотя бы одно ключевое слово.");
    }
    if (
      input.min_members !== undefined &&
      input.max_members !== undefined &&
      input.min_members > input.max_members
    ) {
      throw new Error("min_members не может быть больше max_members.");
    }
    const found = new Map<number, Candidate>();
    const terms = [...new Set([...input.keywords, ...input.include_terms])];
    const sourceIds = new Set<number>();
    const enrichedIds = new Set<number>();
    const metadataExcludedIds = new Set<number>();
    const metadataFlaggedIds = new Set<number>();
    const metadataExclusionIds = new Map<string, Set<number>>();
    const positiveMetadataUnmatchedIds = new Set<number>();
    const structuralExcludedIds = new Set<number>();
    const structuralExclusionIds = new Map<string, Set<number>>();
    let searchPages = 0;
    let providerReportedMatches = 0;
    let providerLimited = false;
    let budgetLimited = false;
    for (const keyword of input.keywords) {
      const types: Array<CommunityType | undefined> =
        input.community_types?.length
          ? input.community_types
          : [undefined];
      for (const type of types) {
        let queryCandidates = 0;
        let queryPages = 0;
        let sort: CommunitySearchSort =
          input.search_sort ?? "members";
        for (let offset = 0; ; ) {
          const pageSize = Math.min(
            100,
            input.search_budget.max_candidates_per_query -
              queryCandidates,
          );
          let page = await client.searchPage(
            keyword,
            offset,
            pageSize,
            input.country_id,
            input.city_id,
            type,
            sort,
          );
          searchPages += 1;
          queryPages += 1;
          if (offset === 0) providerReportedMatches += page.count;
          for (const item of page.items) sourceIds.add(item.id);
          queryCandidates += page.items.length;
          const pageCandidates = (
            await client.getByIds(page.items.map((item) => item.id))
          ).map((item) => candidate(item));
          for (const item of pageCandidates) {
            enrichedIds.add(item.id);
            const structuralReasons = [
              ...(input.community_types?.length &&
              (item.type === null ||
                !input.community_types.includes(item.type as CommunityType))
                ? ["community_type"]
                : []),
              ...(input.min_members !== undefined &&
              (item.members_count === null ||
                item.members_count < input.min_members)
                ? ["min_members"]
                : []),
              ...(input.max_members !== undefined &&
              (item.members_count === null ||
                item.members_count > input.max_members)
                ? ["max_members"]
                : []),
            ];
            if (structuralReasons.length > 0) {
              structuralExcludedIds.add(item.id);
              for (const reason of structuralReasons) {
                const ids =
                  structuralExclusionIds.get(reason) ?? new Set<number>();
                ids.add(item.id);
                structuralExclusionIds.set(reason, ids);
              }
              continue;
            }
            if (
              terms.length > 0 &&
              matches(`${item.name}\n${item.description}`, terms).length === 0
            ) {
              positiveMetadataUnmatchedIds.add(item.id);
            }
            const exclusionMatches = matchExcludedTerms(
              `${item.name}\n${item.description}`,
              input.exclude_terms,
              input.exclude_match_mode,
            );
            if (exclusionMatches.length > 0) {
              for (const term of exclusionMatches) {
                const ids =
                  metadataExclusionIds.get(term) ?? new Set<number>();
                ids.add(item.id);
                metadataExclusionIds.set(term, ids);
              }
              if (input.exclude_policy === "hard") {
                metadataExcludedIds.add(item.id);
                continue;
              }
              metadataFlaggedIds.add(item.id);
              item.risk_flags.push("exclude_term_in_metadata");
            }
            found.set(item.id, item);
          }
          const next = offset + page.items.length;
          const reachedBudget =
            queryPages >= input.search_budget.max_pages_per_query ||
            queryCandidates >=
              input.search_budget.max_candidates_per_query;
          const belowThreshold =
            sort === "members" &&
            input.min_members !== undefined &&
            page.items.length > 0 &&
            pageCandidates.length === page.items.length &&
            pageCandidates.every(
              (item) =>
                item.members_count !== null &&
                item.members_count < input.min_members!,
            );
          if (
            page.items.length === 0 ||
            belowThreshold ||
            next >= page.count ||
            next >= 1_000 ||
            reachedBudget
          ) {
            if (page.count >= 1_000) providerLimited = true;
            if (
              reachedBudget &&
              next < Math.min(page.count, 1_000)
            ) {
              budgetLimited = true;
            }
            break;
          }
          offset = next;
        }
      }
    }
    const items = [...found.values()];
    if ((input.search_sort ?? "members") === "members") {
      items.sort(
        (left, right) =>
          (right.members_count ?? -1) - (left.members_count ?? -1) ||
          left.id - right.id,
      );
    }
    return {
      items,
      searchPages,
      sourceMatches: sourceIds.size,
      providerReportedMatches,
      metadataExcluded: metadataExcludedIds.size,
      metadataFlagged: metadataFlaggedIds.size,
      metadataExclusionMatches: Object.fromEntries(
        [...metadataExclusionIds].map(([term, ids]) => [
          term,
          ids.size,
        ]),
      ),
      positiveMetadataUnmatched: positiveMetadataUnmatchedIds.size,
      structuralExcluded: structuralExcludedIds.size,
      structuralExclusionReasons: Object.fromEntries(
        [...structuralExclusionIds].map(([reason, ids]) => [
          reason,
          ids.size,
        ]),
      ),
      metadataUnavailable: [...sourceIds].filter(
        (id) => !enrichedIds.has(id),
      ).length,
      providerLimited,
      budgetLimited,
    };
  };

  const analyzeItems = async (
    items: Candidate[],
    postsLimit: number,
    terms: string[],
    excludes: string[],
    excludeMatchMode: ExcludeMatchMode,
  ): Promise<Candidate[]> => {
    for (const item of items) {
      if (
        item.risk_flags.some(
          (flag) => flag !== "exclude_term_in_metadata",
        )
      ) {
        continue;
      }
      try {
        item.activity = analyze(
          await client.wall(item.id, postsLimit),
          terms,
          excludes,
          excludeMatchMode,
        );
        item.risk_flags.push(...item.activity.risk_flags);
      } catch {
        item.risk_flags.push("posts_unavailable");
      }
    }
    return items;
  };

  const resolveRules = (
    overrides: Record<string, unknown> | undefined,
    terms: string[],
    excludes: string[],
  ): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      terms,
      exclude_terms: excludes,
      weights: { ...DEFAULT_SCORING_WEIGHTS },
      per_match_weights: {
        name_term: 8,
        description_term: 4,
        post_term: 3,
      },
      activity_fresh_days: 30,
      min_posts_per_week: 1,
      min_thematic_post_share: 0.5,
      min_score: DEFAULT_RECOMMENDATION_SCORE,
      review_min_score: DEFAULT_REVIEW_SCORE,
    };
    if (overrides === undefined) return base;
    return {
      ...base,
      ...overrides,
      terms: Object.hasOwn(overrides, "terms") ? overrides.terms : terms,
      exclude_terms: Object.hasOwn(overrides, "exclude_terms")
        ? overrides.exclude_terms
        : excludes,
      weights: {
        ...asObject(base.weights),
        ...asObject(overrides.weights),
      },
      term_weights: {
        ...asObject(base.term_weights),
        ...asObject(overrides.term_weights),
      },
      per_match_weights: {
        ...asObject(base.per_match_weights),
        ...asObject(overrides.per_match_weights),
      },
    };
  };

  const rank = (
    communities: Candidate[],
    rules: Record<string, unknown>,
    clusters: Array<Record<string, unknown>>,
  ): ResearchItem[] => {
    const byId = new Map(
      score(communities, rules, clusters).map((item) => [item.id, item]),
    );
    return communities
      .map((community) => {
        const result = byId.get(community.id)!;
        return {
          ...community,
          score: result.score,
          recommendation: result.recommendation,
          clusters: result.clusters,
          reasons: result.reasons,
          risk_flags: result.risk_flags,
        };
      })
      .sort(compareResearchItems);
  };

  const buildRequest = (
    input: ResearchInput,
    rules: Record<string, unknown>,
  ): Record<string, unknown> => ({
    ...input,
    scoring_rules: rules,
  });

  const createRun = (
    input: ResearchInput,
    discovery: Awaited<ReturnType<typeof discover>>,
    selected: Candidate[],
    rules: Record<string, unknown>,
    status: "queued" | "completed",
  ): CommunityResearchRun => {
    const createdAt = new Date().toISOString();
    const incompleteReasons = [
      ...(discovery.providerLimited ? ["provider_search_limit"] : []),
      ...(discovery.budgetLimited ? ["search_budget_limit"] : []),
    ];
    return {
      run_id: randomUUID(),
      created_at: createdAt,
      expires_at: store.expiresAt(),
      scoring_version: "community-research-v2",
      status,
      request: buildRequest(input, rules),
      progress: {
        phase: status === "completed" ? "completed" : "queued",
        discovered: discovery.items.length,
        selected: selected.length,
        processed: status === "completed" ? selected.length : 0,
        remaining: status === "completed" ? 0 : selected.length,
        batch_size: batchSize,
        batches_total: Math.ceil(selected.length / batchSize),
        batches_completed:
          status === "completed" ? Math.ceil(selected.length / batchSize) : 0,
      },
      summary: {
        source_matches: discovery.sourceMatches,
        provider_reported_matches: discovery.providerReportedMatches,
        metadata_excluded: discovery.metadataExcluded,
        metadata_flagged: discovery.metadataFlagged,
        metadata_exclusion_matches:
          discovery.metadataExclusionMatches,
        positive_metadata_unmatched:
          discovery.positiveMetadataUnmatched,
        structural_excluded: discovery.structuralExcluded,
        structural_exclusion_reasons:
          discovery.structuralExclusionReasons,
        metadata_unavailable: discovery.metadataUnavailable,
        matched_filters: discovery.items.length,
        selected: selected.length,
        analyzed: 0,
        analysis_batch_size: batchSize,
        analysis_batches: 0,
        posts_unavailable: 0,
        passed: 0,
        review: 0,
        rejected: 0,
        search_pages: discovery.searchPages,
        incomplete: incompleteReasons.length > 0,
        incomplete_reasons: incompleteReasons,
      },
      ...(status === "queued" ? { pending: selected } : {}),
      passed: [],
      review: [],
      rejected: [],
    };
  };

  const prepare = async (
    input: ResearchInput,
  ): Promise<{
    discovery: Awaited<ReturnType<typeof discover>>;
    selected: Candidate[];
    rules: Record<string, unknown>;
    terms: string[];
    excludes: string[];
  }> => {
    const rules = resolveRules(
      input.scoring_rules,
      [...new Set([...input.keywords, ...input.include_terms])],
      input.exclude_terms,
    );
    const terms = strings(rules.terms);
    const excludes = strings(rules.exclude_terms);
    const discovery = await discover(input);
    const ordered = discovery.items.sort((left, right) => {
      if ((input.search_sort ?? "members") === "members") {
        return (
          (right.members_count ?? -1) - (left.members_count ?? -1) ||
          left.id - right.id
        );
      }
      const leftMatches = matches(
        `${left.name}\n${left.description}`,
        terms,
      ).length;
      const rightMatches = matches(
        `${right.name}\n${right.description}`,
        terms,
      ).length;
      return (
        rightMatches - leftMatches ||
        (right.members_count ?? 0) - (left.members_count ?? 0) ||
        left.id - right.id
      );
    });
    return {
      discovery,
      selected: ordered,
      rules,
      terms,
      excludes,
    };
  };

  const updatePartitions = (
    run: CommunityResearchRun,
    items: ResearchItem[],
  ): void => {
    const passed = items
      .filter((item) => item.recommendation === "recommended")
      .sort(compareResearchItems);
    const review = items
      .filter((item) => item.recommendation === "review")
      .sort(compareResearchItems);
    const rejected = items
      .filter((item) => item.recommendation === "rejected")
      .sort(compareResearchItems);
    run.passed = passed;
    run.review = review;
    run.rejected = rejected;
    const summary = run.summary as Record<string, unknown>;
    summary.passed = passed.length;
    summary.review = review.length;
    summary.rejected = rejected.length;
    summary.posts_unavailable = items.filter((item) =>
      item.risk_flags.includes("posts_unavailable"),
    ).length;
  };

  const project = (
    run: CommunityResearchRun,
  ): Record<string, unknown> => {
    const { pending: _pending, ...publicRun } = run;
    return publicRun;
  };

  const runSynchronously = async (
    rawInput: ResearchInput,
    persist: boolean,
  ): Promise<Record<string, unknown>> => {
    const input = rawInput;
    const prepared = await prepare(input);
    const analyzed = await analyzeItems(
      prepared.selected,
      input.posts_limit,
      prepared.terms,
      prepared.excludes,
      input.exclude_match_mode,
    );
    const items = rank(analyzed, prepared.rules, input.clusters);
    const run = createRun(
      input,
      prepared.discovery,
      prepared.selected,
      prepared.rules,
      "completed",
    );
    const progress = run.progress as Record<string, unknown>;
    const summary = run.summary as Record<string, unknown>;
    summary.analyzed = analyzed.filter(
      (item) => item.activity !== undefined,
    ).length;
    summary.analysis_batches = Math.ceil(analyzed.length / batchSize);
    progress.processed = analyzed.length;
    progress.remaining = 0;
    progress.batches_completed = Math.ceil(analyzed.length / batchSize);
    updatePartitions(run, items);
    if (persist) await store.save(run);
    return project(run);
  };

  const notify = async (
    run: CommunityResearchRun,
    final = false,
  ): Promise<void> => {
    const sessions = subscribers.get(run.run_id);
    if (sessions === undefined) return;
    const progress = run.progress as Record<string, number>;
    const message = `${final ? "Исследование сообществ завершено" : "Прогресс исследования сообществ"} (${run.run_id}): обработано ${progress.processed ?? 0} из ${progress.selected ?? 0}.`;
    await Promise.all(
      [...sessions].map(async (sessionId) => {
        try {
          await server.sendLoggingMessage(
            { level: "info", data: message },
            sessionId,
          );
        } catch {
          // Отключившийся MCP-клиент не должен останавливать исследование.
        }
      }),
    );
  };

  const start = async (
    rawInput: ResearchInput,
    sessionId?: string,
  ): Promise<Record<string, unknown>> => {
    const input = rawInput;
    const initialRules = resolveRules(
      input.scoring_rules,
      [...new Set([...input.keywords, ...input.include_terms])],
      input.exclude_terms,
    );
    const run = createRun(
      input,
      {
        items: [],
        searchPages: 0,
        sourceMatches: 0,
        providerReportedMatches: 0,
        metadataExcluded: 0,
        metadataFlagged: 0,
        metadataExclusionMatches: {},
        positiveMetadataUnmatched: 0,
        structuralExcluded: 0,
        structuralExclusionReasons: {},
        metadataUnavailable: 0,
        providerLimited: false,
        budgetLimited: false,
      },
      [],
      initialRules,
      "queued",
    );
    await store.save(run);
    subscribers.set(run.run_id, new Set([sessionId]));
    const execute = async (): Promise<void> => {
      let timer: ReturnType<typeof setInterval> | undefined;
      try {
        run.status = "running";
        const initialProgress = run.progress as Record<string, unknown>;
        initialProgress.phase = "discovering";
        await store.save(run);
        await notify(run);
        timer = setInterval(() => {
          void notify(run);
        }, Math.max(1, dependencies.progressIntervalMs ?? 60_000));
        timer.unref?.();
        const prepared = await prepare(input);
        const preparedRun = createRun(
          input,
          prepared.discovery,
          prepared.selected,
          prepared.rules,
          "queued",
        );
        run.request = preparedRun.request;
        run.progress = preparedRun.progress;
        run.summary = preparedRun.summary;
        run.pending = preparedRun.pending;
        const preparedProgress = run.progress as Record<string, unknown>;
        preparedProgress.phase =
          prepared.selected.length === 0 ? "completed" : "analyzing";
        if (prepared.selected.length === 0) run.status = "completed";
        await store.save(run);
        while (Array.isArray(run.pending) && run.pending.length > 0) {
          const batch = (run.pending as Candidate[]).splice(0, batchSize);
          const analyzed = await analyzeItems(
            batch,
            input.posts_limit,
            prepared.terms,
            prepared.excludes,
            input.exclude_match_mode,
          );
          const currentItems = [
            ...(run.passed as ResearchItem[]),
            ...(run.review as ResearchItem[]),
            ...(run.rejected as ResearchItem[]),
            ...rank(analyzed, prepared.rules, input.clusters),
          ];
          updatePartitions(run, currentItems);
          const progress = run.progress as Record<string, number>;
          const summary = run.summary as Record<string, number>;
          progress.processed = (progress.processed ?? 0) + batch.length;
          progress.remaining = (progress.remaining ?? 0) - batch.length;
          progress.batches_completed =
            (progress.batches_completed ?? 0) + 1;
          summary.analyzed = progress.processed ?? 0;
          summary.analysis_batches =
            progress.batches_completed ?? 0;
          if (run.pending.length === 0) run.status = "completed";
          if (run.status === "completed") {
            (run.progress as Record<string, unknown>).phase = "completed";
          }
          await store.save(run);
        }
        if (run.status === "running") {
          run.status = "completed";
          (run.progress as Record<string, unknown>).phase = "completed";
          await store.save(run);
        }
      } catch {
        run.status = "failed";
        run.error =
          "Фоновый анализ остановился из-за ошибки VK API. Обработанные пакеты сохранены.";
        await store.save(run);
      } finally {
        if (timer !== undefined) clearInterval(timer);
        await notify(run, true);
        subscribers.delete(run.run_id);
        running.delete(run.run_id);
      }
    };
    const task = execute();
    running.set(run.run_id, task);
    void task;
    return project(run);
  };

  const readOnly = {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  } as const;

  server.registerTool(
    "vk_start_community_research",
    {
      title: "Запустить фоновое исследование сообществ VK",
      description:
        "Сразу создаёт запуск; поиск и анализ публичных сообществ выполняются в фоне пакетами по 25.",
      inputSchema: researchInputSchema,
      outputSchema: runOutputSchema,
      annotations: { ...readOnly, idempotentHint: false },
    },
    async (input, extra) =>
      result(
        await start(input, extra.sessionId),
        "Фоновое исследование запущено.",
      ),
  );
  server.registerTool(
    "vk_research_communities",
    {
      title: "Запустить исследование сообществ VK",
      description:
        "Совместимый alias фонового исследования сообществ.",
      inputSchema: researchInputSchema,
      outputSchema: runOutputSchema,
      annotations: { ...readOnly, idempotentHint: false },
    },
    async (input, extra) =>
      result(
        await start(input, extra.sessionId),
        "Фоновое исследование запущено.",
      ),
  );
  server.registerTool(
    "vk_get_community_research_progress",
    {
      title: "Получить прогресс исследования сообществ",
      description:
        "Возвращает прогресс сохранённого запуска без обращения к VK.",
      inputSchema: { run_id: z.string().uuid() },
      outputSchema: runOutputSchema,
      annotations: { ...readOnly, idempotentHint: true },
    },
    async ({ run_id }) =>
      result(
        project(await store.get(run_id)),
        "Прогресс исследования получен.",
      ),
  );
  server.registerTool(
    "vk_get_community_research_run",
    {
      title: "Получить снимок исследования сообществ",
      description:
        "Возвращает сохранённый результат без повторного обращения к VK.",
      inputSchema: { run_id: z.string().uuid() },
      outputSchema: runOutputSchema,
      annotations: { ...readOnly, idempotentHint: true },
    },
    async ({ run_id }) =>
      result(
        project(await store.get(run_id)),
        "Снимок исследования получен.",
      ),
  );
  server.registerTool(
    "vk_rescore_community_research_run",
    {
      title: "Пересчитать сохранённое исследование сообществ",
      description:
        "Повторно применяет проанализированные термины, скоринг и кластеры без новых запросов к VK.",
      inputSchema: {
        run_id: z.string().uuid(),
        scoring_rules: scoringRulesSchema.optional(),
        clusters: z.array(clusterSchema).max(50).optional(),
      },
      outputSchema: runOutputSchema,
      annotations: { ...readOnly, idempotentHint: false },
    },
    async ({ run_id, scoring_rules, clusters }) => {
      const source = await store.get(run_id);
      if (source.status !== "completed") {
        throw new Error(
          "Пересчёт доступен после завершения исходного исследования.",
        );
      }
      const request = asObject(source.request);
      const savedRules = asObject(request.scoring_rules);
      const rules = resolveRules(
        scoring_rules,
        strings(savedRules.terms).length > 0
          ? strings(savedRules.terms)
          : [...strings(request.keywords), ...strings(request.include_terms)],
        strings(savedRules.exclude_terms).length > 0
          ? strings(savedRules.exclude_terms)
          : strings(request.exclude_terms),
      );
      const rescoreTerms = strings(rules.terms);
      const rescoreExcludes = strings(rules.exclude_terms);
      const termsChanged = !sameStrings(
        rescoreTerms,
        strings(savedRules.terms),
      );
      const excludesChanged = !sameStrings(
        rescoreExcludes,
        strings(savedRules.exclude_terms),
      );
      const missingTerms = new Set<string>();
      const missingExcludes = new Set<string>();
      const sourceItems = [
        ...(source.passed as Candidate[]),
        ...((source.review as Candidate[] | undefined) ?? []),
        ...(source.rejected as Candidate[]),
      ].map((item) => {
        const derived =
          item.activity === undefined ||
          (!termsChanged && !excludesChanged)
            ? undefined
            : reanalyzeDerivedActivity(
                item.activity,
                rescoreTerms,
                rescoreExcludes,
              );
        for (const term of derived?.missingTerms ?? []) {
          missingTerms.add(term);
        }
        for (const term of derived?.missingExcludes ?? []) {
          missingExcludes.add(term);
        }
        return {
          ...item,
          ...(derived === undefined ? {} : { activity: derived.activity }),
          risk_flags: item.risk_flags.filter(
            (flag) =>
              ![
                "exclude_term_in_posts",
                "inactive_or_no_posts",
                "low_activity",
                "low_thematic_post_share",
                "below_min_score",
              ].includes(flag),
          ),
        };
      });
      const next: CommunityResearchRun = {
        ...source,
        run_id: randomUUID(),
        rescore_of: run_id,
        created_at: new Date().toISOString(),
        expires_at: store.expiresAt(),
        request: {
          ...request,
          scoring_rules: rules,
          clusters: clusters ?? request.clusters ?? [],
          rescore_of: run_id,
        },
      };
      updatePartitions(
        next,
        rank(
          sourceItems,
          rules,
          clusters ?? objects(request.clusters),
        ),
      );
      if (missingTerms.size > 0 || missingExcludes.size > 0) {
        const summary = next.summary as Record<string, unknown>;
        summary.incomplete = true;
        summary.incomplete_reasons = [
          ...new Set([
            ...strings(summary.incomplete_reasons),
            "rescore_terms_not_analyzed",
          ]),
        ];
        next.request = {
          ...asObject(next.request),
          rescore_missing_terms: [...missingTerms],
          rescore_missing_exclude_terms: [...missingExcludes],
        };
      }
      await store.save(next);
      return result(project(next), "Сохранённый результат пересчитан.");
    },
  );
  server.registerTool(
    "vk_find_community_candidates",
    {
      title: "Найти и оценить сообщества VK",
      description:
        "За один вызов выполняет поиск, анализ публикаций и прозрачный скоринг.",
      inputSchema: researchInputSchema,
      outputSchema: {
        items: z.array(candidateSchema.merge(scoreSchema.omit({ id: true }))),
      },
      annotations: { ...readOnly, idempotentHint: true },
    },
    async (input) => {
      const run = await runSynchronously(input, false);
      return result(
        {
          items: [
            ...(run.passed as ResearchItem[]),
            ...(run.review as ResearchItem[]),
            ...(run.rejected as ResearchItem[]),
          ],
        },
        "Сообщества найдены, проанализированы и оценены.",
      );
    },
  );
  server.registerTool(
    "vk_discover_communities",
    {
      title: "Найти публичные сообщества VK",
      description:
        "Ищет через groups.search в заданном бюджете, применяет явные структурные ограничения, помечает мягкие минус-совпадения и удаляет дубли по ID.",
      inputSchema: {
        keywords: researchInputSchema.keywords,
        include_terms: researchInputSchema.include_terms,
        exclude_terms: researchInputSchema.exclude_terms,
        exclude_match_mode: researchInputSchema.exclude_match_mode,
        exclude_policy: researchInputSchema.exclude_policy,
        search_sort: researchInputSchema.search_sort,
        search_budget: researchInputSchema.search_budget,
        country_id: researchInputSchema.country_id,
        city_id: researchInputSchema.city_id,
        community_types: researchInputSchema.community_types,
        min_members: researchInputSchema.min_members,
        max_members: researchInputSchema.max_members,
        limit: z.number().int().min(1).max(1_000).default(100),
      },
      outputSchema: { items: z.array(candidateSchema) },
      annotations: { ...readOnly, idempotentHint: true },
    },
    async (input) =>
      result(
        { items: (await discover(input)).items.slice(0, input.limit) },
        "Публичные сообщества найдены.",
      ),
  );
  server.registerTool(
    "vk_analyze_communities",
    {
      title: "Проанализировать сообщества VK",
      description:
        "Анализирует metadata и публичные записи, возвращая только производные совпадения без полных текстов.",
      inputSchema: {
        community_ids: z
          .array(z.number().int().positive())
          .min(1)
          .max(500),
        posts_limit: z.number().int().min(1).max(100).default(30),
        analysis_terms: z
          .array(z.string().trim().min(1).max(120))
          .max(50)
          .default([]),
        exclude_terms: z
          .array(z.string().trim().min(1).max(120))
          .max(50)
          .default([]),
        exclude_match_mode: z
          .enum(["word_prefix", "substring"])
          .default("word_prefix"),
      },
      outputSchema: { items: z.array(candidateSchema) },
      annotations: { ...readOnly, idempotentHint: true },
    },
    async (input) =>
      result(
        {
          items: await analyzeItems(
            (
              await client.getByIds([...new Set(input.community_ids)])
            ).map((item) => candidate(item)),
            input.posts_limit,
            input.analysis_terms,
            input.exclude_terms,
            input.exclude_match_mode,
          ),
        },
        "Сообщества проанализированы.",
      ),
  );
  server.registerTool(
    "vk_score_communities",
    {
      title: "Оценить сообщества VK",
      description:
        "Выполняет локальный скоринг 0–100 по пользовательским весам и кластерам.",
      inputSchema: {
        community_ids: z
          .array(z.number().int().positive())
          .min(1)
          .max(500),
        scoring_rules: scoringRulesSchema,
        clusters: z.array(clusterSchema).max(50).default([]),
      },
      outputSchema: { items: z.array(scoreSchema) },
      annotations: { ...readOnly, idempotentHint: true },
    },
    async ({ community_ids, scoring_rules, clusters }) => {
      const rules = resolveRules(scoring_rules, [], []);
      const communities = await analyzeItems(
        (
          await client.getByIds([...new Set(community_ids)])
        ).map((item) => candidate(item)),
        30,
        strings(rules.terms),
        strings(rules.exclude_terms),
        "word_prefix",
      );
      return result(
        { items: score(communities, rules, clusters) },
        "Скоринг выполнен.",
      );
    },
  );
  server.registerTool(
    "vk_export_community_candidates",
    {
      title: "Экспортировать кандидатов сообществ VK",
      description:
        "Формирует CSV или JSON в памяти со статусом pending_approval.",
      inputSchema: {
        communities: z.array(candidateSchema).min(1).max(500),
        scores: z.array(scoreSchema).max(500).default([]),
        format: z.enum(["csv", "json"]),
      },
      outputSchema: {
        format: z.enum(["csv", "json"]),
        content: z.string(),
        row_count: z.number().int().nonnegative(),
      },
      annotations: { ...readOnly, idempotentHint: true },
    },
    async ({ communities, scores, format }) => {
      const byId = new Map(scores.map((item) => [item.id, item]));
      const rows = communities.map((item) => {
        const scored = byId.get(item.id);
        return {
          id: item.id,
          url: item.url,
          name: item.name,
          description: item.description,
          members_count: item.members_count,
          activity: item.activity?.last_post_at ?? null,
          score: scored?.score ?? null,
          cluster: scored?.clusters.join("|") ?? "",
          reasons: scored?.reasons.join("|") ?? "",
          risk_flags: [
            ...item.risk_flags,
            ...(scored?.risk_flags ?? []),
          ].join("|"),
          status: "pending_approval",
        };
      });
      return result(
        {
          format,
          content:
            format === "json"
              ? JSON.stringify(rows)
              : toCsv(rows),
          row_count: rows.length,
        },
        "Экспорт сформирован в памяти.",
      );
    },
  );
}

function result(
  structuredContent: Record<string, unknown>,
  message: string,
) {
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent,
  };
}

function asObject(value: unknown): Record<string, unknown> {
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

function objects(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null &&
          typeof item === "object" &&
          !Array.isArray(item),
      )
    : [];
}

function compareResearchItems(
  left: ResearchItem,
  right: ResearchItem,
): number {
  return (
    right.score - left.score ||
    (Date.parse(right.activity?.last_post_at ?? "") || 0) -
      (Date.parse(left.activity?.last_post_at ?? "") || 0) ||
    (right.members_count ?? 0) - (left.members_count ?? 0) ||
    left.id - right.id
  );
}

function sameStrings(left: string[], right: string[]): boolean {
  const normalize = (values: string[]) =>
    [...new Set(values.map((value) =>
      value.trim().toLocaleLowerCase("ru-RU"),
    ))].sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  const columns = Object.keys(rows[0] ?? {});
  const escape = (value: unknown): string =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    columns.map(escape).join(","),
    ...rows.map((row) =>
      columns.map((column) => escape(row[column])).join(","),
    ),
  ].join("\n");
}
