import { z } from "zod";

import type {
  VkAdsCurrentUser,
  VkAdsLocalGeo,
  VkAdsMobileStoreApp,
  VkAdsUserApiVersion,
  VkAdsUserProfile,
} from "../vk-ads/client.js";
import type {
  ActionContract,
  ActionReadiness,
  RequirementIssue,
} from "./types.js";

export const localGeoRegionSchema = z
  .object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
    radius: z.number().int().min(500).max(10_000),
    label: z.string().max(255),
    address: z.string().max(1000),
  })
  .strict();
const localGeoCreateSchema = z.object({
  name: z.string().min(1).max(255),
  regions: z.array(localGeoRegionSchema).min(1),
});
const localGeoUpdateSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(255),
  regions: z.array(localGeoRegionSchema).min(1),
});
const localGeoDeleteSchema = z.object({
  id: z.number().int().positive(),
});
const advertisingUrlSchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      return [
        "http:",
        "https:",
        "market:",
        "itms:",
        "itms-apps:",
      ].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Недопустимая схема рекламируемой ссылки.");
const urlCreateSchema = z.object({ url: advertisingUrlSchema });
const mobileStoreSchema = z
  .object({
    store: z.enum(["apple", "google"]),
    identifier: z.string().min(1).max(255),
  })
  .superRefine(({ store, identifier }, context) => {
    const valid =
      store === "apple"
        ? /^\d+$/.test(identifier)
        : /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(
            identifier,
          );
    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["identifier"],
        message:
          store === "apple"
            ? "Для App Store нужен числовой ID."
            : "Для Google Play нужен package name.",
      });
    }
  });
const userLanguageSchema = z.object({
  version: z.enum(["v2", "v3"]),
  language: z.enum(["ru", "en"]),
});
const skAdSchema = z.object({
  action: z.enum(["share", "withdraw"]),
  appId: z.number().int().positive(),
  count: z.number().int().positive(),
  username: z.string().min(1).max(255),
});

type LocalGeoCreateInput = z.infer<typeof localGeoCreateSchema>;
type LocalGeoUpdateInput = z.infer<typeof localGeoUpdateSchema>;
type LocalGeoDeleteInput = z.infer<typeof localGeoDeleteSchema>;
type UrlCreateInput = z.infer<typeof urlCreateSchema>;
type MobileStoreInput = z.infer<typeof mobileStoreSchema>;
type UserLanguageInput = z.infer<typeof userLanguageSchema>;
type SkAdInput = z.infer<typeof skAdSchema>;

export interface InfrastructurePreflightClient {
  getCurrentUser(): Promise<VkAdsCurrentUser>;
  listLocalGeos(): Promise<VkAdsLocalGeo[]>;
  getMobileStoreApp(
    store: "apple" | "google",
    identifier: string,
  ): Promise<VkAdsMobileStoreApp>;
  getUserProfile(
    version: VkAdsUserApiVersion,
  ): Promise<VkAdsUserProfile>;
  listMobileAppsForSkAd(): Promise<
    Array<Record<string, unknown>>
  >;
}

interface InfrastructureContext {
  user: VkAdsCurrentUser;
  localGeos?: VkAdsLocalGeo[];
  mobileApp?: VkAdsMobileStoreApp;
  profile?: VkAdsUserProfile;
  skAdApps?: Array<Record<string, unknown>>;
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
  incompatibleFields: RequirementIssue[],
  warnings: RequirementIssue[] = [],
  id?: number,
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
        ? "Выполните соответствующий write-инструмент."
        : "Исправьте условия и повторите подготовку.",
    requiresConfirmation: false,
  };
}

function duplicateRegionIssues(
  regions: LocalGeoCreateInput["regions"],
): RequirementIssue[] {
  const keys = regions.map(
    (region) =>
      `${region.lat}\u0000${region.lng}\u0000${region.radius}`,
  );
  return new Set(keys).size === keys.length
    ? []
    : [
        issue(
          "local_geo_region_duplicate",
          "regions",
          "Области с одинаковым центром и радиусом не должны повторяться.",
          "provider_contract",
        ),
      ];
}

