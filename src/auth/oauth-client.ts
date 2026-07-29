import { z } from "zod";

import {
  formatProviderErrorSuffix,
  normalizeProviderError,
} from "../provider-error.js";
import {
  VkAdsAuthError,
  VkAdsTokenLimitError,
  VkAdsTokenRefreshError,
} from "./errors.js";

export const VK_ADS_TOKEN_ENDPOINT =
  "https://ads.vk.ru/api/v2/oauth2/token.json";
export const VK_ADS_CODE_INFO_ENDPOINT =
  "https://ads.vk.ru/api/v2/oauth2/code_info.json";
export const VK_ADS_TOKEN_DELETE_ENDPOINT =
  "https://ads.vk.ru/api/v2/oauth2/token/delete.json";

const REQUEST_TIMEOUT_MS = 15_000;

const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1),
  expires_in: z.coerce.number().int().positive(),
  token_type: z.string().min(1),
  scope: z.union([z.string(), z.array(z.string())]).optional(),
});
const codeInfoResponseSchema = z
  .object({
    user: z
      .object({
        id: z.union([z.number().int(), z.string().min(1)]),
        username: z.string().min(1),
        types: z.array(z.string().min(1)),
      })
      .passthrough(),
  })
  .passthrough();

export interface VkAdsTokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
}

export interface VkAdsAuthorizationCodeInfo {
  userTypes: string[];
}

export type FetchLike = (
  input: string | URL,
  init: RequestInit,
) => Promise<Response>;

interface VkAdsOAuthClientOptions {
  endpoint?: string;
  codeInfoEndpoint?: string;
  tokenDeleteEndpoint?: string;
  fetchImpl?: FetchLike;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new VkAdsAuthError(
      "VK Ads returned a non-JSON OAuth response.",
      "invalid_oauth_response",
      response.status,
    );
  }
}

export class VkAdsOAuthClient {
  private readonly endpoint: string;
  private readonly codeInfoEndpoint: string;
  private readonly tokenDeleteEndpoint: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: VkAdsOAuthClientOptions = {}) {
    this.endpoint = options.endpoint ?? VK_ADS_TOKEN_ENDPOINT;
    this.codeInfoEndpoint =
      options.codeInfoEndpoint ?? VK_ADS_CODE_INFO_ENDPOINT;
    this.tokenDeleteEndpoint =
      options.tokenDeleteEndpoint ?? VK_ADS_TOKEN_DELETE_ENDPOINT;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getAuthorizationCodeInfo(
    clientId: string,
    clientSecret: string,
    code: string,
  ): Promise<VkAdsAuthorizationCodeInfo> {
    let response: Response;

    try {
      response = await this.fetchImpl(this.codeInfoEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new VkAdsAuthError(
        "VK Ads code-info request failed before a confirmed response.",
        "oauth_transport_error",
      );
    }

    const payload = await readJson(response);

    if (!response.ok) {
      const providerError = normalizeProviderError(
        payload,
        "oauth_request_failed",
      );
      throw new VkAdsAuthError(
        `VK Ads rejected the authorization-code inspection request.${formatProviderErrorSuffix(providerError)}`,
        providerError.code,
        response.status,
      );
    }

    const parsed = codeInfoResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new VkAdsAuthError(
        "VK Ads returned an invalid authorization-code object.",
        "invalid_oauth_response",
        response.status,
      );
    }

    return {
      userTypes: [...parsed.data.user.types],
    };
  }

  async deleteCurrentUserTokens(
    clientId: string,
    clientSecret: string,
  ): Promise<void> {
    let response: Response;

    try {
      response = await this.fetchImpl(this.tokenDeleteEndpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
        }).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new VkAdsAuthError(
        "VK Ads token-deletion request failed before a confirmed response.",
        "oauth_transport_error",
      );
    }

    if (response.ok) {
      return;
    }

    let payload: unknown;

    try {
      const text = await response.text();
      payload = text === "" ? undefined : JSON.parse(text);
    } catch {
      payload = undefined;
    }

    const providerError = normalizeProviderError(
      payload,
      "oauth_request_failed",
    );

    throw new VkAdsAuthError(
      `VK Ads rejected the token-deletion request.${formatProviderErrorSuffix(providerError)}`,
      providerError.code,
      response.status,
    );
  }

  async issueClientCredentialsToken(
    clientId: string,
    clientSecret: string,
  ): Promise<VkAdsTokenResponse> {
    return await this.requestToken(
      new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
      }),
      false,
    );
  }

  async refreshAccessToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
  ): Promise<VkAdsTokenResponse> {
    return await this.requestToken(
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret,
      }),
      true,
    );
  }

  private async requestToken(
    body: URLSearchParams,
    isRefresh: boolean,
  ): Promise<VkAdsTokenResponse> {
    let response: Response;

    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new VkAdsAuthError(
        "VK Ads OAuth request failed before a confirmed response.",
        "oauth_transport_error",
      );
    }

    const payload = await readJson(response);

    if (!response.ok) {
      const providerError = normalizeProviderError(
        payload,
        "oauth_request_failed",
      );
      const { code } = providerError;

      if (response.status === 403 && code === "token_limit_exceeded") {
        throw new VkAdsTokenLimitError();
      }

      if (isRefresh) {
        throw new VkAdsTokenRefreshError(
          code,
          response.status,
          formatProviderErrorSuffix(providerError),
        );
      }

      throw new VkAdsAuthError(
        `VK Ads rejected the token creation request.${formatProviderErrorSuffix(providerError)}`,
        code,
        response.status,
      );
    }

    const parsed = tokenResponseSchema.safeParse(payload);

    if (!parsed.success) {
      throw new VkAdsAuthError(
        "VK Ads returned an invalid OAuth token object.",
        "invalid_oauth_response",
        response.status,
      );
    }

    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      expiresInSeconds: parsed.data.expires_in,
    };
  }
}
