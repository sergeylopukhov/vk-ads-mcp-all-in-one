import { VK_ADS_API_BASE_URL, type VkAdsClientCredentials } from "./config.js";
import { EnvFile } from "./env-file.js";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface VkAdsTokenManagerOptions {
  credentials: VkAdsClientCredentials;
  envFile: EnvFile;
  getAccessToken: () => string;
  getRefreshToken: () => string | undefined;
  setAccessToken: (token: string) => void;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
}

/** Получает и безопасно обновляет локальный токен VK Ads по client credentials. */
export class VkAdsTokenManager {
  private readonly fetchImplementation: typeof fetch;
  private refreshInFlight: Promise<string> | undefined;
  private refreshToken: string | undefined;

  public constructor(private readonly options: VkAdsTokenManagerOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.refreshToken = options.getRefreshToken();
  }

  public async refresh(): Promise<string> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.requestToken().finally(() => { this.refreshInFlight = undefined; });
    }
    return this.refreshInFlight;
  }

  private async requestToken(): Promise<string> {
    const refreshToken = this.refreshToken;
    const parameters = refreshToken
      ? {
          grant_type: "refresh_token",
          refresh_token: refreshToken,
          client_id: this.options.credentials.clientId,
          client_secret: this.options.credentials.clientSecret,
        }
      : {
          grant_type: "client_credentials",
          client_id: this.options.credentials.clientId,
          client_secret: this.options.credentials.clientSecret,
        };
    let response: Response;
    try {
      response = await this.fetchImplementation(`${VK_ADS_API_BASE_URL}/oauth2/token.json`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams(parameters),
        signal: AbortSignal.timeout(this.options.timeoutMs),
        redirect: "error",
      });
    } catch {
      throw new Error("Не удалось получить токен VK Ads. Проверьте интернет и повторите попытку.");
    }

    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const code = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error).replace(/[^a-zA-Z0-9_.-]/gu, "")
        : `HTTP-${response.status}`;
      if (code === "token_limit_exceeded") {
        throw new Error("VK Ads достиг лимита активных токенов этого приложения. Новый токен не создан.");
      }
      throw new Error(`VK Ads не выдал токен (${code || "unknown_error"}). Проверьте VK_ADS_CLIENT_ID и VK_ADS_CLIENT_SECRET в .env.`);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof (payload as TokenResponse).access_token !== "string" || !(payload as TokenResponse).access_token) {
      throw new Error("VK Ads вернул ответ без access_token.");
    }

    const token = (payload as TokenResponse).access_token;
    const expiresIn = Number((payload as TokenResponse).expires_in);
    const updates: Record<string, string> = { VK_ADS_TOKEN: token };
    if (typeof (payload as TokenResponse).refresh_token === "string" && (payload as TokenResponse).refresh_token) {
      updates.VK_ADS_REFRESH_TOKEN = (payload as TokenResponse).refresh_token!;
      this.refreshToken = updates.VK_ADS_REFRESH_TOKEN;
    }
    if (Number.isInteger(expiresIn) && expiresIn > 0) {
      updates.VK_ADS_TOKEN_EXPIRES_AT = new Date(Date.now() + expiresIn * 1_000).toISOString();
    }
    await this.options.envFile.set(updates);
    this.options.setAccessToken(token);
    return token;
  }
}
