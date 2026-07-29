import { z } from "zod";

import type {
  VkAdsAdGroup,
  VkAdsAdPlan,
  VkAdsCurrentUser,
  VkAdsReferenceCollectionResult,
} from "../vk-ads/client.js";
import type {
  ActionContract,
  ActionReadiness,
  RequirementIssue,
} from "./types.js";

const statusSchema = z.enum(["active", "blocked", "deleted"]);
const dynamicObjectSchema = z.record(z.string(), z.unknown());
const decimalSchema = z.union([
  z.number().finite(),
  z.string().regex(/^-?(?:\d+|\d+\.\d+|\.\d+)$/u),
]);
const optionalPlanFields = {
  autobidding_mode: z.literal("max_goals").optional(),
  budget_limit: decimalSchema.optional(),
  budget_limit_day: decimalSchema.optional(),
  date_start: z.string().min(1).optional(),
  date_end: z.string().min(1).optional(),
  max_price: decimalSchema.optional(),
  priced_goal: dynamicObjectSchema.optional(),
  pricelist_id: z.number().int().optional(),
  enable_offline_goals: z.boolean().optional(),
  enable_utm: z.boolean().optional(),
} as const;

export const adPlanCreateActionInputSchema = z
  .object({
    name: z.string().min(1),
    campaigns: z.array(dynamicObjectSchema).min(1),
    status: statusSchema.optional(),
    objective: z.string().min(1).optional(),
    ...optionalPlanFields,
  })
  .catchall(z.unknown());

export const adPlanUpdateActionInputSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1).optional(),
    campaigns: z.array(dynamicObjectSchema).min(1).optional(),
    status: statusSchema.optional(),
    objective: z.string().min(1).optional(),
    ...optionalPlanFields,
  })
  .catchall(z.unknown())
  .refine(
    ({ id: _id, ...changes }) =>
      Object.values(changes).some(
        (value) => value !== undefined,
      ),
    "Укажите хотя бы одно изменяемое поле кампании.",
  );

export const adGroupCreateActionInputSchema = z
  .object({
    name: z.string().min(1),
    packageId: z.number().int(),
    adPlanId: z.number().int().positive().optional(),
    status: statusSchema.optional(),
    objective: z.string().min(1).optional(),
    targetings: dynamicObjectSchema.optional(),
    budgetLimit: decimalSchema.optional(),
    budgetLimitDay: decimalSchema.optional(),
    dateStart: z.string().min(1).optional(),
    dateEnd: z.string().min(1).optional(),
    maxPrice: decimalSchema.optional(),
    price: decimalSchema.optional(),
    uniqShowsLimit: z.number().int().nonnegative().optional(),
    uniqShowsPeriod: z
      .enum(["day", "week", "month", "eternity"])
      .optional(),
    packageFields: dynamicObjectSchema.optional(),
  })
  .catchall(z.unknown());

export const adGroupUpdateActionInputSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1).optional(),
    packageId: z.number().int().optional(),
    adPlanId: z.number().int().positive().optional(),
    status: statusSchema.optional(),
    objective: z.string().min(1).optional(),
    targetings: dynamicObjectSchema.optional(),
    budgetLimit: decimalSchema.optional(),
    budgetLimitDay: decimalSchema.optional(),
    dateStart: z.string().min(1).optional(),
    dateEnd: z.string().min(1).optional(),
    maxPrice: decimalSchema.optional(),
    price: decimalSchema.optional(),
    uniqShowsLimit: z.number().int().nonnegative().optional(),
    uniqShowsPeriod: z
      .enum(["day", "week", "month", "eternity"])
      .optional(),
    packageFields: dynamicObjectSchema.optional(),
  })
  .catchall(z.unknown())
  .refine(
    ({ id: _id, ...changes }) =>
      Object.values(changes).some(
        (value) => value !== undefined,
      ),
    "Укажите хотя бы одно изменяемое поле группы.",
  );

type AdPlanCreateInput = z.infer<
  typeof adPlanCreateActionInputSchema
>;
type AdPlanUpdateInput = z.infer<
  typeof adPlanUpdateActionInputSchema
>;
type AdGroupCreateInput = z.infer<
  typeof adGroupCreateActionInputSchema
>;
type AdGroupUpdateInput = z.infer<
  typeof adGroupUpdateActionInputSchema
>;

