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
  type ConceptRule,
  type ContextualSignal,
  type ExcludeMatchMode,
  type NegativeCluster,
  type Score,
  type TermStrength,
} from "./analysis.js";
import {
  DEFAULT_ANALYSIS_POLICY,
  preselectCandidates,
  type AnalysisPolicy,
  type PreselectionResult,
} from "./preselection.js";
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
type CommunitySearchMode = CommunitySearchSort | "both";
type ResearchInput = {
  keywords: string[];
  include_terms: string[];
  exclude_terms: string[];
  exclude_match_mode: ExcludeMatchMode;
  exclude_policy: "soft" | "hard";
  search_sort?: CommunitySearchMode | undefined;
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
  analysis_policy: AnalysisPolicy;
  scoring_rules?: Record<string, unknown> | undefined;
  clusters: Array<Record<string, unknown>>;
};

const communityTypeSchema = z.enum(["group", "page", "event"]);
const activitySchema = z.object({
  last_post_at: z.string().nullable(),
  posts_per_week: z.number().nullable(),
  posts_30d: z.number().int().nonnegative().default(0),
  posts_90d: z.number().int().nonnegative().default(0),
  posts_per_week_30d: z.number().nonnegative().default(0),
  posts_per_week_90d: z.number().nonnegative().default(0),
  median_posts_per_week_90d: z.number().nonnegative().default(0),
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
  exclusion_post_share: z.number().min(0).max(1).default(0),
  intent_term_matches: z.array(z.string()).default([]),
  intent_term_match_counts: z.record(
    z.string(),
    z.number().int().nonnegative(),
  ).default({}),
  compatibility_term_matches: z.array(z.string()).default([]),
  compatibility_term_match_counts: z.record(
    z.string(),
    z.number().int().nonnegative(),
  ).default({}),
  analyzed_terms: z.array(z.string()).default([]),
  analyzed_exclude_terms: z.array(z.string()).default([]),
  analyzed_intent_terms: z.array(z.string()).default([]),
  analyzed_compatibility_terms: z.array(z.string()).default([]),
  post_term_sets: z.array(z.array(z.string())).default([]),
  post_exclude_term_sets: z.array(z.array(z.string())).default([]),
  post_intent_term_sets: z.array(z.array(z.string())).default([]),
  post_compatibility_term_sets: z.array(z.array(z.string())).default([]),
  concept_matches: z.array(z.string()).default([]),
  concept_match_counts: z.record(
    z.string(),
    z.number().int().nonnegative(),
  ).default({}),
  contextual_signal_matches: z.array(z.string()).default([]),
  contextual_signal_match_counts: z.record(
    z.string(),
    z.number().int().nonnegative(),
  ).default({}),
  negative_cluster_matches: z.array(z.string()).default([]),
  negative_cluster_post_shares: z.record(
    z.string(),
    z.number().min(0).max(1),
  ).default({}),
  post_concept_sets: z.array(z.array(z.string())).default([]),
  post_contextual_signal_sets: z.array(z.array(z.string())).default([]),
  post_negative_cluster_sets: z.array(z.array(z.string())).default([]),
  analysis_fingerprint: z.string().nullable().default(null),
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
  discovery: z
    .object({
      queries: z.array(z.string()),
      sorts: z.array(z.enum(["relevance", "members"])),
      occurrences: z.number().int().positive(),
      best_relevance_rank: z.number().int().positive().nullable(),
      best_members_rank: z.number().int().positive().nullable(),
    })
    .optional(),
  preselection: z
    .object({
      metadata_score: z.number(),
      score_ceiling: z.number().min(0).max(100),
      matched_strong_signals: z.array(z.string()),
      matched_medium_signals: z.array(z.string()),
      matched_weak_signals: z.array(z.string()),
      matched_target_clusters: z.array(z.string()),
      matched_negative_clusters: z.array(z.string()),
      selection_reasons: z.array(z.string()),
    })
    .optional(),
  analysis_source: z.enum(["vk", "cache"]).optional(),
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
  intent_term: 15,
  exclude_metadata_penalty: 30,
  exclude_post_share_penalty: 30,
} as const;
export const DEFAULT_RECOMMENDATION_SCORE = 45;
export const DEFAULT_REVIEW_SCORE = 30;
const scoreSchema = z.object({
  id: z.number().int().positive(),
  score: z.number().min(0).max(100),
  raw_score: z.number(),
  normalized_score: z.number().min(0).max(100),
  components: z.object({
    content_relevance: z.number(),
    audience_intent: z.number(),
    activity: z.number(),
    profile_fit: z.number(),
    exclusion_risk: z.number(),
  }),
  compatibility_matches: z.array(z.string()),
  concept_matches: z.array(z.string()).default([]),
  contextual_signal_matches: z.array(z.string()).default([]),
  negative_cluster_matches: z.array(z.string()).default([]),
  blocking_risks: z.array(z.string()).default([]),
  status_reason: z.string().default("legacy_score"),
  recommendation: z.enum(["recommended", "review", "rejected"]),
  clusters: z.array(z.string()),
  reasons: z.array(z.string()),
  risk_flags: z.array(z.string()),
});
const conceptRuleSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    strength: z.enum(["strong", "medium", "weak"]),
    phrases: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(30),
    weight: z.number().finite().positive().max(100),
  })
  .strict();
