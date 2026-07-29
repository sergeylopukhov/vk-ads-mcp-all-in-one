import { z } from "zod";

import type {
  VkAdsCurrentUser,
  VkAdsSubscription,
} from "../vk-ads/client.js";
import type {
  ActionContract,
  ActionReadiness,
  RequirementIssue,
} from "./types.js";

export const subscriptionResourceSchema = z.enum([
  "BANNER",
  "CAMPAIGN",
  "OKLEADAD",
  "AD_GROUP",
  "LEAD",
  "LEAD_FORM",
  "SEGMENT",
  "USER",
]);
const createSchema = z.object({
  resource: subscriptionResourceSchema,
  callbackUrl: z
    .url()
    .refine(
      (value) => new URL(value).protocol === "https:",
      "Callback URL должен использовать HTTPS.",
    ),
});
const deleteSchema = z.object({
  id: z.number().int().positive(),
});

type CreateInput = z.infer<typeof createSchema>;
type DeleteInput = z.infer<typeof deleteSchema>;

export interface SubscriptionPreflightClient {
  getCurrentUser(): Promise<VkAdsCurrentUser>;
  listSubscriptions(): Promise<VkAdsSubscription[]>;
}

interface SubscriptionContext {
  user: VkAdsCurrentUser;
  subscriptions: VkAdsSubscription[];
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
      resource: "subscription",
      ...(id === undefined ? {} : { id }),
    },
    missingFields: [],
    incompatibleFields,
    warnings: [],
    allowedValues: [
      {
        path: "resource",
        values: subscriptionResourceSchema.options,
      },
    ],
    nextAction:
      incompatibleFields.length === 0
        ? "Выполните соответствующий write-инструмент."
        : "Исправьте условия и повторите подготовку.",
    requiresConfirmation: false,
  };
}

async function loadContext(
  client: SubscriptionPreflightClient,
  reads: {
    loadOnce<T>(
      key: string,
      loader: () => Promise<T>,
    ): Promise<T>;
  },
): Promise<SubscriptionContext> {
  const [user, subscriptions] = await Promise.all([
    reads.loadOnce("current-user", () =>
      client.getCurrentUser(),
    ),
    reads.loadOnce("subscriptions", () =>
      client.listSubscriptions(),
    ),
  ]);
  return { user, subscriptions };
}

export function createSubscriptionActionContracts(
  client: SubscriptionPreflightClient,
): Array<ActionContract<unknown, SubscriptionContext>> {
  const create: ActionContract<
    CreateInput,
    SubscriptionContext
  > = {
    action: "subscription.create",
    staticSchema: createSchema,
    target: () => ({ resource: "subscription" }),
    async loadContext(_input, reads) {
      return await loadContext(client, reads);
    },
    async validate(input, context) {
      const duplicate = context.subscriptions.some(
        (subscription) =>
          subscription.resource === input.resource &&
          subscription.callbackUrl === input.callbackUrl,
      );
      return result(
        "subscription.create",
        duplicate
          ? [
              issue(
                "subscription_duplicate",
                "callbackUrl",
                "Такая подписка уже существует.",
              ),
            ]
          : [],
      );
    },
    buildRequest(input) {
      return {
        resource: input.resource,
        callback_configured: true,
      };
    },
  };

  const remove: ActionContract<
    DeleteInput,
    SubscriptionContext
  > = {
    action: "subscription.delete",
    staticSchema: deleteSchema,
    target: (input) => ({
      resource: "subscription",
      id: input.id,
    }),
    async loadContext(_input, reads) {
      return await loadContext(client, reads);
    },
    async validate(input, context) {
      return result(
        "subscription.delete",
        context.subscriptions.some(
          (subscription) => subscription.id === input.id,
        )
          ? []
          : [
              issue(
                "subscription_not_found",
                "id",
                "Подписка не найдена или недоступна текущему аккаунту.",
              ),
            ],
        input.id,
      );
    },
    buildRequest() {
      return {};
    },
  };

  return [create, remove] as Array<
    ActionContract<unknown, SubscriptionContext>
  >;
}
