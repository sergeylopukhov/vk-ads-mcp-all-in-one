import { z } from "zod";

import type {
  VkAdsCurrentUser,
  VkAdsRemarketingCounter,
  VkAdsRemarketingCounterGoal,
} from "../vk-ads/client.js";
import type {
  ActionContract,
  ActionReadiness,
  RequirementIssue,
} from "./types.js";

const idSchema = z.number().int().positive();
const counterConditionSchema = z.enum([
  "uss",
  "rss",
  "jse",
  "hd",
  "ts",
]);
const counterGoalTypeSchema = z.enum([
  "content",
  "search",
  "basket",
  "wishlist",
  "checkout",
  "payment_info",
  "purchase",
  "lead",
  "registration",
  "custom",
]);
const counterCreateSchema = z.object({
  mode: z.enum(["new", "existing"]),
  name: z.string().min(1),
  url: z.url().optional(),
  email: z.email().optional(),
  password: z.string().min(1).optional(),
  counterId: idSchema.optional(),
  flags: z.array(z.string().min(1)).optional(),
});
const counterUpdateSchema = z.object({
  counterId: idSchema,
  changes: z
    .object({
      name: z.string().min(1).optional(),
      flags: z.array(z.string().min(1)).optional(),
    })
    .refine(
      ({ name, flags }) =>
        name !== undefined || flags !== undefined,
    ),
});
const counterDeleteSchema = z.object({
  counterId: idSchema,
  version: z.enum(["v1", "v2"]).default("v2"),
});
const counterGoalCreateSchema = z.object({
  counterId: idSchema,
  goal: z.object({
    substr: z.string().min(1),
    value: z
      .number()
      .int()
      .min(-2_147_483_647)
      .max(2_147_483_647)
      .optional(),
    name: z.string().min(1),
    condition: counterConditionSchema,
    goalType: counterGoalTypeSchema.optional(),
  }),
});
const counterGoalUpdateSchema = z.object({
  counterId: idSchema,
  goalId: z.union([idSchema, z.string().min(1)]),
  changes: z
    .object({
      value: z
        .number()
        .int()
        .min(-2_147_483_647)
        .max(2_147_483_647)
        .optional(),
      name: z.string().min(1).optional(),
      goalType: counterGoalTypeSchema.optional(),
    })
    .refine(
      ({ value, name, goalType }) =>
        value !== undefined ||
        name !== undefined ||
        goalType !== undefined,
    ),
});
const inAppUpdateSchema = z.object({
  appId: idSchema,
  trackerId: idSchema,
  eventId: idSchema,
  categoryId: idSchema,
});

type CounterCreateInput = z.infer<typeof counterCreateSchema>;
type CounterUpdateInput = z.infer<typeof counterUpdateSchema>;
type CounterDeleteInput = z.infer<typeof counterDeleteSchema>;
type CounterGoalCreateInput = z.infer<
  typeof counterGoalCreateSchema
>;
type CounterGoalUpdateInput = z.infer<
  typeof counterGoalUpdateSchema
>;
type InAppUpdateInput = z.infer<typeof inAppUpdateSchema>;

export interface RemarketingPreflightClient {
  getCurrentUser(): Promise<VkAdsCurrentUser>;
  getCounter(id: number): Promise<VkAdsRemarketingCounter>;
  listCounters(id: number): Promise<VkAdsRemarketingCounter[]>;
  listCounterGoals(
    id: number,
  ): Promise<VkAdsRemarketingCounterGoal[]>;
  inAppEventExists(
    appId: number,
    trackerId: number,
    eventId: number,
  ): Promise<boolean>;
  inAppCategoryExists(id: number): Promise<boolean>;
}

interface RemarketingContext {
  user: VkAdsCurrentUser;
  counter?: VkAdsRemarketingCounter;
  duplicateCounters?: VkAdsRemarketingCounter[];
  goals?: VkAdsRemarketingCounterGoal[];
  eventExists?: boolean;
  categoryExists?: boolean;
}

