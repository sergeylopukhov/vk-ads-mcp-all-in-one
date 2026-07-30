import {
  matchExcludedTerms,
  matches,
  type Candidate,
  type Score,
} from "./analysis.js";

export type ResearchPurpose =
  | "advertising_audience"
  | "topic_discovery"
  | "competitor_research";

export type CompetitorPolicy = "exclude" | "review" | "include";
export type PersonalChoiceLevel = "low" | "medium" | "high";
export type AudienceRelationship =
  | "target_audience"
  | "adjacent_audience"
  | "partner"
  | "competitor"
  | "provider"
  | "irrelevant"
  | "unknown";

export interface ResearchContext {
  purpose?: ResearchPurpose | undefined;
  offer?: string | undefined;
  conversion_action?: string | undefined;
  target_audience?: string[] | undefined;
  buyer_roles?: string[] | undefined;
  purchase_triggers?: string[] | undefined;
  geography?: string | undefined;
  competitor_policy?: CompetitorPolicy | undefined;
  competitor_policy_confirmed?: boolean | undefined;
  personal_choice_level?: PersonalChoiceLevel | undefined;
  audience_terms?: string[] | undefined;
  adjacent_audience_terms?: string[] | undefined;
  partner_terms?: string[] | undefined;
  competitor_terms?: string[] | undefined;
  provider_terms?: string[] | undefined;
  irrelevant_terms?: string[] | undefined;
}

export interface ResearchPreflight {
  status: "ready" | "needs_clarification" | "invalid_strategy";
  ready: boolean;
  purpose: ResearchPurpose | null;
  missing_fields: string[];
  questions: string[];
  strategy_errors: string[];
  summary: {
    offer: string | null;
    conversion_action: string | null;
    target_audience: string[];
    purchase_triggers: string[];
    geography: string | null;
    competitor_policy: CompetitorPolicy | null;
    personal_choice_level: PersonalChoiceLevel | null;
  };
}

export interface AudienceClassification {
  audience_relationship: AudienceRelationship;
  relationship_reasons: string[];
  buyer_signals: string[];
  provider_signals: string[];
  competitor_signals: string[];
  applied_competitor_policy: CompetitorPolicy | null;
}

const PROVIDER_STRATEGY_ERROR =
  "Поисковые запросы описывают поставщиков услуги, но не целевую аудиторию. Укажите покупателей, жизненные события и смежные сообщества.";

export function preflightResearch(
  context: ResearchContext | undefined,
  keywords: string[],
  clusters: Array<Record<string, unknown>>,
): ResearchPreflight {
  if (context?.purpose === "topic_discovery") {
    return readyPreflight(context);
  }
  if (context?.purpose === "competitor_research") {
    const missing = [
      ...(nonempty(context.offer) ? [] : ["offer"]),
      ...((context.competitor_terms?.length ?? 0) > 0
        ? []
        : ["competitor_terms"]),
    ];
    return missing.length === 0
      ? readyPreflight(context)
      : clarificationPreflight(context, missing);
  }

  const missing: string[] = [];
  if (context?.purpose !== "advertising_audience") {
    missing.push("research_context.purpose");
  }
  if (!nonempty(context?.offer)) missing.push("offer");
  if (!nonempty(context?.conversion_action)) {
    missing.push("conversion_action");
  }
  if ((context?.target_audience?.length ?? 0) === 0) {
    missing.push("target_audience");
  }
  if ((context?.purchase_triggers?.length ?? 0) === 0) {
    missing.push("purchase_triggers");
  }
  if (!nonempty(context?.geography)) missing.push("geography");
  if (context?.competitor_policy === undefined) {
    missing.push("competitor_policy");
  }
  if (context?.competitor_policy_confirmed !== true) {
    missing.push("competitor_policy_confirmed");
  }
  if ((context?.provider_terms?.length ?? 0) === 0) {
    missing.push("provider_terms");
  }
  if (
    context?.competitor_policy !== undefined &&
    context.competitor_policy !== "exclude" &&
    (context.competitor_terms?.length ?? 0) === 0
  ) {
    missing.push("competitor_terms");
  }
  if (missing.length > 0) {
    return clarificationPreflight(context, [...new Set(missing)]);
  }

  const buyerTerms = unique([
    ...(context?.target_audience ?? []),
    ...(context?.buyer_roles ?? []),
    ...(context?.purchase_triggers ?? []),
    ...(context?.audience_terms ?? []),
    ...(context?.adjacent_audience_terms ?? []),
    ...(context?.partner_terms ?? []),
  ]);
  const sellerTerms = unique([
    context?.offer ?? "",
    ...(context?.provider_terms ?? []),
    ...(context?.competitor_terms ?? []),
  ]);
  const buyerQueries = keywords.filter((query) =>
    matches(query, buyerTerms).length > 0,
  );
  const sellerOnlyQueries = keywords.filter(
    (query) =>
      matches(query, sellerTerms).length > 0 &&
      matches(query, buyerTerms).length === 0,
  );
  const clusterTerms = clusters.flatMap((cluster) => [
    ...strings(cluster.include_terms),
    ...strings(cluster.exclude_terms),
  ]);
  const clusterBuyerMatches = matches(clusterTerms.join(" "), buyerTerms);
  const strategyErrors: string[] = [];
  if (
    buyerQueries.length === 0 ||
    sellerOnlyQueries.length === keywords.length
  ) {
    strategyErrors.push(PROVIDER_STRATEGY_ERROR);
  }
  if (clusters.length > 0 && clusterBuyerMatches.length === 0) {
    strategyErrors.push(
      "Кластеры поиска не согласованы с описанием целевой аудитории.",
    );
  }
  if (strategyErrors.length > 0) {
    return {
      ...readyPreflight(context!),
      status: "invalid_strategy",
      ready: false,
      strategy_errors: strategyErrors,
      questions: [
        "Какие сообщества описывают покупателей, их потребности или события перед покупкой?",
      ],
    };
  }
  return readyPreflight(context!);
}

