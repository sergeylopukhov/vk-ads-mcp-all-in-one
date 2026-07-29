import { z } from "zod";

import type {
  VkAdsCurrentUser,
  VkAdsSharingKey,
} from "../vk-ads/client.js";
import type {
  ActionContract,
  ActionReadiness,
  RequirementIssue,
} from "./types.js";

const sharingSourceTypeSchema = z.enum([
  "users_list",
  "segment",
  "counter",
  "pricelist",
]);
const sharingSourceSchema = z.object({
  objectType: sharingSourceTypeSchema,
  objectId: z.number().int().positive(),
});
const sharingKeySchema = z.string().min(1).max(255);
const usernameSchema = z.string().min(1).max(255);
const priceSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
const paymentTypeSchema = z.enum(["free", "fixed_cpm"]);
const createSchema = z.object({
  sources: z.array(sharingSourceSchema).min(1),
  sendEmail: z.boolean().optional(),
  users: z
    .array(z.object({ username: usernameSchema }))
    .optional(),
  isMarketplace: z.boolean().optional(),
  paymentType: paymentTypeSchema.optional(),
  price: priceSchema.optional(),
});
const activateSchema = z.object({
  key: sharingKeySchema,
  sources: z.array(sharingSourceSchema).min(1).optional(),
});
const deleteSchema = z.object({ key: sharingKeySchema });

type CreateInput = z.infer<typeof createSchema>;
type ActivateInput = z.infer<typeof activateSchema>;
type DeleteInput = z.infer<typeof deleteSchema>;

export interface SharingKeyPreflightClient {
  getCurrentUser(): Promise<VkAdsCurrentUser>;
  sourceExists(
    type: z.infer<typeof sharingSourceTypeSchema>,
    id: number,
  ): Promise<boolean>;
  listSharingKeys(key?: string): Promise<VkAdsSharingKey[]>;
}

interface SharingKeyContext {
  user: VkAdsCurrentUser;
  sourceAccess?: Record<string, boolean>;
  ownedKeys?: VkAdsSharingKey[];
}

function issue(
  code: string,
  path: string,
  message: string,
  source: RequirementIssue["source"] = "provider_state",
): RequirementIssue {
  return { code, path, message, source };
}

function sourceKey(
  source: z.infer<typeof sharingSourceSchema>,
): string {
  return `${source.objectType}:${source.objectId}`;
}

function result(
  action: string,
  incompatibleFields: RequirementIssue[],
  warnings: RequirementIssue[] = [],
): ActionReadiness {
  return {
    ready: incompatibleFields.length === 0,
    action,
    stage: "compatibility",
    target: { resource: "sharing_key" },
    missingFields: [],
    incompatibleFields,
    warnings,
    allowedValues: [
      {
        path: "sources[].objectType",
        values: sharingSourceTypeSchema.options,
      },
      {
        path: "paymentType",
        values: paymentTypeSchema.options,
      },
    ],
    nextAction:
      incompatibleFields.length === 0
        ? "Выполните соответствующий write-инструмент."
        : "Исправьте условия и повторите подготовку.",
    requiresConfirmation: false,
  };
}

function duplicateSourceIssues(
  sources: z.infer<typeof sharingSourceSchema>[],
): RequirementIssue[] {
  const seen = new Set<string>();
  const issues: RequirementIssue[] = [];

  sources.forEach((source, index) => {
    const key = sourceKey(source);

    if (seen.has(key)) {
      issues.push(
        issue(
          "sharing_source_duplicate",
          `sources.${index}`,
          "Источник указан повторно.",
          "provider_contract",
        ),
      );
    }
    seen.add(key);
  });

  return issues;
}

