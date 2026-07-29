import { z } from "zod";

import type {
  VkAdsCurrentUser,
  VkAdsRemarketingPricelist,
} from "../vk-ads/client.js";
import type {
  ActionContract,
  ActionReadiness,
  RequirementIssue,
} from "./types.js";

const credentialsSchema = z
  .object({
    clientId: z.string().min(1).optional(),
    apiKey: z.string().min(1).optional(),
  })
  .strict();
export const pricelistCreateSchema = z
  .object({
    name: z.string().min(1).max(255),
    status: z.enum(["active", "blocked"]).default("active"),
    sourceType: z.enum([
      "api",
      "url",
      "ozon_api",
      "wildberries",
    ]),
    exportUrl: z.url().optional(),
    removeUtmTags: z.boolean().optional(),
    refreshPeriod: z.number().int().min(1).optional(),
    credentials: credentialsSchema.optional(),
  })
  .superRefine((input, context) => {
    const external = input.sourceType !== "api";
    if (external !== (input.exportUrl !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["exportUrl"],
        message:
          external
            ? "Для внешнего источника нужен exportUrl."
            : "Для API-прайс-листа exportUrl указывать нельзя.",
      });
    }
    if (
      input.sourceType === "ozon_api" &&
      (input.credentials?.clientId === undefined ||
        input.credentials.apiKey === undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["credentials"],
        message:
          "Для Ozon нужны credentials.clientId и credentials.apiKey.",
      });
    }
    if (
      input.sourceType === "wildberries" &&
      input.credentials?.apiKey === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["credentials.apiKey"],
        message: "Для Wildberries нужен credentials.apiKey.",
      });
    }
    if (
      (input.sourceType === "api" ||
        input.sourceType === "url") &&
      input.credentials !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["credentials"],
        message:
          "Для этого типа источника credentials указывать нельзя.",
      });
    }
    if (
      input.sourceType === "api" &&
      input.refreshPeriod !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["refreshPeriod"],
        message:
          "API-прайс-лист не имеет периодического обновления.",
      });
    }
  });
const operationSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("PUT"),
    data: z
      .record(z.string(), z.unknown())
      .refine(
        (data) =>
          typeof data.id === "string" && data.id.length > 0,
        "PUT data должен содержать непустой строковый id.",
      ),
  }),
  z.object({
    method: z.literal("DELETE"),
    data: z.object({ id: z.string().min(1) }).strict(),
  }),
]);
export const pricelistBatchSchema = z.object({
  pricelistId: z.number().int().positive(),
  operations: z.array(operationSchema).min(1),
});

type CreateInput = z.infer<typeof pricelistCreateSchema>;
type BatchInput = z.infer<typeof pricelistBatchSchema>;

export interface PricelistPreflightClient {
  getCurrentUser(): Promise<VkAdsCurrentUser>;
  listPricelists(): Promise<VkAdsRemarketingPricelist[]>;
}

interface PricelistContext {
  user: VkAdsCurrentUser;
  pricelists: VkAdsRemarketingPricelist[];
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
  incompatibleFields: RequirementIssue[],
  id?: number,
): ActionReadiness {
  return {
    ready: incompatibleFields.length === 0,
    action,
    stage: "compatibility",
    target: {
      resource: "pricelist",
      ...(id === undefined ? {} : { id }),
    },
    missingFields: [],
    incompatibleFields,
    warnings: [],
    nextAction:
      incompatibleFields.length === 0
        ? "Выполните соответствующий write-инструмент."
        : "Исправьте условия и повторите подготовку.",
    requiresConfirmation: false,
  };
}

async function loadContext(
  client: PricelistPreflightClient,
  reads: {
    loadOnce<T>(
      key: string,
      loader: () => Promise<T>,
    ): Promise<T>;
  },
): Promise<PricelistContext> {
  const [user, pricelists] = await Promise.all([
    reads.loadOnce("current-user", () =>
      client.getCurrentUser(),
    ),
    reads.loadOnce("pricelists", () =>
      client.listPricelists(),
    ),
  ]);
  return { user, pricelists };
}

export function createPricelistActionContracts(
  client: PricelistPreflightClient,
): Array<ActionContract<unknown, PricelistContext>> {
  const create: ActionContract<
    CreateInput,
    PricelistContext
  > = {
    action: "pricelist.create",
    staticSchema: pricelistCreateSchema,
    target: () => ({ resource: "pricelist" }),
    async loadContext(_input, reads) {
      return await loadContext(client, reads);
    },
    async validate(input, context) {
      return result(
        "pricelist.create",
        context.pricelists.some(
          (pricelist) => pricelist.name === input.name,
        )
          ? [
              issue(
                "pricelist_name_duplicate",
                "name",
                "Прайс-лист с таким именем уже существует.",
              ),
            ]
          : [],
      );
    },
    buildRequest(input) {
      return {
        name: input.name,
        status: input.status,
        source_type: input.sourceType,
        ...(input.removeUtmTags === undefined
          ? {}
          : { remove_utm_tags: input.removeUtmTags }),
        ...(input.refreshPeriod === undefined
          ? {}
          : { refresh_period: input.refreshPeriod }),
        ...(input.exportUrl === undefined
          ? {}
          : { export_url_configured: true }),
        ...(input.credentials === undefined
          ? {}
          : { credentials_configured: true }),
      };
    },
  };

  const batch: ActionContract<
    BatchInput,
    PricelistContext
  > = {
    action: "pricelist.batch_create",
    staticSchema: pricelistBatchSchema,
    target: (input) => ({
      resource: "pricelist",
      id: input.pricelistId,
    }),
    async loadContext(_input, reads) {
      return await loadContext(client, reads);
    },
    async validate(input, context) {
      const incompatible: RequirementIssue[] = [];
      const pricelist = context.pricelists.find(
        (item) => item.id === input.pricelistId,
      );
      if (pricelist === undefined) {
        incompatible.push(
          issue(
            "pricelist_not_found",
            "pricelistId",
            "Прайс-лист не найден или недоступен.",
          ),
        );
      } else if (
        pricelist.sourceType !== undefined &&
        pricelist.sourceType !== "api"
      ) {
        incompatible.push(
          issue(
            "pricelist_source_not_api",
            "pricelistId",
            "Пакетные операции доступны только API-прайс-листу.",
          ),
        );
      }

      const ids = input.operations.map(
        (operation) => operation.data.id,
      );
      if (new Set(ids).size !== ids.length) {
        incompatible.push(
          issue(
            "pricelist_batch_duplicate_offer",
            "operations",
            "В одном пакете ID товаров не должны повторяться.",
          ),
        );
      }
      const bytes = Buffer.byteLength(
        input.operations
          .map((operation) => JSON.stringify(operation))
          .join("\n"),
        "utf8",
      );
      if (bytes > 200 * 1024 * 1024) {
        incompatible.push(
          issue(
            "pricelist_batch_too_large",
            "operations",
            "NDJSON-пакет превышает 200 МБ.",
          ),
        );
      }

      return result(
        "pricelist.batch_create",
        incompatible,
        input.pricelistId,
      );
    },
    buildRequest(input) {
      return {
        operation_count: input.operations.length,
        ndjson_bytes: Buffer.byteLength(
          input.operations
            .map((operation) => JSON.stringify(operation))
            .join("\n"),
          "utf8",
        ),
      };
    },
  };

  return [create, batch] as Array<
    ActionContract<unknown, PricelistContext>
  >;
}