export function classifyAudience(
  candidate: Candidate,
  context: ResearchContext,
): AudienceClassification {
  const metadataText = [
    candidate.name,
    candidate.description,
  ].join("\n");
  const activityText = [
    ...(candidate.activity?.term_matches ?? []),
    ...(candidate.activity?.intent_term_matches ?? []),
  ].join("\n");
  const text = `${metadataText}\n${activityText}`;
  const buyerSignals = unique([
    ...matches(text, [
      ...(context.target_audience ?? []),
      ...(context.buyer_roles ?? []),
      ...(context.purchase_triggers ?? []),
      ...(context.audience_terms ?? []),
    ]),
  ]);
  const adjacentSignals = matches(text, context.adjacent_audience_terms ?? []);
  const partnerSignals = matches(text, context.partner_terms ?? []);
  const competitorSignals = matches(text, context.competitor_terms ?? []);
  const providerSignals = matches(text, context.provider_terms ?? []);
  const irrelevantSignals = matchExcludedTerms(
    text,
    context.irrelevant_terms ?? [],
  );
  const nameRelation = classifyRelationshipText(candidate.name, context);
  const descriptionRelation = classifyRelationshipText(
    candidate.description,
    context,
  );
  const activityRelation = classifyRelationshipText(activityText, context);
  const selectedRelation = [
    nameRelation,
    descriptionRelation,
    activityRelation,
  ].find((item) => item.relationship !== "unknown") ?? nameRelation;
  const relationship = selectedRelation.relationship;
  const relationshipSignals = selectedRelation.signals;

  return {
    audience_relationship: relationship,
    relationship_reasons:
      relationshipSignals.length > 0
        ? [
            `${relationship}: ${relationshipSignals.join(", ")}`,
          ]
        : ["Связь с покупателями, партнёрами или поставщиками не подтверждена."],
    buyer_signals: unique([
      ...buyerSignals,
      ...adjacentSignals,
    ]),
    provider_signals: providerSignals,
    competitor_signals: competitorSignals,
    applied_competitor_policy: context.competitor_policy ?? null,
  };
}

function classifyRelationshipText(
  text: string,
  context: ResearchContext,
): { relationship: AudienceRelationship; signals: string[] } {
  const irrelevant = matchExcludedTerms(
    text,
    context.irrelevant_terms ?? [],
  );
  if (irrelevant.length > 0) {
    return { relationship: "irrelevant", signals: irrelevant };
  }
  const competitors = matches(text, context.competitor_terms ?? []);
  if (competitors.length > 0) {
    return { relationship: "competitor", signals: competitors };
  }
  const providers = matches(text, context.provider_terms ?? []);
  if (providers.length > 0) {
    return { relationship: "provider", signals: providers };
  }
  const partners = matches(text, context.partner_terms ?? []);
  if (partners.length > 0) {
    return { relationship: "partner", signals: partners };
  }
  const adjacent = matches(text, context.adjacent_audience_terms ?? []);
  if (adjacent.length > 0) {
    return { relationship: "adjacent_audience", signals: adjacent };
  }
  const buyers = matches(text, [
    ...(context.target_audience ?? []),
    ...(context.buyer_roles ?? []),
    ...(context.audience_terms ?? []),
  ]);
  if (buyers.length > 0) {
    return { relationship: "target_audience", signals: buyers };
  }
  return { relationship: "unknown", signals: [] };
}

