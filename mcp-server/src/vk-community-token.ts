import { randomBytes } from "node:crypto";

import { EnvFile } from "./env-file.js";

const RENEWAL_WINDOW_MS = 5 * 60_000;

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

export interface VkCommunityTokenManagerOptions {
  clientId: string;
  deviceId: string;
  envFile: EnvFile;
  getAccessToken: () => string;
  getRefreshToken: () => string | undefined;
  getExpiresAt: () => string | undefined;
  setAccessToken: (token: string) => void;
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
  now?: () => number;
}

/** Обновляет только Core VK API токен сообществ; VK Ads credential не затрагивается. */
export class VkCommunityTokenManager {
  private readonly fetchImplementation: typeof fetch;
  private refreshInFlight: Promise<string> | undefined;
  private refreshToken: string | undefined;

  public constructor(private readonly options: VkCommunityTokenManagerOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.refreshToken = options.getRefreshToken();
  }

  public async renewOnStartup(): Promise<void> {
    const expiresAt = Date.parse(this.options.getExpiresAt()?.trim() ?? "");
    const shouldRenew = !this.options.getAccessToken() || !Number.isFinite(expiresAt) || expiresAt - (this.options.now ?? Date.now)() <= RENEWAL_WINDOW_MS;
    if (shouldRenew && this.refreshToken) await this.refresh();
  }

  public async refresh(): Promise<string> {
    if (!this.refreshInFlight) this.refreshInFlight = this.requestRefresh().finally(() => { this.refreshInFlight = undefined; });
    return this.refreshInFlight;
  }

  private async requestRefresh(): Promise<string> {
    if (!this.refreshToken) throw new Error("Для сообществ требуется повторная авторизация VK ID: отсутствует refresh_token.");
    let response: Response;
    try {
      response = await this.fetchImplementation("https://id.vk.ru/oauth2/auth", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: this.refreshToken,
          client_id: this.options.clientId,
          device_id: this.options.deviceId,
          state: randomBytes(24).toString("base64url"),
        }),
        signal: AbortSignal.timeout(this.options.timeoutMs),
        redirect: "error",
      });
    } catch {
      throw new Error("Не удалось обновить токен сообществ через VK ID. Проверьте интернет и повторите авторизацию.");
    }
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok || !payload || typeof payload !== "object" || Array.isArray(payload) || typeof (payload as TokenResponse).access_token !== "string") {
      throw new Error("VK ID не обновил токен сообществ. Выполните авторизацию заново в установщике.");
    }
    const token = (payload as TokenResponse).access_token!;
    const updates: Record<string, string> = { VK_API_TOKEN: token };
    const refreshToken = (payload as TokenResponse).refresh_token;
    if (typeof refreshToken === "string" && refreshToken) {
      updates.VK_API_REFRESH_TOKEN = refreshToken;
      this.refreshToken = refreshToken;
    }
    const expiresIn = Number((payload as TokenResponse).expires_in);
    if (Number.isInteger(expiresIn) && expiresIn > 0) updates.VK_API_TOKEN_EXPIRES_AT = new Date((this.options.now ?? Date.now)() + expiresIn * 1_000).toISOString();
    await this.options.envFile.set(updates);
    this.options.setAccessToken(token);
    return token;
  }
}
