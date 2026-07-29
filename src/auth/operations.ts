import {
  EnvFileVkAdsCredentialStore,
  type PersistedTokenSet,
  type VkAdsCredentialStore,
} from "./env-store.js";
import { VkAdsTokenUnavailableError } from "./errors.js";
import {
  VkAdsOAuthClient,
  type VkAdsAuthorizationCodeInfo,
  type VkAdsTokenResponse,
} from "./oauth-client.js";

type VkAdsOAuthOperationsClient = Pick<
  VkAdsOAuthClient,
  | "getAuthorizationCodeInfo"
  | "deleteCurrentUserTokens"
  | "issueClientCredentialsToken"
  | "refreshAccessToken"
>;

export interface VkAdsOAuthOperations {
  inspectAuthorizationCode(
    code: string,
  ): Promise<VkAdsAuthorizationCodeInfo>;
  refreshCurrentTokens?(): Promise<{ expiresAt: number }>;
  deleteCurrentUserTokens(): Promise<void>;
  getCurrentTokenState?(): Promise<{
    hasAccessToken: boolean;
    hasRefreshToken: boolean;
    expiresAt?: number;
  }>;
}

export class DefaultVkAdsOAuthOperations
  implements VkAdsOAuthOperations
{
  constructor(
    private readonly store: VkAdsCredentialStore,
    private readonly oauthClient: VkAdsOAuthOperationsClient,
  ) {}

  async inspectAuthorizationCode(
    code: string,
  ): Promise<VkAdsAuthorizationCodeInfo> {
    const credentials = await this.store.load();

    return await this.oauthClient.getAuthorizationCodeInfo(
      credentials.clientId,
      credentials.clientSecret,
      code,
    );
  }

  async getCurrentTokenState() {
    const credentials = await this.store.load();

    return {
      hasAccessToken: credentials.accessToken !== undefined,
      hasRefreshToken: credentials.refreshToken !== undefined,
      ...(credentials.expiresAt === undefined
        ? {}
        : { expiresAt: credentials.expiresAt }),
    };
  }

  async deleteCurrentUserTokens(): Promise<void> {
    await this.store.withRefreshLock(async () => {
      const credentials = await this.store.load();

      await this.oauthClient.deleteCurrentUserTokens(
        credentials.clientId,
        credentials.clientSecret,
      );
      await this.store.clearTokens();
    });
  }

  async refreshCurrentTokens(): Promise<{ expiresAt: number }> {
    return await this.store.withRefreshLock(async () => {
      const credentials = await this.store.load();
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

      const tokens: PersistedTokenSet = {
        accessToken: response.accessToken,
        refreshToken: response.refreshToken,
        expiresAt: Date.now() + response.expiresInSeconds * 1_000,
      };
      await this.store.saveTokens(tokens);
      return { expiresAt: tokens.expiresAt };
    });
  }
}

export function createDefaultVkAdsOAuthOperations(): VkAdsOAuthOperations {
  return new DefaultVkAdsOAuthOperations(
    new EnvFileVkAdsCredentialStore(),
    new VkAdsOAuthClient(),
  );
}