export interface CampaignPreflightClient {
  getCurrentUser(): Promise<VkAdsCurrentUser>;
  getAdPlan(id: number): Promise<VkAdsAdPlan>;
  getAdGroup(id: number): Promise<VkAdsAdGroup>;
  listReferenceData(
    resource: "packages",
    input: {
      ids?: number[];
      limit: number;
      offset: number;
    },
  ): Promise<VkAdsReferenceCollectionResult>;
}

interface CampaignContext {
  user: VkAdsCurrentUser;
  parent?: VkAdsAdPlan;
  group?: VkAdsAdGroup;
  packages: Array<Record<string, unknown>>;
}

function issue(
  code: string,
  path: string,
  message: string,
  source: RequirementIssue["source"],
): RequirementIssue {
  return { code, path, message, source };
}

function nullValueIssues(
  value: Record<string, unknown>,
  prefix = "",
): RequirementIssue[] {
  return Object.entries(value)
    .filter(([, field]) => field === null)
    .map(([key]) =>
      issue(
        "null_value_not_writable",
        prefix === "" ? key : `${prefix}.${key}`,
        "Необязательное поле со значением null нужно исключить из запроса.",
        "provider_contract",
      ),
    );
}

function dateOrderIssues(
  start: unknown,
  end: unknown,
  startPath: string,
  endPath: string,
): RequirementIssue[] {
  if (
    typeof start !== "string" ||
    typeof end !== "string" ||
    !/^\d{4}-\d{2}-\d{2}(?:[T ][^\s]+)?$/u.test(start) ||
    !/^\d{4}-\d{2}-\d{2}(?:[T ][^\s]+)?$/u.test(end)
  ) {
    return [];
  }

  const startTime = Date.parse(start);
  const endTime = Date.parse(end);

  return Number.isFinite(startTime) &&
    Number.isFinite(endTime) &&
    startTime > endTime
    ? [
        issue(
          "date_range_invalid",
          endPath,
          `Дата ${endPath} не может быть раньше ${startPath}.`,
          "provider_contract",
        ),
      ]
    : [];
}

function packageTargetingIssues(
  targetings: unknown,
  packageItem: Record<string, unknown> | undefined,
): {
  incompatible: RequirementIssue[];
  allowedNames: string[];
} {
  if (
    targetings === undefined ||
    targetings === null ||
    typeof targetings !== "object" ||
    Array.isArray(targetings)
  ) {
    return { incompatible: [], allowedNames: [] };
  }

  const options = packageItem?.options;
  const optionRecord =
    options !== null &&
    typeof options === "object" &&
    !Array.isArray(options)
      ? (options as Record<string, unknown>)
      : undefined;
  const rawDefinitions = optionRecord?.targetings;
  const definitions =
    Array.isArray(rawDefinitions)
      ? rawDefinitions.filter(
          (item): item is Record<string, unknown> =>
            item !== null &&
            typeof item === "object" &&
            !Array.isArray(item),
        )
      : [];
  const allowedNames = definitions
    .map((item) => item.name)
    .filter(
      (name): name is string =>
        typeof name === "string" && name.length > 0,
    )
    .sort();

  if (allowedNames.length === 0) {
    return { incompatible: [], allowedNames };
  }

  const incompatible = Object.keys(targetings)
    .filter((name) => !allowedNames.includes(name))
    .map((name) =>
      issue(
        "targeting_not_available_for_package",
        `targetings.${name}`,
        "Таргетинг отсутствует в актуальном контракте выбранного пакета.",
        "provider_reference",
      ),
    );
  const padsDefinition = definitions.find(
    (item) => item.name === "pads",
  );
  const pads = (targetings as Record<string, unknown>).pads;
  const allowedPads = Array.isArray(padsDefinition?.values)
    ? padsDefinition.values
    : [];

  if (Array.isArray(pads) && allowedPads.length > 0) {
    pads.forEach((pad, index) => {
      if (!allowedPads.includes(pad)) {
        incompatible.push(
          issue(
            "placement_not_available_for_package",
            `targetings.pads.${index}`,
            "Площадка отсутствует в актуальном контракте выбранного пакета.",
            "provider_reference",
          ),
        );
      }
    });
  }

  return { incompatible, allowedNames };
}

