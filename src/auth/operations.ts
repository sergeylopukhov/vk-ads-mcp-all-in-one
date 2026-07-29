import {
  EnvFileVkAdsCredentialStore,
  type VkAdsCredentialStore,
} from "./env-store.js";
import {
  VkAdsOAuthClient,
  type VkAdsAuthorizationCodeInfo,
} from "./oauth-client.js";

type VkAdsOAuthOperationsClient = Pick<
  VkAdsOAuthClient,
  "getAuthorizationCodeInfo" | "deleteCurrentUserTokens"
>;

export interface VkAdsOAuthOperations {
  inspectAuthorizationCode(
    code: string,
  ): Promise<VkAdsAuthorizationCodeInfo>;
  deleteCurrentUserTokens(): Promise<void>;
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
}

export function createDefaultVkAdsOAuthOperations(): VkAdsOAuthOperations {
  return new DefaultVkAdsOAuthOperations(
    new EnvFileVkAdsCredentialStore(),
    new VkAdsOAuthClient(),
  );
}