export function createSharingKeyActionContracts(
  client: SharingKeyPreflightClient,
): Array<ActionContract<unknown, SharingKeyContext>> {
  const create: ActionContract<CreateInput, SharingKeyContext> = {
    action: "sharing_key.create",
    staticSchema: createSchema,
    target: () => ({ resource: "sharing_key" }),
    async loadContext(input, reads) {
      const [user, entries] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        Promise.all(
          input.sources.map(async (source) => [
            sourceKey(source),
            await reads.loadOnce(
              `sharing-source:${sourceKey(source)}`,
              () =>
                client.sourceExists(
                  source.objectType,
                  source.objectId,
                ),
            ),
          ]),
        ),
      ]);

      return {
        user,
        sourceAccess: Object.fromEntries(entries),
      };
    },
    async validate(input, context) {
      const incompatible = duplicateSourceIssues(input.sources);
      const usernames = input.users?.map(
        ({ username }) => username,
      );

      input.sources.forEach((source, index) => {
        if (!context.sourceAccess?.[sourceKey(source)]) {
          incompatible.push(
            issue(
              "sharing_source_unavailable",
              `sources.${index}`,
              "Источник не найден или недоступен текущему аккаунту.",
            ),
          );
        }
      });

      if (
        input.sendEmail === true &&
        (!usernames || usernames.length === 0)
      ) {
        incompatible.push(
          issue(
            "sharing_email_recipient_required",
            "users",
            "Для sendEmail=true укажите хотя бы одного получателя.",
            "provider_contract",
          ),
        );
      }

      if (
        usernames &&
        new Set(usernames).size !== usernames.length
      ) {
        incompatible.push(
          issue(
            "sharing_recipient_duplicate",
            "users",
            "Получатели не должны повторяться.",
            "provider_contract",
          ),
        );
      }

      if (
        input.isMarketplace === true &&
        (input.paymentType === undefined ||
          input.price === undefined)
      ) {
        incompatible.push(
          issue(
            "sharing_marketplace_terms_required",
            "paymentType",
            "Для публичного ключа укажите paymentType и price.",
            "provider_contract",
          ),
        );
      }

      return result("sharing_key.create", incompatible);
    },
    buildRequest: (input) => ({
      sources: input.sources.map((source) => ({
        object_type: source.objectType,
        object_id: source.objectId,
      })),
      ...(input.sendEmail === undefined
        ? {}
        : { send_email: input.sendEmail }),
      ...(input.users === undefined
        ? {}
        : { users_count: input.users.length }),
      ...(input.isMarketplace === undefined
        ? {}
        : { is_marketplace: input.isMarketplace }),
      ...(input.paymentType === undefined
        ? {}
        : { payment_type: input.paymentType }),
      ...(input.price === undefined ? {} : { price: input.price }),
    }),
  };

  const activate: ActionContract<
    ActivateInput,
    SharingKeyContext
  > = {
    action: "sharing_key.activate",
    staticSchema: activateSchema,
    target: () => ({ resource: "sharing_key" }),
    async loadContext(_input, reads) {
      const user = await reads.loadOnce("current-user", () =>
        client.getCurrentUser(),
      );
      return { user };
    },
    async validate(input) {
      const incompatible =
        input.sources === undefined
          ? []
          : duplicateSourceIssues(input.sources);
      return result("sharing_key.activate", incompatible, [
        issue(
          "sharing_key_foreign_state_unreadable",
          "key",
          "Чужой ключ нельзя безопасно прочитать до активации; окончательную проверку выполняет VK.",
          "provider_contract",
        ),
      ]);
    },
    buildRequest: (input) => ({
      ...(input.sources === undefined
        ? {}
        : {
            sources: input.sources.map((source) => ({
              object_type: source.objectType,
              object_id: source.objectId,
            })),
          }),
    }),
  };

  const remove: ActionContract<
    DeleteInput,
    SharingKeyContext
  > = {
    action: "sharing_key.delete",
    staticSchema: deleteSchema,
    target: () => ({ resource: "sharing_key" }),
    async loadContext(input, reads) {
      const [user, ownedKeys] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce("owned-sharing-key", () =>
          client.listSharingKeys(input.key),
        ),
      ]);
      return { user, ownedKeys };
    },
    async validate(input, context) {
      return result(
        "sharing_key.delete",
        context.ownedKeys?.some(
          (item) => item.sharingKey === input.key,
        )
          ? []
          : [
              issue(
                "sharing_key_not_owned",
                "key",
                "Ключ не найден среди ключей текущего владельца.",
              ),
            ],
      );
    },
    buildRequest: () => ({}),
  };

  return [create, activate, remove];
}