function groupCompatibilityIssues(
  input: AdGroupCreateInput | AdGroupUpdateInput,
  packageItem: Record<string, unknown> | undefined,
): {
  incompatible: RequirementIssue[];
  allowedTargetings: string[];
} {
  const packageTargetings = input.packageFields?.targetings;
  const targetings =
    input.targetings ??
    (packageTargetings !== null &&
    typeof packageTargetings === "object" &&
    !Array.isArray(packageTargetings)
      ? packageTargetings
      : undefined);
  const targetingCheck = packageTargetingIssues(
    targetings,
    packageItem,
  );
  const packageStart = input.packageFields?.date_start;
  const packageEnd = input.packageFields?.date_end;
  const dateIssues = dateOrderIssues(
    input.dateStart ?? packageStart,
    input.dateEnd ?? packageEnd,
    "dateStart",
    "dateEnd",
  );
  const incompatible = [
    ...targetingCheck.incompatible,
    ...dateIssues,
  ];
  const period =
    input.uniqShowsPeriod ??
    input.packageFields?.uniq_shows_period;
  const limit =
    input.uniqShowsLimit ??
    input.packageFields?.uniq_shows_limit;

  if (
    (period === undefined) !==
    (limit === undefined)
  ) {
    incompatible.push(
      issue(
        "frequency_limit_pair_required",
        period === undefined
          ? "uniqShowsPeriod"
          : "uniqShowsLimit",
        "Лимит частоты и период нужно передавать вместе.",
        "provider_contract",
      ),
    );
  }

  return {
    incompatible,
    allowedTargetings: targetingCheck.allowedNames,
  };
}

function campaignRequirements(
  input: AdPlanCreateInput | AdPlanUpdateInput,
  packages: Array<Record<string, unknown>>,
): {
  missing: RequirementIssue[];
  incompatible: RequirementIssue[];
  allowedPackageIds: number[];
} {
  const missing: RequirementIssue[] = [];
  const incompatible: RequirementIssue[] = [];
  const campaigns = input.campaigns ?? [];
  const packageIds = new Set(
    packages
      .map((item) => item.id)
      .filter(
        (id): id is number =>
          typeof id === "number" && Number.isInteger(id),
      ),
  );

  campaigns.forEach((campaign, index) => {
    const path = `campaigns.${index}`;

    if (
      typeof campaign.name !== "string" ||
      campaign.name.trim() === ""
    ) {
      missing.push(
        issue(
          "campaign_name_required",
          `${path}.name`,
          "Для вложенной группы требуется имя.",
          "provider_contract",
        ),
      );
    }

    if (
      typeof campaign.package_id !== "number" ||
      !Number.isInteger(campaign.package_id)
    ) {
      missing.push(
        issue(
          "campaign_package_required",
          `${path}.package_id`,
          "Для вложенной группы требуется package_id.",
          "provider_contract",
        ),
      );
    } else if (!packageIds.has(campaign.package_id)) {
      incompatible.push(
        issue(
          "campaign_package_unavailable",
          `${path}.package_id`,
          "Пакет отсутствует в актуальном справочнике кабинета.",
          "provider_reference",
        ),
      );
    }

    if (
      typeof campaign.objective !== "string" ||
      campaign.objective.trim() === ""
    ) {
      missing.push(
        issue(
          "campaign_objective_required",
          `${path}.objective`,
          "VK требует objective для каждой вложенной группы.",
          "provider_contract",
        ),
      );
    }

    if (
      input.objective !== undefined &&
      campaign.objective !== undefined &&
      campaign.objective !== input.objective
    ) {
      incompatible.push(
        issue(
          "campaign_objective_mismatch",
          `${path}.objective`,
          "Objective вложенной группы должен совпадать с objective кампании.",
          "provider_contract",
        ),
      );
    }

    incompatible.push(...nullValueIssues(campaign, path));
  });

  incompatible.push(
    ...dateOrderIssues(
      input.date_start,
      input.date_end,
      "date_start",
      "date_end",
    ),
  );

  if (
    campaigns.length > 0 &&
    (input.objective === undefined ||
      input.objective.trim() === "")
  ) {
    missing.push(
      issue(
        "ad_plan_objective_required",
        "objective",
        "При создании вложенных групп требуется objective кампании.",
        "provider_contract",
      ),
    );
  }

  return {
    missing,
    incompatible,
    allowedPackageIds: [...packageIds].sort(
      (left, right) => left - right,
    ),
  };
}

function snakeCaseGroupDraft(
  input: AdGroupCreateInput | AdGroupUpdateInput,
): Record<string, unknown> {
  const draft: Record<string, unknown> = {
    ...(input.packageFields ?? {}),
  };
  const map = {
    name: "name",
    packageId: "package_id",
    adPlanId: "ad_plan_id",
    status: "status",
    objective: "objective",
    targetings: "targetings",
  } as const;

  for (const [source, target] of Object.entries(map)) {
    const value = input[source];

    if (value !== undefined) {
      draft[target] = value;
    }
  }

  return draft;
}

