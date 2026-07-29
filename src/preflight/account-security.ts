import { z } from "zod";

import type {
  VkAdsCurrentUser,
  VkAdsOrdUser,
} from "../vk-ads/client.js";
import type {
  ActionContract,
  ActionReadiness,
  RequirementIssue,
} from "./types.js";

export const oauthTokenRefreshSchema = z.object({
  confirmation: z.literal("REFRESH_CURRENT_VK_ADS_TOKENS"),
});
export const oauthTokensDeleteSchema = z.object({
  confirmation: z.literal(
    "DELETE_ALL_CURRENT_VK_ADS_TOKENS",
  ),
});
export const ordUserUpdateSchema = z
  .object({
    confirmation: z.literal("UPDATE_CURRENT_ORD_USER"),
    name: z.string().min(1).max(255).optional(),
    phone: z.string().min(1).max(64).optional(),
    inn: z.string().min(1).max(64).optional(),
    foreignEPaymentMethod: z.string().min(1).max(255).optional(),
    foreignCountryCode: z.string().min(1).max(16).optional(),
    foreignRegistrationNumber: z
      .string()
      .min(1)
      .max(255)
      .optional(),
    foreignInn: z.string().min(1).max(255).optional(),
    site: z.string().url().optional(),
  })
  .refine(
    ({ confirmation: _confirmation, ...fields }) =>
      Object.values(fields).some(
        (field) => field !== undefined,
      ),
    "Укажите хотя бы одно поле ОРД.",
  );

type RefreshInput = z.infer<typeof oauthTokenRefreshSchema>;
type DeleteInput = z.infer<typeof oauthTokensDeleteSchema>;
type OrdUpdateInput = z.infer<typeof ordUserUpdateSchema>;

export interface SafeOAuthTokenState {
  hasAccessToken: boolean;
  hasRefreshToken: boolean;
  expiresAt?: number;
}

export interface AccountSecurityPreflightClient {
  getCurrentUser(): Promise<VkAdsCurrentUser>;
  getTokenState(): Promise<SafeOAuthTokenState>;
  getOrdUser(): Promise<VkAdsOrdUser>;
}

interface OAuthContext {
  user: VkAdsCurrentUser;
  tokenState: SafeOAuthTokenState;
}

interface OrdContext {
  user: VkAdsCurrentUser;
  accessible: boolean;
}

function issue(
  code: string,
  path: string,
  message: string,
  source: RequirementIssue["source"] = "provider_state",
): RequirementIssue {
  return { code, path, message, source };
}

function readiness(
  action: string,
  resource: string,
  incompatibleFields: RequirementIssue[],
  warnings: RequirementIssue[] = [],
): ActionReadiness {
  return {
    ready: incompatibleFields.length === 0,
    action,
    stage:
      incompatibleFields.some(
        (item) => item.code === "ord_user_access_unavailable",
      )
        ? "permission"
        : "compatibility",
    target: { resource },
    missingFields: [],
    incompatibleFields,
    warnings,
    nextAction:
      incompatibleFields.length === 0
        ? "Выполните соответствующий write-инструмент."
        : "Устраните указанное ограничение и повторите подготовку.",
    requiresConfirmation: false,
  };
}

function buildOrdRequest(input: OrdUpdateInput) {
  return {
    ...(input.name === undefined
      ? {}
      : { name_configured: true }),
    ...(input.phone === undefined
      ? {}
      : { phone_configured: true }),
    ...(input.inn === undefined ? {} : { inn_configured: true }),
    ...(input.foreignEPaymentMethod === undefined
      ? {}
      : { foreign_epayment_method_configured: true }),
    ...(input.foreignCountryCode === undefined
      ? {}
      : { foreign_country_code_configured: true }),
    ...(input.foreignRegistrationNumber === undefined
      ? {}
      : { foreign_registration_number_configured: true }),
    ...(input.foreignInn === undefined
      ? {}
      : { foreign_inn_configured: true }),
    ...(input.site === undefined
      ? {}
      : { site_configured: true }),
  };
}

export function createAccountSecurityActionContracts(
  client: AccountSecurityPreflightClient,
): Array<ActionContract<unknown, unknown>> {
  const refresh: ActionContract<RefreshInput, OAuthContext> = {
    action: "oauth.tokens_refresh",
    staticSchema: oauthTokenRefreshSchema,
    target: () => ({ resource: "oauth_tokens" }),
    async loadContext(_input, reads) {
      const [user, tokenState] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce("oauth-token-state", () =>
          client.getTokenState(),
        ),
      ]);
      return { user, tokenState };
    },
    async validate(_input, context) {
      const incompatible: RequirementIssue[] = [];
      if (
        context.tokenState.hasAccessToken &&
        !context.tokenState.hasRefreshToken
      ) {
        incompatible.push(
          issue(
            "oauth_refresh_token_missing",
            "confirmation",
            "Для текущего access token отсутствует refresh token.",
          ),
        );
      }
      const warnings: RequirementIssue[] = [];
      if (
        context.tokenState.expiresAt !== undefined &&
        context.tokenState.expiresAt > Date.now()
      ) {
        warnings.push(
          issue(
            "oauth_access_token_not_expired",
            "confirmation",
            "Текущий access token ещё не истёк; обновление всё равно отзовёт прежнюю пару.",
          ),
        );
      }
      return readiness(
        "oauth.tokens_refresh",
        "oauth_tokens",
        incompatible,
        warnings,
      );
    },
    buildRequest() {
      return { confirmed: true };
    },
  };

  const remove: ActionContract<DeleteInput, OAuthContext> = {
    action: "oauth.tokens_delete",
    staticSchema: oauthTokensDeleteSchema,
    target: () => ({ resource: "oauth_tokens" }),
    async loadContext(_input, reads) {
      const [user, tokenState] = await Promise.all([
        reads.loadOnce("current-user", () =>
          client.getCurrentUser(),
        ),
        reads.loadOnce("oauth-token-state", () =>
          client.getTokenState(),
        ),
      ]);
      return { user, tokenState };
    },
    async validate(_input, context) {
      return readiness(
        "oauth.tokens_delete",
        "oauth_tokens",
        [],
        context.tokenState.hasAccessToken ||
          context.tokenState.hasRefreshToken
          ? [
              issue(
                "oauth_all_tokens_will_be_revoked",
                "confirmation",
                "Все токены текущего OAuth-клиента будут отозваны; сервер затем получит новую пару.",
                "provider_contract",
              ),
            ]
          : [],
      );
    },
    buildRequest() {
      return { confirmed: true };
    },
  };

  const ordUpdate: ActionContract<OrdUpdateInput, OrdContext> = {
    action: "ord_user.update",
    staticSchema: ordUserUpdateSchema,
    target: () => ({ resource: "ord_user" }),
    async loadContext(_input, reads) {
      const user = await reads.loadOnce("current-user", () =>
        client.getCurrentUser(),
      );
      let accessible = true;
      try {
        await reads.loadOnce("ord-user", () =>
          client.getOrdUser(),
        );
      } catch {
        accessible = false;
      }
      return { user, accessible };
    },
    async validate(_input, context) {
      return readiness(
        "ord_user.update",
        "ord_user",
        context.accessible
          ? []
          : [
              issue(
                "ord_user_access_unavailable",
                "",
                "Данные физлица ОРД недоступны для текущего типа аккаунта.",
              ),
            ],
      );
    },
    buildRequest(input) {
      return buildOrdRequest(input);
    },
  };

  return [
    refresh as ActionContract<unknown, unknown>,
    remove as ActionContract<unknown, unknown>,
    ordUpdate as ActionContract<unknown, unknown>,
  ];
}