const contextualSignalSchema = z
  .object({
    term: z.string().trim().min(1).max(120),
    requires_any: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(30),
    max_token_distance: z.number().int().min(0).max(100).default(12),
    weight: z.number().finite().positive().max(100).default(1),
  })
  .strict();
const negativeClusterSchema = z
  .object({
    id: z.string().trim().min(1).max(120),
    terms: z
      .array(z.string().trim().min(1).max(120))
      .min(1)
      .max(50),
    contextual_terms: z.array(contextualSignalSchema).max(30).optional(),
    metadata_action: z.enum(["penalty", "review", "reject"]).default("penalty"),
    post_share_review: z.number().min(0).max(1).optional(),
    post_share_reject: z.number().min(0).max(1).optional(),
  })
  .strict()
  .superRefine((cluster, context) => {
    if (
      cluster.post_share_review !== undefined &&
      cluster.post_share_reject !== undefined &&
      cluster.post_share_review > cluster.post_share_reject
    ) {
      context.addIssue({
        code: "custom",
        path: ["post_share_review"],
        message:
          "post_share_review не может быть больше post_share_reject.",
      });
    }
  });
const scoringRulesSchema = z
  .object({
    terms: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    term_strengths: z
      .record(
        z.string().trim().min(1).max(120),
        z.enum(["strong", "medium", "weak"]),
      )
      .optional(),
    min_weak_matches: z.number().int().min(2).max(10).optional(),
    intent_terms: z
      .array(z.string().trim().min(1).max(120))
      .max(50)
      .optional(),
    compatibility_terms: z
      .array(z.string().trim().min(1).max(120))
      .max(50)
      .optional(),
    concepts: z.array(conceptRuleSchema).max(50).optional(),
    contextual_signals: z
      .array(contextualSignalSchema)
      .max(50)
      .optional(),
    negative_clusters: z
      .array(negativeClusterSchema)
      .max(50)
      .optional(),
    recommendation_blockers: z
      .array(z.string().trim().min(1).max(120))
      .max(30)
      .optional(),
    exclude_terms: z
      .array(z.string().trim().min(1).max(120))
      .max(50)
      .optional(),
    weights: z
      .object({
        name_term: z.number().finite().nonnegative().optional(),
        description_term: z.number().finite().nonnegative().optional(),
        post_term: z.number().finite().nonnegative().optional(),
        intent_term: z.number().finite().nonnegative().optional(),
        activity_fresh: z.number().finite().nonnegative().optional(),
        activity_low_penalty: z.number().finite().nonnegative().optional(),
        thematic_post_share: z.number().finite().nonnegative().optional(),
        thematic_low_penalty: z.number().finite().nonnegative().optional(),
        members_range: z.number().finite().nonnegative().optional(),
        exclude_term_penalty: z.number().finite().nonnegative().optional(),
        exclude_metadata_penalty: z.number().finite().nonnegative().optional(),
        exclude_post_share_penalty: z.number().finite().nonnegative().optional(),
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
    intent_term_weights: z
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
        intent_term: z.number().finite().positive().optional(),
      })
      .strict()
      .optional(),
    activity_fresh_days: z.number().int().positive().max(3650).optional(),
    min_posts_per_week: z.number().nonnegative().max(10_000).optional(),
    min_thematic_post_share: z.number().min(0).max(1).optional(),
    low_thematic_post_share_threshold: z
      .number()
      .min(0)
      .max(1)
      .optional(),
    reject_inactive: z.boolean().optional(),
    inactive_posts_30d_max: z.number().int().nonnegative().max(10_000).optional(),
    inactive_posts_90d_max: z.number().int().nonnegative().max(10_000).optional(),
    require_strong_signal_for_recommendation: z.boolean().optional(),
    require_target_cluster_for_recommendation: z.boolean().optional(),
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
      rules.low_thematic_post_share_threshold !== undefined &&
      rules.min_thematic_post_share !== undefined &&
      rules.low_thematic_post_share_threshold >
        rules.min_thematic_post_share
    ) {
      context.addIssue({
        code: "custom",
        path: ["low_thematic_post_share_threshold"],
        message:
          "Порог блокирующего риска не может быть выше целевой тематической доли.",
      });
    }
    const uniqueIds = (
      items: Array<{ id: string }> | undefined,
      path: string,
    ): void => {
      const seen = new Set<string>();
      for (const [index, item] of (items ?? []).entries()) {
        const key = item.id.toLocaleLowerCase("ru-RU");
        if (seen.has(key)) {
          context.addIssue({
            code: "custom",
            path: [path, index, "id"],
            message: "Идентификаторы должны быть уникальными.",
          });
        }
        seen.add(key);
      }
    };
    uniqueIds(rules.concepts, "concepts");
    uniqueIds(rules.negative_clusters, "negative_clusters");
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
    if (rules.terms !== undefined && rules.term_strengths !== undefined) {
      const terms = new Set(
        rules.terms.map((term) => term.toLocaleLowerCase("ru-RU")),
      );
      for (const term of Object.keys(rules.term_strengths)) {
        if (!terms.has(term.toLocaleLowerCase("ru-RU"))) {
          context.addIssue({
            code: "custom",
            path: ["term_strengths", term],
            message:
              "Ключ term_strengths должен точно совпадать с одним из terms.",
          });
        }
      }
    }
    if (
      rules.intent_terms !== undefined &&
      rules.intent_term_weights !== undefined
    ) {
      const intentTerms = new Set(
        rules.intent_terms.map((term) => term.toLocaleLowerCase("ru-RU")),
      );
      for (const term of Object.keys(rules.intent_term_weights)) {
        if (!intentTerms.has(term.toLocaleLowerCase("ru-RU"))) {
          context.addIssue({
            code: "custom",
            path: ["intent_term_weights", term],
            message:
              "Ключ intent_term_weights должен точно совпадать с одним из intent_terms.",
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
      (rules.weights?.intent_term ??
        DEFAULT_SCORING_WEIGHTS.intent_term) +
      (rules.weights?.activity_fresh ??
        DEFAULT_SCORING_WEIGHTS.activity_fresh) +
      (rules.weights?.thematic_post_share ??
        DEFAULT_SCORING_WEIGHTS.thematic_post_share);
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
const analysisPolicySchema = z
  .object({
    mode: z.enum(["efficient", "exhaustive"]).default("efficient"),
    initial_candidates: z.number().int().min(25).max(10_000).default(100),
    max_candidates: z.number().int().min(25).max(10_000).default(300),
    batch_size: z.number().int().min(1).max(100).default(25),
    primary_share: z.number().min(0).max(1).default(0.65),
    small_community_share: z.number().min(0).max(1).default(0.15),
    query_share: z.number().min(0).max(1).default(0.1),
    exploration_share: z.number().min(0).max(0.5).default(0.1),
    target_recommended: z.number().int().nonnegative().max(10_000).default(20),
    target_review: z.number().int().nonnegative().max(10_000).default(30),
    stable_batches: z.number().int().min(1).max(20).default(3),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.initial_candidates > policy.max_candidates) {
      context.addIssue({
        code: "custom",
        path: ["initial_candidates"],
        message:
          "initial_candidates не может быть больше max_candidates.",
      });
    }
    const totalShare =
      policy.primary_share +
      policy.small_community_share +
      policy.query_share +
      policy.exploration_share;
    if (totalShare > 1.000_001) {
      context.addIssue({
        code: "custom",
        path: ["primary_share"],
        message: "Сумма долей shortlist не может быть больше 1.",
      });
    }
  });
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
  search_sort: z.enum(["relevance", "members", "both"]).default("both"),
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
  posts_limit: z.number().int().min(1).max(100).default(100),
  analysis_policy: analysisPolicySchema.default(DEFAULT_ANALYSIS_POLICY),
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
  scoring_version: z.enum([
    "community-research-v2",
    "community-research-v3",
    "community-research-v4",
  ]),
  status: z.enum(["queued", "running", "completed", "failed"]),
  request: z.record(z.string(), z.unknown()),
  progress: z.object({
    phase: z
      .enum(["queued", "discovering", "analyzing", "completed"])
      .default("analyzing"),
    discovered: z.number().int().nonnegative(),
    selected: z.number().int().nonnegative(),
    processed: z.number().int().nonnegative(),
    analyzed: z.number().int().nonnegative().default(0),
    remaining: z.number().int().nonnegative(),
    batch_size: z.number().int().positive(),
    batches_total: z.number().int().nonnegative(),
    batches_completed: z.number().int().nonnegative(),
    metadata_scored: z.number().int().nonnegative().default(0),
    score_ceiling_rejected: z.number().int().nonnegative().default(0),
    shortlisted: z.number().int().nonnegative().default(0),
    cached: z.number().int().nonnegative().default(0),
    skipped: z.number().int().nonnegative().default(0),
    remaining_shortlist: z.number().int().nonnegative().default(0),
    remaining_discovery: z.number().int().nonnegative().default(0),
    analysis_mode: z.enum(["efficient", "exhaustive"]).default("efficient"),
    exhaustive: z.boolean().default(false),
    stop_reason: z.string().nullable().default(null),
    estimated_wall_requests_saved: z
      .number()
      .int()
      .nonnegative()
      .default(0),
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
    metadata_scored: z.number().int().nonnegative().default(0),
    score_ceiling_rejected: z.number().int().nonnegative().default(0),
    shortlisted: z.number().int().nonnegative().default(0),
    cached: z.number().int().nonnegative().default(0),
    skipped: z.number().int().nonnegative().default(0),
    estimated_wall_requests_saved: z.number().int().nonnegative().default(0),
    analysis_mode: z.enum(["efficient", "exhaustive"]).default("efficient"),
    exhaustive: z.boolean().default(false),
    stop_reason: z.string().nullable().default(null),
  }),
  passed: z.array(researchItemSchema),
  review: z.array(researchItemSchema),
  rejected: z.array(researchItemSchema),
  skipped_candidates: z.array(candidateSchema).default([]),
  error: z.string().optional(),
  rescore_of: z.string().uuid().optional(),
};

export function registerVkCommunityTools(
  server: McpServer,
  dependencies: VkCommunityToolDependencies,
): void {
  const { client, store } = dependencies;
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
        const sorts: CommunitySearchSort[] =
          (input.search_sort ?? "both") === "both"
            ? ["relevance", "members"]
            : [input.search_sort as CommunitySearchSort];
        for (const sort of sorts) {
          let queryCandidates = 0;
          let queryPages = 0;
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
          const providerRanks = new Map(
            page.items.map((item, index) => [
              item.id,
              offset + index + 1,
            ]),
          );
          const pageCandidates = (
            await client.getByIds(page.items.map((item) => item.id))
          ).map((item) => candidate(item));
          for (const item of pageCandidates) {
            enrichedIds.add(item.id);
            const existing = found.get(item.id);
            const rank = providerRanks.get(item.id) ?? offset + 1;
            const previousEvidence = existing?.discovery;
            item.discovery = {
              queries: [
                ...new Set([
                  ...(previousEvidence?.queries ?? []),
                  keyword,
                ]),
              ].sort((left, right) => left.localeCompare(right, "ru")),
              sorts: [
                ...new Set([
                  ...(previousEvidence?.sorts ?? []),
                  sort,
                ]),
              ].sort(),
              occurrences: (previousEvidence?.occurrences ?? 0) + 1,
              best_relevance_rank:
                sort === "relevance"
                  ? Math.min(
                      previousEvidence?.best_relevance_rank ??
                        Number.MAX_SAFE_INTEGER,
                      rank,
                    )
                  : previousEvidence?.best_relevance_rank ?? null,
              best_members_rank:
                sort === "members"
                  ? Math.min(
                      previousEvidence?.best_members_rank ??
                        Number.MAX_SAFE_INTEGER,
                      rank,
                    )
                  : previousEvidence?.best_members_rank ?? null,
            };
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
            found.set(item.id, {
              ...(existing ?? item),
              ...item,
              risk_flags: [
                ...new Set([
                  ...(existing?.risk_flags ?? []),
                  ...item.risk_flags,
                ]),
              ],
            });
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
    }
    const items = [...found.values()];
    items.sort((left, right) => {
      if ((input.search_sort ?? "both") === "members") {
        return (
          (left.discovery?.best_members_rank ?? Number.MAX_SAFE_INTEGER) -
            (right.discovery?.best_members_rank ?? Number.MAX_SAFE_INTEGER) ||
          left.id - right.id
        );
      }
      return (
        (left.discovery?.best_relevance_rank ?? Number.MAX_SAFE_INTEGER) -
          (right.discovery?.best_relevance_rank ?? Number.MAX_SAFE_INTEGER) ||
        (right.discovery?.occurrences ?? 0) -
          (left.discovery?.occurrences ?? 0) ||
        (right.members_count ?? 0) - (left.members_count ?? 0) ||
        left.id - right.id
      );
    });
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
    rules: Record<string, unknown>,
    excludeMatchMode: ExcludeMatchMode,
  ): Promise<Candidate[]> => {
    const terms = strings(rules.terms);
    const excludes = strings(rules.exclude_terms);
    const fingerprint = analysisFingerprint(
      rules,
      excludeMatchMode,
      postsLimit,
    );
    const cachedActivities =
      typeof store.findCachedActivities === "function"
        ? await store.findCachedActivities(
            items.map((item) => item.id),
            fingerprint,
          )
        : new Map();
    for (const item of items) {
      if (
        item.risk_flags.some(
          (flag) => flag !== "exclude_term_in_metadata",
        )
      ) {
        continue;
      }
      const cached = cachedActivities.get(item.id);
      if (cached !== undefined) {
        item.activity = cached;
        item.analysis_source = "cache";
        item.risk_flags.push(...cached.risk_flags);
        continue;
      }
      try {
        item.activity = analyze(
          await client.wall(item.id, postsLimit),
          terms,
          excludes,
          excludeMatchMode,
          {
            termStrengths: termStrengths(rules.term_strengths),
            minWeakMatches:
              typeof rules.min_weak_matches === "number"
                ? rules.min_weak_matches
                : 2,
            intentTerms: strings(rules.intent_terms),
            compatibilityTerms: strings(rules.compatibility_terms),
            concepts: conceptRules(rules.concepts),
            contextualSignals: contextualSignals(
              rules.contextual_signals,
            ),
            negativeClusters: negativeClusters(
              rules.negative_clusters,
            ),
            analysisFingerprint: fingerprint,
          },
        );
        item.analysis_source = "vk";
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
        intent_term: 3,
      },
      term_strengths: {},
      min_weak_matches: 2,
      intent_terms: [],
      compatibility_terms: [],
      concepts: [],
      contextual_signals: [],
      negative_clusters: [],
      recommendation_blockers: [],
      activity_fresh_days: 30,
      min_posts_per_week: 1,
      min_thematic_post_share: 0.5,
      low_thematic_post_share_threshold: 0.3,
      reject_inactive: true,
      inactive_posts_30d_max: 0,
      inactive_posts_90d_max: 1,
      require_strong_signal_for_recommendation: true,
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
      intent_term_weights: {
        ...asObject(base.intent_term_weights),
        ...asObject(overrides.intent_term_weights),
      },
      term_strengths: {
        ...asObject(base.term_strengths),
        ...asObject(overrides.term_strengths),
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
          ...result,
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
    preselection?: PreselectionResult,
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
      scoring_version: "community-research-v4",
      status,
      request: buildRequest(input, rules),
      progress: {
        phase: status === "completed" ? "completed" : "queued",
        discovered: discovery.items.length,
        selected: selected.length,
        processed: status === "completed" ? selected.length : 0,
        analyzed: status === "completed" ? selected.length : 0,
        remaining: status === "completed" ? 0 : selected.length,
        batch_size: input.analysis_policy.batch_size,
        batches_total: Math.ceil(
          selected.length / input.analysis_policy.batch_size,
        ),
        batches_completed:
          status === "completed"
            ? Math.ceil(
                selected.length / input.analysis_policy.batch_size,
              )
            : 0,
        metadata_scored: preselection?.metadataScored ?? 0,
        score_ceiling_rejected:
          preselection?.scoreCeilingRejected ?? 0,
        shortlisted: selected.length,
        cached: 0,
        skipped: preselection?.skipped.length ?? 0,
        remaining_shortlist: status === "completed" ? 0 : selected.length,
        remaining_discovery:
          Math.max(0, discovery.items.length - selected.length),
        analysis_mode: input.analysis_policy.mode,
        exhaustive:
          input.analysis_policy.mode === "exhaustive" &&
          selected.length + (preselection?.skipped.length ?? 0) ===
            discovery.items.length,
        stop_reason: status === "completed"
          ? "all_candidates_analyzed"
          : null,
        estimated_wall_requests_saved:
          preselection?.skipped.length ?? 0,
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
        analysis_batch_size: input.analysis_policy.batch_size,
        analysis_batches: 0,
        posts_unavailable: 0,
        passed: 0,
        review: 0,
        rejected: 0,
        search_pages: discovery.searchPages,
        incomplete: incompleteReasons.length > 0,
        incomplete_reasons: incompleteReasons,
        metadata_scored: preselection?.metadataScored ?? 0,
        score_ceiling_rejected:
          preselection?.scoreCeilingRejected ?? 0,
        shortlisted: selected.length,
        cached: 0,
        skipped: preselection?.skipped.length ?? 0,
        estimated_wall_requests_saved:
          preselection?.skipped.length ?? 0,
        analysis_mode: input.analysis_policy.mode,
        exhaustive:
          input.analysis_policy.mode === "exhaustive" &&
          selected.length + (preselection?.skipped.length ?? 0) ===
            discovery.items.length,
        stop_reason: status === "completed"
          ? "all_candidates_analyzed"
          : null,
      },
      ...(status === "queued" ? { pending: selected } : {}),
      passed: [],
      review: [],
      rejected: [],
      skipped_candidates: preselection?.skipped ?? [],
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
    preselection: PreselectionResult;
  }> => {
    const rules = resolveRules(
      input.scoring_rules,
      [...new Set([...input.keywords, ...input.include_terms])],
      input.exclude_terms,
    );
    rules.exclude_match_mode = input.exclude_match_mode;
    const terms = strings(rules.terms);
    const excludes = strings(rules.exclude_terms);
    const discovery = await discover(input);
    const preselection = preselectCandidates(
      discovery.items,
      rules,
      input.clusters,
      input.analysis_policy,
    );
    return {
      discovery,
      selected: preselection.selected,
      rules,
      terms,
      excludes,
      preselection,
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
    const input: ResearchInput = {
      ...rawInput,
      analysis_policy:
        rawInput.analysis_policy ?? DEFAULT_ANALYSIS_POLICY,
    };
    const prepared = await prepare(input);
    const analyzed = await analyzeItems(
      prepared.selected,
      input.posts_limit,
      prepared.rules,
      input.exclude_match_mode,
    );
    const items = rank(analyzed, prepared.rules, input.clusters);
    const run = createRun(
      input,
      prepared.discovery,
      prepared.selected,
      prepared.rules,
      "completed",
      prepared.preselection,
    );
    const progress = run.progress as Record<string, unknown>;
    const summary = run.summary as Record<string, unknown>;
    summary.analyzed = analyzed.filter(
      (item) => item.activity !== undefined,
    ).length;
    const cached = analyzed.filter(
      (item) => item.analysis_source === "cache",
    ).length;
    summary.cached = cached;
    summary.estimated_wall_requests_saved =
      Number(summary.estimated_wall_requests_saved ?? 0) + cached;
    progress.cached = cached;
    progress.analyzed = analyzed.length;
    progress.estimated_wall_requests_saved =
      summary.estimated_wall_requests_saved;
    summary.analysis_batches = Math.ceil(
      analyzed.length / input.analysis_policy.batch_size,
    );
    progress.processed = analyzed.length;
    progress.remaining = 0;
    progress.batches_completed = Math.ceil(
      analyzed.length / input.analysis_policy.batch_size,
    );
    const exhaustive = analyzed.length === prepared.discovery.items.length;
    const stopReason = exhaustive
      ? "all_candidates_analyzed"
      : "analysis_budget_limit";
    progress.exhaustive = exhaustive;
    progress.stop_reason = stopReason;
    progress.remaining_discovery = Math.max(
      0,
      prepared.discovery.items.length - analyzed.length,
    );
    summary.exhaustive = exhaustive;
    summary.stop_reason = stopReason;
    if (!exhaustive) {
      summary.incomplete = true;
      summary.incomplete_reasons = [
        ...new Set([
          ...((summary.incomplete_reasons as string[]) ?? []),
          "analysis_budget_limit",
        ]),
      ];
    }
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
    const input: ResearchInput = {
      ...rawInput,
      analysis_policy:
        rawInput.analysis_policy ?? DEFAULT_ANALYSIS_POLICY,
    };
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
          prepared.preselection,
        );
        run.request = preparedRun.request;
        run.progress = preparedRun.progress;
        run.summary = preparedRun.summary;
        run.pending = preparedRun.pending;
        const preparedProgress = run.progress as Record<string, unknown>;
        preparedProgress.phase =
          prepared.selected.length === 0 ? "completed" : "analyzing";
        if (prepared.selected.length === 0) {
          run.status = "completed";
          const stopReason =
            prepared.discovery.items.length === 0
              ? "all_candidates_analyzed"
              : "score_ceiling_below_review_threshold";
          preparedProgress.stop_reason = stopReason;
          preparedProgress.exhaustive =
            prepared.discovery.items.length === 0;
          const summary = run.summary as Record<string, unknown>;
          summary.stop_reason = stopReason;
          summary.exhaustive = prepared.discovery.items.length === 0;
          if (prepared.discovery.items.length > 0) {
            summary.incomplete = true;
            summary.incomplete_reasons = [
              ...new Set([
                ...strings(summary.incomplete_reasons),
                stopReason,
              ]),
            ];
          }
        }
        await store.save(run);
        let previousSuitable = 0;
        let stagnantBatches = 0;
        let previousTop = "";
        let stableTopBatches = 0;
        while (Array.isArray(run.pending) && run.pending.length > 0) {
          const batch = (run.pending as Candidate[]).splice(
            0,
            input.analysis_policy.batch_size,
          );
          const analyzed = await analyzeItems(
            batch,
            input.posts_limit,
            prepared.rules,
            input.exclude_match_mode,
          );
          const currentItems = [
            ...(run.passed as ResearchItem[]),
            ...(run.review as ResearchItem[]),
            ...(run.rejected as ResearchItem[]),
            ...rank(analyzed, prepared.rules, input.clusters),
          ];
          updatePartitions(run, currentItems);
          const progress = run.progress as Record<string, unknown>;
          const summary = run.summary as Record<string, unknown>;
          progress.processed =
            Number(progress.processed ?? 0) + batch.length;
          progress.analyzed = progress.processed;
          progress.remaining =
            Number(progress.remaining ?? 0) - batch.length;
          progress.batches_completed =
            Number(progress.batches_completed ?? 0) + 1;
          summary.analyzed = Number(progress.processed ?? 0);
          const cachedInBatch = analyzed.filter(
            (item) => item.analysis_source === "cache",
          ).length;
          progress.cached =
            Number(progress.cached ?? 0) + cachedInBatch;
          summary.cached = Number(progress.cached ?? 0);
          summary.estimated_wall_requests_saved =
            Number(summary.estimated_wall_requests_saved ?? 0) +
            cachedInBatch;
          progress.estimated_wall_requests_saved =
            summary.estimated_wall_requests_saved;
          summary.analysis_batches =
            Number(progress.batches_completed ?? 0);
          progress.remaining_shortlist = run.pending.length;
          const suitable =
            Number(summary.passed ?? 0) + Number(summary.review ?? 0);
          stagnantBatches =
            suitable === previousSuitable ? stagnantBatches + 1 : 0;
          previousSuitable = suitable;
          const top = [
            ...(run.passed as ResearchItem[]),
            ...(run.review as ResearchItem[]),
          ]
            .sort(compareResearchItems)
            .slice(0, 10)
            .map((item) => item.id)
            .join(",");
          stableTopBatches =
            top.length > 0 && top === previousTop
              ? stableTopBatches + 1
              : 0;
          previousTop = top;
          const enoughProcessed =
            Number(progress.processed ?? 0) >=
              input.analysis_policy.initial_candidates;
          const targetsReached =
            Number(summary.passed ?? 0) >=
              input.analysis_policy.target_recommended &&
            Number(summary.review ?? 0) >=
              input.analysis_policy.target_review;
          const topItems = [
            ...(run.passed as ResearchItem[]),
            ...(run.review as ResearchItem[]),
          ]
            .sort(compareResearchItems)
            .slice(0, 10);
          const lastTopScore =
            topItems.length === 10
              ? topItems.at(-1)?.normalized_score
              : undefined;
          const remainingCandidates = [
            ...((run.pending as Candidate[]) ?? []),
            ...((run.skipped_candidates as Candidate[]) ?? []),
          ];
          const maximumRemainingCeiling = Math.max(
            -1,
            ...remainingCandidates.map(
              (item) => item.preselection?.score_ceiling ?? 100,
            ),
          );
          const topMathematicallyStable =
            lastTopScore !== undefined &&
            lastTopScore > maximumRemainingCeiling;
          let stopReason: string | null = null;
          if (run.pending.length === 0) {
            stopReason =
              prepared.selected.length === prepared.discovery.items.length
                ? "all_candidates_analyzed"
                : "analysis_budget_limit";
          } else if (topMathematicallyStable) {
            stopReason = "top_results_stable";
          } else if (
            enoughProcessed &&
            targetsReached &&
            stableTopBatches >= input.analysis_policy.stable_batches
          ) {
            stopReason = "target_counts_reached";
          } else if (
            enoughProcessed &&
            stagnantBatches >= input.analysis_policy.stable_batches
          ) {
            stopReason = "no_relevant_gain";
          }
          if (stopReason !== null) {
            const unprocessed = [...(run.pending as Candidate[])];
            for (const item of unprocessed) {
              item.risk_flags.push("analysis_stopped_before_wall");
            }
            run.skipped_candidates = [
              ...((run.skipped_candidates as Candidate[]) ?? []),
              ...unprocessed,
            ];
            summary.skipped =
              Number(summary.skipped ?? 0) + unprocessed.length;
            progress.skipped = summary.skipped;
            summary.estimated_wall_requests_saved =
              Number(summary.estimated_wall_requests_saved ?? 0) +
              unprocessed.length;
            progress.estimated_wall_requests_saved =
              summary.estimated_wall_requests_saved;
            progress.remaining_shortlist = unprocessed.length;
            progress.remaining = 0;
            progress.remaining_discovery = Math.max(
              0,
              prepared.discovery.items.length -
                Number(progress.processed ?? 0),
            );
            run.pending = [];
            run.status = "completed";
            progress.stop_reason = stopReason;
            summary.stop_reason = stopReason;
            const exhaustive =
              Number(progress.processed ?? 0) ===
              prepared.discovery.items.length;
            progress.exhaustive = exhaustive;
            summary.exhaustive = exhaustive;
            if (!exhaustive) {
              summary.incomplete = true;
              summary.incomplete_reasons = [
                ...new Set([
                  ...((summary.incomplete_reasons as string[]) ?? []),
                  stopReason,
                ]),
              ];
            }
          }
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
        "Сразу создаёт запуск; поиск и анализ публичных сообществ выполняются в фоне настраиваемыми пакетами.",
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
      const suppliedRules = scoring_rules ?? {};
      const mergedOverrides = {
        ...savedRules,
        ...suppliedRules,
        weights: {
          ...asObject(savedRules.weights),
          ...asObject(suppliedRules.weights),
        },
        term_weights: {
          ...asObject(savedRules.term_weights),
          ...asObject(suppliedRules.term_weights),
        },
        intent_term_weights: {
          ...asObject(savedRules.intent_term_weights),
          ...asObject(suppliedRules.intent_term_weights),
        },
        term_strengths: {
          ...asObject(savedRules.term_strengths),
          ...asObject(suppliedRules.term_strengths),
        },
        per_match_weights: {
          ...asObject(savedRules.per_match_weights),
          ...asObject(suppliedRules.per_match_weights),
        },
      };
      const rules = resolveRules(
        mergedOverrides,
        strings(savedRules.terms).length > 0
          ? strings(savedRules.terms)
          : [...strings(request.keywords), ...strings(request.include_terms)],
        strings(savedRules.exclude_terms).length > 0
          ? strings(savedRules.exclude_terms)
          : strings(request.exclude_terms),
      );
      rules.exclude_match_mode =
        request.exclude_match_mode === "substring"
          ? "substring"
          : "word_prefix";
      const rescoreTerms = strings(rules.terms);
      const rescoreExcludes = strings(rules.exclude_terms);
      const rescoreIntentTerms = strings(rules.intent_terms);
      const rescoreCompatibilityTerms = strings(rules.compatibility_terms);
      const termsChanged = !sameStrings(
        rescoreTerms,
        strings(savedRules.terms),
      );
      const excludesChanged = !sameStrings(
        rescoreExcludes,
        strings(savedRules.exclude_terms),
      );
      const intentTermsChanged = !sameStrings(
        rescoreIntentTerms,
        strings(savedRules.intent_terms),
      );
      const compatibilityTermsChanged = !sameStrings(
        rescoreCompatibilityTerms,
        strings(savedRules.compatibility_terms),
      );
      const derivedSignalsChanged = !sameCanonicalValue(
        {
          concepts: rules.concepts,
          contextual_signals: rules.contextual_signals,
          negative_clusters: rules.negative_clusters,
        },
        {
          concepts: savedRules.concepts,
          contextual_signals: savedRules.contextual_signals,
          negative_clusters: savedRules.negative_clusters,
        },
      );
      const missingTerms = new Set<string>();
      const missingExcludes = new Set<string>();
      const missingIntentTerms = new Set<string>();
      const missingCompatibilityTerms = new Set<string>();
      const sourceItems = [
        ...(source.passed as Candidate[]),
        ...((source.review as Candidate[] | undefined) ?? []),
        ...(source.rejected as Candidate[]),
      ].map((item) => {
        const derived =
          item.activity === undefined ||
          (!termsChanged &&
            !excludesChanged &&
            !intentTermsChanged &&
            !compatibilityTermsChanged)
            ? undefined
            : reanalyzeDerivedActivity(
                item.activity,
                rescoreTerms,
                rescoreExcludes,
                {
                  intentTerms: rescoreIntentTerms,
                  compatibilityTerms: rescoreCompatibilityTerms,
                  termStrengths: termStrengths(rules.term_strengths),
                  minWeakMatches:
                    typeof rules.min_weak_matches === "number"
                      ? rules.min_weak_matches
                      : 2,
                },
              );
        for (const term of derived?.missingTerms ?? []) {
          missingTerms.add(term);
        }
        for (const term of derived?.missingExcludes ?? []) {
          missingExcludes.add(term);
        }
        for (const term of derived?.missingIntentTerms ?? []) {
          missingIntentTerms.add(term);
        }
        for (const term of derived?.missingCompatibilityTerms ?? []) {
          missingCompatibilityTerms.add(term);
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
                "inactive_activity_reject",
                "negative_cluster_review",
                "negative_cluster_reject",
                "strong_target_signal_missing",
                "target_cluster_missing",
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
        scoring_version: "community-research-v4",
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
      if (
        missingTerms.size > 0 ||
        missingExcludes.size > 0 ||
        missingIntentTerms.size > 0 ||
        missingCompatibilityTerms.size > 0 ||
        derivedSignalsChanged
      ) {
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
          rescore_missing_intent_terms: [...missingIntentTerms],
          rescore_missing_compatibility_terms: [
            ...missingCompatibilityTerms,
          ],
          rescore_derived_signals_changed: derivedSignalsChanged,
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
        posts_limit: z.number().int().min(1).max(100).default(100),
        analysis_terms: z
          .array(z.string().trim().min(1).max(120))
          .max(50)
          .default([]),
        term_strengths: scoringRulesSchema.shape.term_strengths,
        min_weak_matches: scoringRulesSchema.shape.min_weak_matches,
        intent_terms: scoringRulesSchema.shape.intent_terms,
        compatibility_terms: scoringRulesSchema.shape.compatibility_terms,
        concepts: scoringRulesSchema.shape.concepts,
        contextual_signals: scoringRulesSchema.shape.contextual_signals,
        negative_clusters: scoringRulesSchema.shape.negative_clusters,
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
            {
              terms: input.analysis_terms,
              exclude_terms: input.exclude_terms,
              term_strengths: input.term_strengths ?? {},
              min_weak_matches: input.min_weak_matches ?? 2,
              intent_terms: input.intent_terms ?? [],
              compatibility_terms: input.compatibility_terms ?? [],
              concepts: input.concepts ?? [],
              contextual_signals: input.contextual_signals ?? [],
              negative_clusters: input.negative_clusters ?? [],
            },
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
        100,
        rules,
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

function termStrengths(value: unknown): Record<string, TermStrength> {
  return Object.fromEntries(
    Object.entries(asObject(value)).filter(
      (entry): entry is [string, TermStrength] =>
        entry[1] === "strong" ||
        entry[1] === "medium" ||
        entry[1] === "weak",
    ),
  );
}

function conceptRules(value: unknown): ConceptRule[] {
  return Array.isArray(value) ? (value as ConceptRule[]) : [];
}

function contextualSignals(value: unknown): ContextualSignal[] {
  return Array.isArray(value) ? (value as ContextualSignal[]) : [];
}

function negativeClusters(value: unknown): NegativeCluster[] {
  return Array.isArray(value) ? (value as NegativeCluster[]) : [];
}

function analysisFingerprint(
  rules: Record<string, unknown>,
  excludeMatchMode: ExcludeMatchMode,
  postsLimit: number,
): string {
  return JSON.stringify(
    canonicalize({
      posts_limit: postsLimit,
      exclude_match_mode: excludeMatchMode,
      terms: rules.terms,
      exclude_terms: rules.exclude_terms,
      term_strengths: rules.term_strengths,
      min_weak_matches: rules.min_weak_matches,
      intent_terms: rules.intent_terms,
      compatibility_terms: rules.compatibility_terms,
      concepts: rules.concepts,
      contextual_signals: rules.contextual_signals,
      negative_clusters: rules.negative_clusters,
    }),
  );
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (
    value !== null &&
    typeof value === "object"
  ) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  return value;
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

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
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