function issue(
  code: string,
  path: string,
  message: string,
  source: RequirementIssue["source"] = "provider_state",
): RequirementIssue {
  return { code, path, message, source };
}

function result(
  action: string,
  resource: string,
  id: number | undefined,
  incompatibleFields: RequirementIssue[],
  warnings: RequirementIssue[] = [],
  allowedValues?: ActionReadiness["allowedValues"],
): ActionReadiness {
  return {
    ready: incompatibleFields.length === 0,
    action,
    stage: "compatibility",
    target: {
      resource,
      ...(id === undefined ? {} : { id }),
    },
    missingFields: [],
    incompatibleFields,
    warnings,
    allowedValues,
    nextAction:
      incompatibleFields.length === 0
        ? "Выполните соответствующий write-инструмент."
        : "Исправьте условия и повторите подготовку.",
    requiresConfirmation: false,
  };
}

function counterStateIssues(
  counter: VkAdsRemarketingCounter | undefined,
): RequirementIssue[] {
  if (counter === undefined) {
    return [
      issue(
        "remarketing_counter_not_found",
        "counterId",
        "Счётчик не найден или недоступен текущему аккаунту.",
      ),
    ];
  }

  return counter.status === "deleted" ||
    counter.systemStatus === "deleted"
    ? [
        issue(
          "remarketing_counter_deleted",
          "counterId",
          "Удалённый счётчик нельзя изменить.",
        ),
      ]
    : [];
}

async function loadCounterContext(
  client: RemarketingPreflightClient,
  id: number,
  reads: {
    loadOnce<T>(
      key: string,
      loader: () => Promise<T>,
    ): Promise<T>;
  },
  withGoals = false,
): Promise<RemarketingContext> {
  const [user, counter, goals] = await Promise.all([
    reads.loadOnce("current-user", () =>
      client.getCurrentUser(),
    ),
    reads.loadOnce(`counter:${id}`, () =>
      client.getCounter(id),
    ),
    withGoals
      ? reads.loadOnce(`counter-goals:${id}`, () =>
          client.listCounterGoals(id),
        )
      : Promise.resolve(undefined),
  ]);
  return {
    user,
    counter,
    ...(goals === undefined ? {} : { goals }),
  };
}