function readiness(
  action: string,
  resource: string,
  id: number | undefined,
  missingFields: RequirementIssue[],
  incompatibleFields: RequirementIssue[],
  allowedPackageIds: number[],
  allowedTargetings: string[] = [],
): ActionReadiness {
  const ready =
    missingFields.length === 0 &&
    incompatibleFields.length === 0;

  return {
    ready,
    action,
    stage: "compatibility",
    target: {
      resource,
      ...(id === undefined ? {} : { id }),
    },
    missingFields,
    incompatibleFields,
    warnings: [],
    allowedValues:
      allowedPackageIds.length === 0 &&
      allowedTargetings.length === 0
        ? undefined
        : [
            ...(allowedPackageIds.length === 0
              ? []
              : [
                  {
                    path: "packageId",
                    values: allowedPackageIds,
                  },
                ]),
            ...(allowedTargetings.length === 0
              ? []
              : [
                  {
                    path: "targetings",
                    values: allowedTargetings,
                  },
                ]),
          ],
    nextAction: ready
      ? "Выполните соответствующий write-инструмент с теми же полями."
      : "Исправьте условия и повторите подготовку.",
    requiresConfirmation: false,
  };
}

async function loadPackages(
  client: CampaignPreflightClient,
  ids: number[],
): Promise<Array<Record<string, unknown>>> {
  if (ids.length === 0) {
    return [];
  }

  return (
    await client.listReferenceData("packages", {
      ids: [...new Set(ids)],
      limit: Math.max(1, ids.length),
      offset: 0,
    })
  ).items;
}