export function applyAudienceAdmission(
  score: Score,
  classification: AudienceClassification,
  context: ResearchContext,
): Score & AudienceClassification {
  let recommendation = score.recommendation;
  let statusReason = score.status_reason;
  const risks = [...score.risk_flags];
  const clusters = [...score.clusters];
  const relationship = classification.audience_relationship;

  if (context.purpose === "advertising_audience") {
    if (relationship === "provider" || relationship === "irrelevant") {
      recommendation = "rejected";
      statusReason = `audience_relationship_${relationship}`;
      risks.push(`audience_relationship_${relationship}`);
    } else if (relationship === "partner" || relationship === "unknown") {
      if (recommendation === "recommended") recommendation = "review";
      statusReason = `audience_relationship_${relationship}`;
      risks.push(`audience_relationship_${relationship}`);
    } else if (relationship === "competitor") {
      clusters.push("Аудитория конкурентов");
      if (
        context.competitor_policy === "exclude" ||
        context.competitor_policy_confirmed !== true
      ) {
        recommendation = "rejected";
      } else if (
        context.competitor_policy === "review" ||
        context.personal_choice_level === "high"
      ) {
        if (recommendation === "recommended") recommendation = "review";
      }
      statusReason = `competitor_policy_${context.competitor_policy ?? "undefined"}`;
      risks.push(statusReason);
    }
    if (
      recommendation === "recommended" &&
      classification.buyer_signals.length === 0 &&
      relationship !== "competitor"
    ) {
      recommendation = "review";
      statusReason = "buyer_signal_required";
      risks.push("buyer_signal_required");
    }
  }

  return {
    ...score,
    recommendation,
    status_reason: statusReason,
    clusters: unique(clusters),
    risk_flags: unique(risks),
    ...classification,
  };
}

export function clarificationResult(
  preflight: ResearchPreflight,
): Record<string, unknown> {
  return {
    status: preflight.status,
    needs_clarification: true,
    preflight,
    missing_questions: preflight.questions,
    items: [],
  };
}

function readyPreflight(context: ResearchContext): ResearchPreflight {
  return {
    status: "ready",
    ready: true,
    purpose: context.purpose ?? null,
    missing_fields: [],
    questions: [],
    strategy_errors: [],
    summary: {
      offer: context.offer ?? null,
      conversion_action: context.conversion_action ?? null,
      target_audience: context.target_audience ?? [],
      purchase_triggers: context.purchase_triggers ?? [],
      geography: context.geography ?? null,
      competitor_policy: context.competitor_policy ?? null,
      personal_choice_level: context.personal_choice_level ?? null,
    },
  };
}

function clarificationPreflight(
  context: ResearchContext | undefined,
  missing: string[],
): ResearchPreflight {
  const questions = [
    "Кому рекламируем этот продукт или услугу и можно ли использовать подписчиков конкурентов?",
  ];
  if (missing.includes("conversion_action")) {
    questions.push("Какое целевое действие должен совершить покупатель?");
  }
  if (missing.includes("purchase_triggers")) {
    questions.push(
      "Какие потребности или события обычно возникают перед покупкой?",
    );
  }
  if (missing.includes("geography")) {
    questions.push("Какая география нужна для рекламы?");
  }
  if (missing.includes("provider_terms")) {
    questions.push(
      "Каких поставщиков и специалистов нельзя принимать за покупателей?",
    );
  }
  return {
    status: "needs_clarification",
    ready: false,
    purpose: context?.purpose ?? null,
    missing_fields: missing,
    questions: unique(questions),
    strategy_errors: [],
    summary: {
      offer: context?.offer ?? null,
      conversion_action: context?.conversion_action ?? null,
      target_audience: context?.target_audience ?? [],
      purchase_triggers: context?.purchase_triggers ?? [],
      geography: context?.geography ?? null,
      competitor_policy: context?.competitor_policy ?? null,
      personal_choice_level: context?.personal_choice_level ?? null,
    },
  };
}

function nonempty(value: string | undefined): boolean {
  return value?.trim().length !== 0 && value !== undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
