import { z } from "zod";

import type {
  VkAdsAdGroup,
  VkAdsAdPlan,
  VkAdsBanner,
  VkAdsCurrentUser,
} from "../vk-ads/client.js";
import type {
  ActionContract,
  ActionReadiness,
  RequirementIssue,
} from "./types.js";

const statusSchema = z.enum(["active", "blocked", "deleted"]);
const decimalSchema = z.union([
  z.number().finite(),
  z.string().regex(/^-?(?:\d+|\d+\.\d+|\.\d+)$/u),
]);
const idSchema = z.number().int().positive();
const bannerSectionSchema = z.record(z.string(), z.unknown());

const adPlanMassActionSchema = z.object({
  changes: z
    .array(
      z
        .object({
          id: idSchema,
          status: statusSchema.optional(),
          budget_limit: decimalSchema.optional(),
          budget_limit_day: decimalSchema.optional(),
          date_start: z.string().min(1).optional(),
          date_end: z.string().min(1).optional(),
          max_price: decimalSchema.optional(),
        })
        .refine(
          ({ id: _id, ...changes }) =>
            Object.values(changes).some(
              (value) => value !== undefined,
            ),
          "Укажите хотя бы одно изменение кампании.",
        ),
    )
    .min(1)
    .max(200)
    .refine(
      (items) =>
        new Set(items.map((item) => item.id)).size ===
        items.length,
      "ID кампаний не должны повторяться.",
    ),
});

const adGroupDeleteSchema = z.object({ id: idSchema });
const adGroupMassActionSchema = z.object({
  changes: z
    .array(
      z
        .object({
          id: idSchema,
          status: statusSchema.optional(),
          max_price: decimalSchema.optional(),
        })
        .refine(
          ({ id: _id, ...changes }) =>
            Object.values(changes).some(
              (value) => value !== undefined,
            ),
          "Укажите хотя бы одно изменение группы.",
        ),
    )
    .min(1)
    .max(200)
    .refine(
      (items) =>
        new Set(items.map((item) => item.id)).size ===
        items.length,
      "ID групп не должны повторяться.",
    ),
});

const bannerUpdateSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1).optional(),
    status: statusSchema.optional(),
    content: bannerSectionSchema.optional(),
    textblocks: bannerSectionSchema.optional(),
    urls: bannerSectionSchema.optional(),
  })
  .refine(
    ({ id: _id, ...changes }) =>
      Object.values(changes).some(
        (value) => value !== undefined,
      ),
    "Укажите хотя бы одно изменение объявления.",
  );
const bannerDeleteSchema = z.object({ id: idSchema });
const bannerMassActionSchema = z.object({
  changes: z
    .array(
      z.object({
        id: idSchema,
        status: statusSchema,
      }),
    )
    .min(1)
    .max(200)
    .refine(
      (items) =>
        new Set(items.map((item) => item.id)).size ===
        items.length,
      "ID объявлений не должны повторяться.",
    ),
});
const bannerRemoderateSchema = z.object({
  ids: z
    .array(idSchema)
    .min(1)
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "ID объявлений не должны повторяться.",
    ),
});

type AdPlanMassInput = z.infer<typeof adPlanMassActionSchema>;
type AdGroupDeleteInput = z.infer<typeof adGroupDeleteSchema>;
type AdGroupMassInput = z.infer<typeof adGroupMassActionSchema>;
type BannerUpdateInput = z.infer<typeof bannerUpdateSchema>;
type BannerDeleteInput = z.infer<typeof bannerDeleteSchema>;
type BannerMassInput = z.infer<typeof bannerMassActionSchema>;
type BannerRemoderateInput = z.infer<
  typeof bannerRemoderateSchema
>;

export interface CoreWritePreflightClient {
  getCurrentUser(): Promise<VkAdsCurrentUser>;
  getAdPlan(id: number): Promise<VkAdsAdPlan>;
  getAdGroup(id: number): Promise<VkAdsAdGroup>;
  getBanner(id: number): Promise<VkAdsBanner>;
}

interface CoreContext {
  user: VkAdsCurrentUser;
  plans?: VkAdsAdPlan[];
  groups?: VkAdsAdGroup[];
  banners?: VkAdsBanner[];
}

function issue(
  code: string,
  path: string,
  message: string,
): RequirementIssue {
  return {
    code,
    path,
    message,
    source: "provider_state",
  };
}

