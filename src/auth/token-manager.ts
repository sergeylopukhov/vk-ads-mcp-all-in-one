import type {
  PersistedTokenSet,
  StoredVkAdsCredentials,
  VkAdsCredentialStore,
} from "./env-store.js";
import { VkAdsTokenUnavailableError } from "./errors.js";
import type {
  VkAdsOAuthClient,
  VkAdsTokenResponse,
} from "./oauth-client.js";

export const DEFAULT_REFRESH_WINDOW_MS = 30 * 60 * 1_000;

type VkAdsTokenIssuer = Pick<
  VkAdsOAuthClient,
  "issueClientCredentialsToken" | "refreshAccessToken"
>;

interface VkAdsTokenManagerOptions {
  refreshWindowMs?: number;
  now?: () => number;
}

function isReusable(
  credentials: StoredVkAdsCredentials,
  now: number,
  refreshWindowMs: number,
): credentials is StoredVkAdsCredentials & { accessToken: string } {
  if (credentials.accessToken === undefined) {
    return false;
  }

  if (credentials.expiresAt === undefined) {
    return credentials.refreshToken === undefined;
  }

  return credentials.expiresAt - now > refreshWindowMs;
}

export class VkAdsTokenManager {
  private readonly refreshWindowMs: number;
  private readonly now: () => number;
  private activeRenewal: Promise<string> | undefined;

  constructor(
    private readonly store: VkAdsCredentialStore,
    private readonly oauthClient: VkAdsTokenIssuer,
    options: VkAdsTokenManagerOptions = {},
  ) {
    this.refreshWindowMs =
      options.refreshWindowMs ?? DEFAULT_REFRESH_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  async getAccessToken(): Promise<string> {
    const credentials = await this.store.load();

    if (
      isReusable(credentials, this.now(), this.refreshWindowMs)
    ) {
      return credentials.accessToken;
    }

    if (this.activeRenewal === undefined) {
      this.activeRenewal = this.renewAccessToken().finally(() => {
        this.activeRenewal = undefined;
      });
    }

    return await this.activeRenewal;
  }

  async refreshAfterAuthenticationFailure(
    rejectedAccessToken: string,
  ): Promise<string> {
    if (this.activeRenewal === undefined) {
      this.activeRenewal = this.renewRejectedAccessToken(
        rejectedAccessToken,
      ).finally(() => {
        this.activeRenewal = undefined;
      });
    }

    return await this.activeRenewal;
  }

  private async persistTokenResponse(
    response: VkAdsTokenResponse,
  ): Promise<string> {
    const tokens: PersistedTokenSet = {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresAt: this.now() + response.expiresInSeconds * 1_000,
    };

    await this.store.saveTokens(tokens);
    return tokens.accessToken;
  }

  private async renewRejectedAccessToken(
    rejectedAccessToken: string,
  ): Promise<string> {
    return await this.store.withRefreshLock(async () => {
      const credentials = await this.store.load();

      if (
        credentials.accessToken !== undefined &&
        credentials.accessToken !== rejectedAccessToken
      ) {
        return credentials.accessToken;
      }

      if (credentials.refreshToken === undefined) {
        throw new VkAdsTokenUnavailableError();
      }

      const response = await this.oauthClient.refreshAccessToken(
        credentials.clientId,
        credentials.clientSecret,
        credentials.refreshToken,
      );

      return await this.persistTokenResponse(response);
    });
  }

  private async renewAccessToken(): Promise<string> {
    return await this.store.withRefreshLock(async () => {
      const credentials = await this.store.load();

      if (
        isReusable(credentials, this.now(), this.refreshWindowMs)
      ) {
        return credentials.accessToken;
      }

      let response: VkAdsTokenResponse;

      if (credentials.refreshToken !== undefined) {
        response = await this.oauthClient.refreshAccessToken(
          credentials.clientId,
          credentials.clientSecret,
          credentials.refreshToken,
        );
      } else if (credentials.accessToken === undefined) {
        response = await this.oauthClient.issueClientCredentialsToken(
          credentials.clientId,
          credentials.clientSecret,
        );
      } else {
        throw new VkAdsTokenUnavailableError();
      }

      return await this.persistTokenResponse(response);
    });
  }
}
