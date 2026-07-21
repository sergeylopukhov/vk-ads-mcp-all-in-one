import { VK_ADS_API_BASE_URL, type VkAdsClientCredentials } from "./config.js";
import { EnvFile } from "./env-file.js";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
}

const STARTUP_RENEWAL_WINDOW_MS = 60 * 60 * 1_000;

class TokenLimitExceededError extends Error {
  public constructor() {
    super("VK Ads достиг лимита активных токенов этого приложения. Новый токен не создан.");
    this.name = "TokenLimitExceededError";
  }
}

export interface VkAdsTokenManagerOptions {
  credentials: VkAdsClientCredentials;
  envFile: EnvFile;
  getAccessToken: () => string;
  getRefreshToken: () => string | undefined;
  getTokenExpiresAt: () => string | undefined;
  setAccessToken: (token: string) => void;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
  now?: () => number;
}

export interface TokenLimitRecoveryResult {
  token_reissued: true;
  refresh_token_saved: true;
  expires_at?: string;
}

/** Получает и безопасно обновляет локальный токен VK Ads по client credentials. */
export class VkAdsTokenManager {
  private readonly fetchImplementation: typeof fetch;
  private refreshInFlight: Promise<string> | undefined;
  private recoveryInFlight: Promise<TokenLimitRecoveryResult> | undefined;
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

  /**
   * До подключения stdio обновляет истекающий access token через refresh_token.
   * Новый токен выпускается только как восстановление после token_limit_exceeded.
   */
  public async renewOnStartup(): Promise<void> {
    if (!this.shouldRenewOnStartup() || !this.refreshToken) return;
    try {
      await this.refresh();
    } catch (error) {
      if (!(error instanceof TokenLimitExceededError)) throw error;
      await this.recoverTokenLimit();
    }
  }

  /**
   * Последний вариант восстановления после token_limit_exceeded.
   * VK удаляет все токены текущей связки clientId--user, затем выпускается
   * ровно один новый token с обязательным refresh_token.
   */
  public async recoverTokenLimit(): Promise<TokenLimitRecoveryResult> {
    if (!this.recoveryInFlight) {
      this.recoveryInFlight = this.revokeAndIssueFreshToken().finally(() => { this.recoveryInFlight = undefined; });
    }
    return this.recoveryInFlight;
  }

  private async revokeAndIssueFreshToken(): Promise<TokenLimitRecoveryResult> {
    let response: Response;
    try {
      response = await this.fetchImplementation(`${VK_ADS_API_BASE_URL}/oauth2/token/delete.json`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          client_id: this.options.credentials.clientId,
          client_secret: this.options.credentials.clientSecret,
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
        redirect: "error",
      });
    } catch {
      throw new Error("Не удалось удалить токены VK Ads. Проверьте интернет и повторите попытку.");
    }
    if (!response.ok) throw new Error(`VK Ads не удалил токены (${await this.providerErrorCode(response)}).`);

    // После успешного отзыва старые локальные значения заменяются одним атомарным сохранением.
    await this.requestToken({ requireRefreshToken: true, forceClientCredentials: true });
    return {
      token_reissued: true,
      refresh_token_saved: true,
      ...(this.tokenExpiresAt ? { expires_at: this.tokenExpiresAt } : {}),
    };
  }

  private tokenExpiresAt: string | undefined;

  private shouldRenewOnStartup(): boolean {
    if (!this.options.getAccessToken()) return true;
    const expiresAt = this.options.getTokenExpiresAt()?.trim();
    if (!expiresAt) return true;
    const expiresAtMilliseconds = Date.parse(expiresAt);
    return !Number.isFinite(expiresAtMilliseconds) || expiresAtMilliseconds - (this.options.now ?? Date.now)() <= STARTUP_RENEWAL_WINDOW_MS;
  }

  private async requestToken(options: { requireRefreshToken?: boolean; forceClientCredentials?: boolean } = {}): Promise<string> {
    const refreshToken = options.forceClientCredentials ? undefined : this.refreshToken;
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
      const code = this.errorCodeFromPayload(payload, response.status);
      if (code === "token_limit_exceeded") {
        throw new TokenLimitExceededError();
      }
      throw new Error(`VK Ads не выдал токен (${code || "unknown_error"}). Проверьте VK_ADS_CLIENT_ID и VK_ADS_CLIENT_SECRET в .env.`);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || typeof (payload as TokenResponse).access_token !== "string" || !(payload as TokenResponse).access_token) {
      throw new Error("VK Ads вернул ответ без access_token.");
    }

    const token = (payload as TokenResponse).access_token;
    const expiresIn = Number((payload as TokenResponse).expires_in);
    const returnedRefreshToken = (payload as TokenResponse).refresh_token;
    if (options.requireRefreshToken && (typeof returnedRefreshToken !== "string" || !returnedRefreshToken)) {
      throw new Error("VK Ads не вернул refresh_token после восстановления. Новый access token не сохранён.");
    }
    const updates: Record<string, string> = { VK_ADS_TOKEN: token };
    if (typeof returnedRefreshToken === "string" && returnedRefreshToken) {
      updates.VK_ADS_REFRESH_TOKEN = returnedRefreshToken;
      this.refreshToken = updates.VK_ADS_REFRESH_TOKEN;
    }
    if (Number.isInteger(expiresIn) && expiresIn > 0) {
      updates.VK_ADS_TOKEN_EXPIRES_AT = new Date((this.options.now ?? Date.now)() + expiresIn * 1_000).toISOString();
      this.tokenExpiresAt = updates.VK_ADS_TOKEN_EXPIRES_AT;
    }
    await this.options.envFile.set(updates);
    this.options.setAccessToken(token);
    return token;
  }

  private async providerErrorCode(response: Response): Promise<string> {
    const payload: unknown = await response.json().catch(() => undefined);
    return this.errorCodeFromPayload(payload, response.status);
  }

  private errorCodeFromPayload(payload: unknown, status: number): string {
    return payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error?: unknown }).error).replace(/[^a-zA-Z0-9_.-]/gu, "")
      : `HTTP-${status}`;
  }
}