function readAvailable(
  item: Record<string, unknown>,
): number | undefined {
  const counters = item.sk_ad_network_ids;
  if (
    counters === null ||
    typeof counters !== "object" ||
    Array.isArray(counters)
  ) {
    return undefined;
  }
  const available = (counters as Record<string, unknown>).available;
  return typeof available === "number" &&
    Number.isInteger(available) &&
    available >= 0
    ? available
    : undefined;
}

export function createInfrastructureActionContracts(
  client: InfrastructurePreflightClient,
): Array<ActionContract<unknown, InfrastructureContext>> {
  const geoCreate: ActionContract<
    LocalGeoCreateInput,
    InfrastructureContext
  > = {
    action: "local_geo.create",
    staticSchema: localGeoCreateSchema,
    target: () => ({ resource: "local_geo" }),
    async loadContext(_input, reads) {
      const [user, localGeos] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce("local-geos", () =>
          client.listLocalGeos(),
        ),
      ]);
      return { user, localGeos };
    },
    async validate(input, context) {
      const incompatible = duplicateRegionIssues(input.regions);
      if (
        context.localGeos?.some(
          (localGeo) => localGeo.name === input.name,
        )
      ) {
        incompatible.push(
          issue(
            "local_geo_name_duplicate",
            "name",
            "Список локальной географии с таким именем уже существует.",
          ),
        );
      }
      return result(
        "local_geo.create",
        "local_geo",
        incompatible,
      );
    },
    buildRequest(input) {
      return input;
    },
  };

  const geoUpdate: ActionContract<
    LocalGeoUpdateInput,
    InfrastructureContext
  > = {
    action: "local_geo.update",
    staticSchema: localGeoUpdateSchema,
    target: (input) => ({
      resource: "local_geo",
      id: input.id,
    }),
    async loadContext(_input, reads) {
      const [user, localGeos] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce("local-geos", () =>
          client.listLocalGeos(),
        ),
      ]);
      return { user, localGeos };
    },
    async validate(input, context) {
      const incompatible = duplicateRegionIssues(input.regions);
      if (
        !context.localGeos?.some(
          (localGeo) => localGeo.id === input.id,
        )
      ) {
        incompatible.push(
          issue(
            "local_geo_not_found",
            "id",
            "Список локальной географии не найден.",
          ),
        );
      }
      if (
        context.localGeos?.some(
          (localGeo) =>
            localGeo.id !== input.id &&
            localGeo.name === input.name,
        )
      ) {
        incompatible.push(
          issue(
            "local_geo_name_duplicate",
            "name",
            "Другой список уже использует это имя.",
          ),
        );
      }
      return result(
        "local_geo.update",
        "local_geo",
        incompatible,
        [],
        input.id,
      );
    },
    buildRequest(input) {
      return { name: input.name, regions: input.regions };
    },
  };

  const geoDelete: ActionContract<
    LocalGeoDeleteInput,
    InfrastructureContext
  > = {
    action: "local_geo.delete",
    staticSchema: localGeoDeleteSchema,
    target: (input) => ({
      resource: "local_geo",
      id: input.id,
    }),
    async loadContext(_input, reads) {
      const [user, localGeos] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce("local-geos", () =>
          client.listLocalGeos(),
        ),
      ]);
      return { user, localGeos };
    },
    async validate(input, context) {
      return result(
        "local_geo.delete",
        "local_geo",
        context.localGeos?.some(
          (localGeo) => localGeo.id === input.id,
        )
          ? []
          : [
              issue(
                "local_geo_not_found",
                "id",
                "Список локальной географии не найден.",
              ),
            ],
        [],
        input.id,
      );
    },
    buildRequest() {
      return {};
    },
  };

  const urlCreate: ActionContract<
    UrlCreateInput,
    InfrastructureContext
  > = {
    action: "url.create",
    staticSchema: urlCreateSchema,
    target: () => ({ resource: "url" }),
    async loadContext(_input, reads) {
      return {
        user: await reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
      };
    },
    async validate() {
      return result(
        "url.create",
        "url",
        [],
        [
          issue(
            "url_provider_classification",
            "url",
            "VK выполнит окончательную классификацию и проверку ссылки.",
            "provider_contract",
          ),
        ],
      );
    },
    buildRequest() {
      return { url_configured: true };
    },
  };

  const mobileRefresh: ActionContract<
    MobileStoreInput,
    InfrastructureContext
  > = {
    action: "mobile_store_app.refresh",
    staticSchema: mobileStoreSchema,
    target: () => ({ resource: "mobile_store_app" }),
    async loadContext(input, reads) {
      const [user, mobileApp] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(
          `mobile-store:${input.store}:${input.identifier}`,
          () =>
            client.getMobileStoreApp(
              input.store,
              input.identifier,
            ),
        ),
      ]);
      return { user, mobileApp };
    },
    async validate(input, context) {
      return result(
        "mobile_store_app.refresh",
        "mobile_store_app",
        context.mobileApp?.identifier === input.identifier
          ? []
          : [
              issue(
                "mobile_store_app_identifier_mismatch",
                "identifier",
                "Приложение магазина не совпало с запросом.",
              ),
            ],
        [],
        context.mobileApp?.id,
      );
    },
    buildRequest(input) {
      return { store: input.store, identifier: input.identifier };
    },
  };

  const languageUpdate: ActionContract<
    UserLanguageInput,
    InfrastructureContext
  > = {
    action: "user.language_update",
    staticSchema: userLanguageSchema,
    target: () => ({ resource: "user" }),
    async loadContext(input, reads) {
      const [user, profile] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce(`user-profile:${input.version}`, () =>
          client.getUserProfile(input.version),
        ),
      ]);
      return { user, profile };
    },
    async validate(input, context) {
      return result(
        "user.language_update",
        "user",
        context.profile?.language === input.language
          ? [
              issue(
                "user_language_noop",
                "language",
                "Этот язык уже установлен; запись не изменит состояние.",
              ),
            ]
          : [],
      );
    },
    buildRequest(input) {
      return { version: input.version, language: input.language };
    },
  };

  const skAd: ActionContract<
    SkAdInput,
    InfrastructureContext
  > = {
    action: "skad_network_ids.transfer",
    staticSchema: skAdSchema,
    target: (input) => ({
      resource: "apple_app",
      id: input.appId,
    }),
    async loadContext(_input, reads) {
      const [user, skAdApps] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce("skad-apps", () =>
          client.listMobileAppsForSkAd(),
        ),
      ]);
      return { user, skAdApps };
    },
    async validate(input, context) {
      const app = context.skAdApps?.find(
        (item) => item.rb_mobile_app_id === input.appId,
      );
      const available =
        app === undefined ? undefined : readAvailable(app);
      const incompatible: RequirementIssue[] = [];
      if (available === undefined) {
        incompatible.push(
          issue(
            "skad_application_not_found",
            "appId",
            "Apple-приложение со счётчиками SKAdNetwork не найдено.",
          ),
        );
      } else if (
        input.action === "share" &&
        available < input.count
      ) {
        incompatible.push(
          issue(
            "skad_available_insufficient",
            "count",
            "Недостаточно доступных SKAdNetwork ID.",
          ),
        );
      }
      return result(
        "skad_network_ids.transfer",
        "apple_app",
        incompatible,
        [
          issue(
            "skad_transfer_recipient_provider_validation",
            "username",
            "Право кабинета-получателя окончательно проверит VK.",
            "provider_contract",
          ),
        ],
        input.appId,
      );
    },
    buildRequest(input) {
      return {
        action: input.action,
        app_id: input.appId,
        count: input.count,
        recipient_configured: true,
      };
    },
  };

  return [
    geoCreate,
    geoUpdate,
    geoDelete,
    urlCreate,
    mobileRefresh,
    skAd,
    languageUpdate,
  ] as Array<ActionContract<unknown, InfrastructureContext>>;
}