export function createCampaignActionContracts(
  client: CampaignPreflightClient,
): Array<ActionContract<unknown, CampaignContext>> {
  const adPlanCreate: ActionContract<
    AdPlanCreateInput,
    CampaignContext
  > = {
    action: "ad_plan.create",
    staticSchema: adPlanCreateActionInputSchema,
    target: () => ({ resource: "ad_plan" }),
    async loadContext(input, reads) {
      const ids = input.campaigns
        .map((item) => item.package_id)
        .filter(
          (id): id is number =>
            typeof id === "number" && Number.isInteger(id),
        );
      const [user, packages] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(
          `packages:${[...new Set(ids)].sort().join(",")}`,
          () => loadPackages(client, ids),
        ),
      ]);
      return { user, packages };
    },
    async validate(input, context) {
      const checked = campaignRequirements(
        input,
        context.packages,
      );
      return readiness(
        "ad_plan.create",
        "ad_plan",
        undefined,
        checked.missing,
        [
          ...checked.incompatible,
          ...nullValueIssues(input),
        ],
        checked.allowedPackageIds,
      );
    },
    buildRequest: (input) => input,
  };

  const adPlanUpdate: ActionContract<
    AdPlanUpdateInput,
    CampaignContext
  > = {
    action: "ad_plan.update",
    staticSchema: adPlanUpdateActionInputSchema,
    target: ({ id }) => ({ resource: "ad_plan", id }),
    async loadContext(input, reads) {
      const ids = (input.campaigns ?? [])
        .map((item) => item.package_id)
        .filter(
          (id): id is number =>
            typeof id === "number" && Number.isInteger(id),
        );
      const [user, parent, packages] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`ad-plan:${input.id}`, () =>
          client.getAdPlan(input.id),
        ),
        reads.loadOnce(
          `packages:${[...new Set(ids)].sort().join(",")}`,
          () => loadPackages(client, ids),
        ),
      ]);
      return { user, parent, packages };
    },
    async validate(input, context) {
      const checked = campaignRequirements(
        input,
        context.packages,
      );
      const incompatible = [
        ...checked.incompatible,
        ...nullValueIssues(input),
      ];

      if (context.parent?.status === "deleted") {
        incompatible.push(
          issue(
            "ad_plan_deleted",
            "id",
            "Удалённую кампанию нельзя изменять.",
            "provider_state",
          ),
        );
      }

      return readiness(
        "ad_plan.update",
        "ad_plan",
        input.id,
        checked.missing,
        incompatible,
        checked.allowedPackageIds,
      );
    },
    buildRequest: ({ id: _id, ...input }) => input,
  };

  const adGroupCreate: ActionContract<
    AdGroupCreateInput,
    CampaignContext
  > = {
    action: "ad_group.create",
    staticSchema: adGroupCreateActionInputSchema,
    target: ({ adPlanId }) => ({
      resource: "ad_group",
      ...(adPlanId === undefined ? {} : { id: adPlanId }),
    }),
    async loadContext(input, reads) {
      const [user, parent, packages] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        input.adPlanId === undefined
          ? Promise.resolve(undefined)
          : reads.loadOnce(`ad-plan:${input.adPlanId}`, () =>
              client.getAdPlan(input.adPlanId!),
            ),
        reads.loadOnce(`packages:${input.packageId}`, () =>
          loadPackages(client, [input.packageId]),
        ),
      ]);
      return {
        user,
        ...(parent === undefined ? {} : { parent }),
        packages,
      };
    },
    async validate(input, context) {
      const missing: RequirementIssue[] = [];
      const incompatible = [
        ...nullValueIssues(input.packageFields ?? {}, "packageFields"),
      ];
      const packageObjective = input.packageFields?.objective;
      const effectiveObjective =
        input.objective ??
        (typeof packageObjective === "string"
          ? packageObjective
          : undefined);
      const packageIds = context.packages
        .map((item) => item.id)
        .filter((id): id is number => typeof id === "number");
      const compatibility = groupCompatibilityIssues(
        input,
        context.packages[0],
      );
      incompatible.push(...compatibility.incompatible);

      if (
        effectiveObjective === undefined ||
        effectiveObjective.trim() === ""
      ) {
        missing.push(
          issue(
            "ad_group_objective_required",
            "objective",
            "VK требует objective для создания группы.",
            "provider_contract",
          ),
        );
      }

      if (!packageIds.includes(input.packageId)) {
        incompatible.push(
          issue(
            "ad_group_package_unavailable",
            "packageId",
            "Пакет отсутствует в актуальном справочнике кабинета.",
            "provider_reference",
          ),
        );
      }

      if (context.parent?.status === "deleted") {
        incompatible.push(
          issue(
            "ad_plan_deleted",
            "adPlanId",
            "Нельзя создать группу в удалённой кампании.",
            "provider_state",
          ),
        );
      }

      return readiness(
        "ad_group.create",
        "ad_group",
        input.adPlanId,
        missing,
        incompatible,
        packageIds,
        compatibility.allowedTargetings,
      );
    },
    buildRequest: snakeCaseGroupDraft,
  };

  const adGroupUpdate: ActionContract<
    AdGroupUpdateInput,
    CampaignContext
  > = {
    action: "ad_group.update",
    staticSchema: adGroupUpdateActionInputSchema,
    target: ({ id }) => ({ resource: "ad_group", id }),
    async loadContext(input, reads) {
      const group = await reads.loadOnce(
        `ad-group:${input.id}`,
        () => client.getAdGroup(input.id),
      );
      const packageId = input.packageId ?? group.packageId;
      const parentId = input.adPlanId ?? group.adPlanId;
      const [user, parent, packages] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`ad-plan:${parentId}`, () =>
          client.getAdPlan(parentId),
        ),
        reads.loadOnce(`packages:${packageId}`, () =>
          loadPackages(client, [packageId]),
        ),
      ]);
      return { user, parent, group, packages };
    },
    async validate(input, context) {
      const incompatible = [
        ...nullValueIssues(input.packageFields ?? {}, "packageFields"),
      ];
      const packageIds = context.packages
        .map((item) => item.id)
        .filter((id): id is number => typeof id === "number");
      const compatibility = groupCompatibilityIssues(
        input,
        context.packages[0],
      );
      incompatible.push(...compatibility.incompatible);

      if (context.group?.status === "deleted") {
        incompatible.push(
          issue(
            "ad_group_deleted",
            "id",
            "Удалённую группу нельзя изменять.",
            "provider_state",
          ),
        );
      }

      if (context.parent?.status === "deleted") {
        incompatible.push(
          issue(
            "ad_plan_deleted",
            "adPlanId",
            "Родительская кампания удалена.",
            "provider_state",
          ),
        );
      }

      return readiness(
        "ad_group.update",
        "ad_group",
        input.id,
        [],
        incompatible,
        packageIds,
        compatibility.allowedTargetings,
      );
    },
    buildRequest: ({ id: _id, ...input }) =>
      snakeCaseGroupDraft(input as AdGroupUpdateInput),
  };

  return [
    adPlanCreate,
    adPlanUpdate,
    adGroupCreate,
    adGroupUpdate,
  ] as Array<ActionContract<unknown, CampaignContext>>;
}
