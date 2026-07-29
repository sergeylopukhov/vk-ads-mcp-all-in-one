import { z } from "zod";

export const requirementIssueSourceSchema = z.enum([
  "schema",
  "provider_reference",
  "provider_state",
  "provider_contract",
]);

export const requirementIssueSchema = z.object({
  code: z.string().min(1),
  path: z.string(),
  message: z.string().min(1),
  source: requirementIssueSourceSchema,
});

export const allowedValueSchema = z.object({
  path: z.string(),
  values: z.array(
    z.union([z.string(), z.number(), z.boolean()]),
  ),
});

export const actionReadinessSchema = z.object({
  ready: z.boolean(),
  action: z.string().min(1),
  stage: z.enum([
    "input",
    "context",
    "compatibility",
    "permission",
  ]),
  target: z.object({
    resource: z.string().min(1),
    id: z.number().int().positive().optional(),
  }),
  missingFields: z.array(requirementIssueSchema),
  incompatibleFields: z.array(requirementIssueSchema),
  warnings: z.array(requirementIssueSchema),
  allowedValues: z.array(allowedValueSchema).optional(),
  suggestedPatch: z.record(z.string(), z.unknown()).optional(),
  requestDraft: z.record(z.string(), z.unknown()).optional(),
  nextAction: z.string().optional(),
  requiresConfirmation: z.boolean(),
});

export type RequirementIssue = z.infer<
  typeof requirementIssueSchema
>;
export type ActionReadiness = z.infer<
  typeof actionReadinessSchema
>;
export type ProviderRequestDraft = Record<string, unknown>;

export interface ActionContract<TInput, TContext> {
  action: string;
  staticSchema: z.ZodType<TInput>;
  target(input: TInput): ActionReadiness["target"];
  loadContext(
    input: TInput,
    reads: PreflightReadScope,
  ): Promise<TContext>;
  validate(
    input: TInput,
    context: TContext,
  ): Promise<ActionReadiness>;
  buildRequest(
    input: TInput,
    context: TContext,
  ): ProviderRequestDraft;
}

export interface PreflightReadScope {
  loadOnce<T>(
    key: string,
    loader: () => Promise<T>,
  ): Promise<T>;
}