export function createRemarketingActionContracts(
  client: RemarketingPreflightClient,
): Array<ActionContract<unknown, RemarketingContext>> {
  const counterCreate: ActionContract<
    CounterCreateInput,
    RemarketingContext
  > = {
    action: "remarketing_counter.create",
    staticSchema: counterCreateSchema,
    target: () => ({ resource: "remarketing_counter" }),
    async loadContext(input, reads) {
      const [user, duplicateCounters] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        input.counterId === undefined
          ? Promise.resolve([])
          : reads.loadOnce(
              `counter-list:${input.counterId}`,
              () => client.listCounters(input.counterId!),
            ),
      ]);
      return { user, duplicateCounters };
    },
    async validate(input, context) {
      const incompatible: RequirementIssue[] = [];
      const newModeValid =
        input.mode === "new" &&
        input.url !== undefined &&
        input.email !== undefined &&
        input.password !== undefined &&
        input.counterId === undefined &&
        input.flags === undefined;
      const existingModeValid =
        input.mode === "existing" &&
        input.counterId !== undefined &&
        input.url === undefined &&
        input.email === undefined &&
        input.password === undefined;

      if (!newModeValid && !existingModeValid) {
        incompatible.push(
          issue(
            "remarketing_counter_mode_mismatch",
            "mode",
            "Поля не соответствуют выбранному режиму счётчика.",
            "provider_contract",
          ),
        );
      }

      if (
        input.mode === "existing" &&
        (context.duplicateCounters?.length ?? 0) > 0
      ) {
        incompatible.push(
          issue(
            "remarketing_counter_duplicate",
            "counterId",
            "Счётчик уже подключён к аккаунту.",
          ),
        );
      }

      return result(
        "remarketing_counter.create",
        "remarketing_counter",
        input.counterId,
        incompatible,
        input.mode === "new"
          ? [
              issue(
                "topmail_external_dependency",
                "mode",
                "Создание зависит от доступности внешнего Top.Mail.Ru.",
                "provider_contract",
              ),
            ]
          : [
              issue(
                "counter_owner_confirmation_possible",
                "counterId",
                "Если нет доступа владельца, VK подключит счётчик заблокированным до подтверждения.",
                "provider_contract",
              ),
            ],
      );
    },
    buildRequest: (input) =>
      input.mode === "new"
        ? { mode: "new", name: input.name }
        : {
            mode: "existing",
            name: input.name,
            counter_id: input.counterId,
            ...(input.flags === undefined
              ? {}
              : { flags: input.flags }),
          },
  };

  const counterUpdate: ActionContract<
    CounterUpdateInput,
    RemarketingContext
  > = {
    action: "remarketing_counter.update",
    staticSchema: counterUpdateSchema,
    target: ({ counterId }) => ({
      resource: "remarketing_counter",
      id: counterId,
    }),
    loadContext: (input, reads) =>
      loadCounterContext(client, input.counterId, reads),
    async validate(_input, context) {
      return result(
        "remarketing_counter.update",
        "remarketing_counter",
        context.counter?.counterId,
        counterStateIssues(context.counter),
      );
    },
    buildRequest: ({ changes }) => changes,
  };

  const counterDelete: ActionContract<
    CounterDeleteInput,
    RemarketingContext
  > = {
    action: "remarketing_counter.delete",
    staticSchema: counterDeleteSchema,
    target: ({ counterId }) => ({
      resource: "remarketing_counter",
      id: counterId,
    }),
    loadContext: (input, reads) =>
      loadCounterContext(client, input.counterId, reads),
    async validate(input, context) {
      return result(
        "remarketing_counter.delete",
        "remarketing_counter",
        input.counterId,
        counterStateIssues(context.counter),
        [
          issue(
            "counter_usage_provider_guard",
            "counterId",
            "VK окончательно проверит отсутствие аудиторий и lookalike, использующих счётчик.",
            "provider_contract",
          ),
          ...(input.version === "v1"
            ? [
                issue(
                  "legacy_api_version",
                  "version",
                  "Выбрана устаревшая ветка API v1.",
                  "provider_contract",
                ),
              ]
            : []),
        ],
        [{ path: "version", values: ["v1", "v2"] }],
      );
    },
    buildRequest: ({ version }) => ({ version }),
  };

  const goalCreate: ActionContract<
    CounterGoalCreateInput,
    RemarketingContext
  > = {
    action: "remarketing_counter_goal.create",
    staticSchema: counterGoalCreateSchema,
    target: ({ counterId }) => ({
      resource: "remarketing_counter_goal",
      id: counterId,
    }),
    loadContext: (input, reads) =>
      loadCounterContext(client, input.counterId, reads, true),
    async validate(input, context) {
      const incompatible = counterStateIssues(context.counter);
      const duplicate = context.goals?.some(
        (goal) =>
          goal.name === input.goal.name &&
          goal.substr === input.goal.substr &&
          goal.condition === input.goal.condition,
      );

      if (duplicate) {
        incompatible.push(
          issue(
            "remarketing_counter_goal_duplicate",
            "goal",
            "Такая цель уже есть у счётчика.",
          ),
        );
      }
      if (
        context.counter?.systemStatus !== "active" ||
        context.counter?.status !== "active"
      ) {
        incompatible.push(
          issue(
            "remarketing_counter_not_confirmed",
            "counterId",
            "Цели можно менять только у активного подтверждённого счётчика.",
          ),
        );
      }

      return result(
        "remarketing_counter_goal.create",
        "remarketing_counter_goal",
        input.counterId,
        incompatible,
        input.goal.goalType === undefined
          ? [
              issue(
                "remarketing_goal_type_may_be_required",
                "goal.goalType",
                "goalType обязателен для целей, не являющихся пикселями.",
                "provider_contract",
              ),
            ]
          : [],
        [
          {
            path: "goal.condition",
            values: counterConditionSchema.options,
          },
          {
            path: "goal.goalType",
            values: counterGoalTypeSchema.options,
          },
        ],
      );
    },
    buildRequest: ({ goal }) => ({
      substr: goal.substr,
      ...(goal.value === undefined ? {} : { value: goal.value }),
      name: goal.name,
      condition: goal.condition,
      ...(goal.goalType === undefined
        ? {}
        : { goal_type: goal.goalType }),
    }),
  };

  const goalUpdate: ActionContract<
    CounterGoalUpdateInput,
    RemarketingContext
  > = {
    action: "remarketing_counter_goal.update",
    staticSchema: counterGoalUpdateSchema,
    target: ({ goalId }) => ({
      resource: "remarketing_counter_goal",
      ...(typeof goalId === "number" ? { id: goalId } : {}),
    }),
    loadContext: (input, reads) =>
      loadCounterContext(client, input.counterId, reads, true),
    async validate(input, context) {
      const incompatible = counterStateIssues(context.counter);

      if (
        !context.goals?.some(
          (goal) => String(goal.id) === String(input.goalId),
        )
      ) {
        incompatible.push(
          issue(
            "remarketing_counter_goal_not_found",
            "goalId",
            "Цель не найдена у выбранного счётчика.",
          ),
        );
      }
      if (
        context.counter?.systemStatus !== "active" ||
        context.counter?.status !== "active"
      ) {
        incompatible.push(
          issue(
            "remarketing_counter_not_confirmed",
            "counterId",
            "Цели можно менять только у активного подтверждённого счётчика.",
          ),
        );
      }

      return result(
        "remarketing_counter_goal.update",
        "remarketing_counter_goal",
        typeof input.goalId === "number"
          ? input.goalId
          : undefined,
        incompatible,
        [],
        [
          {
            path: "changes.goalType",
            values: counterGoalTypeSchema.options,
          },
        ],
      );
    },
    buildRequest: ({ changes }) => ({
      ...(changes.value === undefined
        ? {}
        : { value: changes.value }),
      ...(changes.name === undefined
        ? {}
        : { name: changes.name }),
      ...(changes.goalType === undefined
        ? {}
        : { goal_type: changes.goalType }),
    }),
  };

  const inAppUpdate: ActionContract<
    InAppUpdateInput,
    RemarketingContext
  > = {
    action: "remarketing_in_app_event.update",
    staticSchema: inAppUpdateSchema,
    target: ({ eventId }) => ({
      resource: "remarketing_in_app_event",
      id: eventId,
    }),
    async loadContext(input, reads) {
      const [user, eventExists, categoryExists] =
        await Promise.all([
          reads.loadOnce("current-user", () =>
            client.getCurrentUser(),
          ),
          reads.loadOnce(
            `inapp-event:${input.appId}:${input.trackerId}:${input.eventId}`,
            () =>
              client.inAppEventExists(
                input.appId,
                input.trackerId,
                input.eventId,
              ),
          ),
          reads.loadOnce(
            `inapp-category:${input.categoryId}`,
            () =>
              client.inAppCategoryExists(input.categoryId),
          ),
        ]);
      return { user, eventExists, categoryExists };
    },
    async validate(input, context) {
      const incompatible: RequirementIssue[] = [];

      if (!context.eventExists) {
        incompatible.push(
          issue(
            "remarketing_in_app_event_not_found",
            "eventId",
            "Приложение, трекер или событие не найдены.",
          ),
        );
      }
      if (!context.categoryExists) {
        incompatible.push(
          issue(
            "remarketing_in_app_category_not_found",
            "categoryId",
            "Категория события отсутствует в справочнике VK.",
          ),
        );
      }

      return result(
        "remarketing_in_app_event.update",
        "remarketing_in_app_event",
        input.eventId,
        incompatible,
      );
    },
    buildRequest: ({ categoryId }) => ({
      inapp_event_category_id: categoryId,
    }),
  };

  return [
    counterCreate,
    counterUpdate,
    counterDelete,
    goalCreate,
    goalUpdate,
    inAppUpdate,
  ];
}