function result(
  action: string,
  resource: string,
  id: number | undefined,
  incompatibleFields: RequirementIssue[],
  warnings: RequirementIssue[] = [],
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
    nextAction:
      incompatibleFields.length === 0
        ? "Выполните соответствующий write-инструмент с теми же полями."
        : "Обновите состояние объектов и повторите подготовку.",
    requiresConfirmation: false,
  };
}

function deletedIssues(
  items: Array<{ id: number; status?: string }>,
  pathById: Map<number, string>,
  code: string,
  noun: string,
): RequirementIssue[] {
  return items
    .filter((item) => item.status === "deleted")
    .map((item) =>
      issue(
        code,
        pathById.get(item.id) ?? "id",
        `Удалённый объект «${noun}» нельзя изменить повторно.`,
      ),
    );
}

async function loadMany<T>(
  ids: number[],
  load: (id: number) => Promise<T>,
  prefix: string,
  reads: {
    loadOnce<Value>(
      key: string,
      loader: () => Promise<Value>,
    ): Promise<Value>;
  },
): Promise<T[]> {
  return Promise.all(
    ids.map((id) =>
      reads.loadOnce(`${prefix}:${id}`, () => load(id)),
    ),
  );
}

export function createCoreWriteActionContracts(
  client: CoreWritePreflightClient,
): Array<ActionContract<unknown, CoreContext>> {
  const adPlanMass: ActionContract<
    AdPlanMassInput,
    CoreContext
  > = {
    action: "ad_plan.mass_action",
    staticSchema: adPlanMassActionSchema,
    target: () => ({ resource: "ad_plan" }),
    async loadContext(input, reads) {
      const [user, plans] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        loadMany(
          input.changes.map((item) => item.id),
          (id) => client.getAdPlan(id),
          "ad-plan",
          reads,
        ),
      ]);
      return { user, plans };
    },
    async validate(input, context) {
      const pathById = new Map(
        input.changes.map((item, index) => [
          item.id,
          `changes.${index}.id`,
        ]),
      );
      return result(
        "ad_plan.mass_action",
        "ad_plan",
        undefined,
        deletedIssues(
          context.plans ?? [],
          pathById,
          "ad_plan_deleted",
          "кампания",
        ),
      );
    },
    buildRequest: ({ changes }) => ({ changes }),
  };

  const adGroupDelete: ActionContract<
    AdGroupDeleteInput,
    CoreContext
  > = {
    action: "ad_group.delete",
    staticSchema: adGroupDeleteSchema,
    target: ({ id }) => ({ resource: "ad_group", id }),
    async loadContext(input, reads) {
      const [user, group] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`ad-group:${input.id}`, () =>
          client.getAdGroup(input.id),
        ),
      ]);
      return { user, groups: [group] };
    },
    async validate(input, context) {
      return result(
        "ad_group.delete",
        "ad_group",
        input.id,
        deletedIssues(
          context.groups ?? [],
          new Map([[input.id, "id"]]),
          "ad_group_already_deleted",
          "группа",
        ),
      );
    },
    buildRequest: ({ id }) => ({ id }),
  };

  const adGroupMass: ActionContract<
    AdGroupMassInput,
    CoreContext
  > = {
    action: "ad_group.mass_action",
    staticSchema: adGroupMassActionSchema,
    target: () => ({ resource: "ad_group" }),
    async loadContext(input, reads) {
      const [user, groups] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        loadMany(
          input.changes.map((item) => item.id),
          (id) => client.getAdGroup(id),
          "ad-group",
          reads,
        ),
      ]);
      return { user, groups };
    },
    async validate(input, context) {
      const pathById = new Map(
        input.changes.map((item, index) => [
          item.id,
          `changes.${index}.id`,
        ]),
      );
      return result(
        "ad_group.mass_action",
        "ad_group",
        undefined,
        deletedIssues(
          context.groups ?? [],
          pathById,
          "ad_group_deleted",
          "группа",
        ),
      );
    },
    buildRequest: ({ changes }) => ({ changes }),
  };

  const bannerUpdate: ActionContract<
    BannerUpdateInput,
    CoreContext
  > = {
    action: "banner.update",
    staticSchema: bannerUpdateSchema,
    target: ({ id }) => ({ resource: "banner", id }),
    async loadContext(input, reads) {
      const [user, banner] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`banner:${input.id}`, () =>
          client.getBanner(input.id),
        ),
      ]);
      const group = await reads.loadOnce(
        `ad-group:${banner.adGroupId}`,
        () => client.getAdGroup(banner.adGroupId),
      );
      return { user, groups: [group], banners: [banner] };
    },
    async validate(input, context) {
      const incompatible = [
        ...deletedIssues(
          context.banners ?? [],
          new Map([[input.id, "id"]]),
          "banner_deleted",
          "объявление",
        ),
        ...deletedIssues(
          context.groups ?? [],
          new Map(
            (context.groups ?? []).map((item) => [
              item.id,
              "id",
            ]),
          ),
          "ad_group_deleted",
          "группа",
        ),
      ];
      const changesCreative =
        input.content !== undefined ||
        input.textblocks !== undefined ||
        input.urls !== undefined;

      return result(
        "banner.update",
        "banner",
        input.id,
        incompatible,
        changesCreative
          ? [
              {
                code: "banner_pattern_revalidated_by_provider",
                path: "",
                message:
                  "Поля объявления проверены по текущему объекту; окончательную совместимость формата подтверждает VK.",
                source: "provider_contract",
              },
            ]
          : [],
      );
    },
    buildRequest: ({ id: _id, ...changes }) => changes,
  };

  const bannerDelete: ActionContract<
    BannerDeleteInput,
    CoreContext
  > = {
    action: "banner.delete",
    staticSchema: bannerDeleteSchema,
    target: ({ id }) => ({ resource: "banner", id }),
    async loadContext(input, reads) {
      const [user, banner] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`banner:${input.id}`, () =>
          client.getBanner(input.id),
        ),
      ]);
      return { user, banners: [banner] };
    },
    async validate(input, context) {
      return result(
        "banner.delete",
        "banner",
        input.id,
        deletedIssues(
          context.banners ?? [],
          new Map([[input.id, "id"]]),
          "banner_already_deleted",
          "объявление",
        ),
      );
    },
    buildRequest: ({ id }) => ({ id }),
  };

  const bannerMass: ActionContract<
    BannerMassInput,
    CoreContext
  > = {
    action: "banner.mass_action",
    staticSchema: bannerMassActionSchema,
    target: () => ({ resource: "banner" }),
    async loadContext(input, reads) {
      const [user, banners] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        loadMany(
          input.changes.map((item) => item.id),
          (id) => client.getBanner(id),
          "banner",
          reads,
        ),
      ]);
      return { user, banners };
    },
    async validate(input, context) {
      const pathById = new Map(
        input.changes.map((item, index) => [
          item.id,
          `changes.${index}.id`,
        ]),
      );
      return result(
        "banner.mass_action",
        "banner",
        undefined,
        deletedIssues(
          context.banners ?? [],
          pathById,
          "banner_deleted",
          "объявление",
        ),
      );
    },
    buildRequest: ({ changes }) => ({ changes }),
  };

  const bannerRemoderate: ActionContract<
    BannerRemoderateInput,
    CoreContext
  > = {
    action: "banner.remoderate",
    staticSchema: bannerRemoderateSchema,
    target: () => ({ resource: "banner" }),
    async loadContext(input, reads) {
      const [user, banners] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        loadMany(
          input.ids,
          (id) => client.getBanner(id),
          "banner",
          reads,
        ),
      ]);
      return { user, banners };
    },
    async validate(input, context) {
      const pathById = new Map(
        input.ids.map((id, index) => [id, `ids.${index}`]),
      );
      const incompatible = deletedIssues(
        context.banners ?? [],
        pathById,
        "banner_deleted",
        "объявление",
      );

      for (const banner of context.banners ?? []) {
        if (banner.moderationStatus !== "banned") {
          incompatible.push(
            issue(
              "banner_not_rejected_by_moderation",
              pathById.get(banner.id) ?? "ids",
              "На перемодерацию можно отправить только отклонённое объявление.",
            ),
          );
        }
      }

      return result(
        "banner.remoderate",
        "banner",
        undefined,
        incompatible,
      );
    },
    buildRequest: ({ ids }) => ({ ids }),
  };

  return [
    adPlanMass,
    adGroupDelete,
    adGroupMass,
    bannerUpdate,
    bannerDelete,
    bannerMass,
    bannerRemoderate,
  ] as Array<ActionContract<unknown, CoreContext>>;
}
