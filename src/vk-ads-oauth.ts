import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type Server } from "node:http";

import { credentialAccount, VK_ADS_API_BASE_URL } from "./config.js";
import type { SecretStore } from "./secret-store.js";

const VK_ADS_AUTHORIZATION_URL = "https://ads.vk.com/hq/settings/access?action=oauth2" as const;
const AUTH_TIMEOUT_MS = 10 * 60_000;
export const VK_ADS_OAUTH_SCOPES = [
  "read_ads",
  "read_payments",
  "create_ads",
  "read_clients",
  "create_clients",
  "create_agency_payments",
  "read_manager_clients",
  "edit_manager_clients",
] as const;

type FetchLike = typeof fetch;

export interface VkAdsOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface VkAdsOAuthOptions {
  credentials: VkAdsOAuthCredentials | undefined;
  redirectUri: string;
  profileName: string;
  secretStore: SecretStore;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}

export interface VkAdsOAuthStatus {
  configured: boolean;
  connected: boolean;
  authorization_pending: boolean;
  user_id?: number;
  access_token_expires_at?: string;
}

export interface VkAdsAuthorizationStart {
  authorization_url: string;
  redirect_uri: string;
  expires_at: string;
  scopes: readonly string[];
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

interface PendingAuthorization {
  state: string;
  server: Server;
  timeout: NodeJS.Timeout;
}

function randomState(): string {
  return randomBytes(32).toString("base64url");
}

function sameState(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function tokenResponse(payload: unknown): TokenResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("VK Ads вернул ответ авторизации неизвестного формата.");
  const value = payload as Record<string, unknown>;
  if (typeof value.access_token !== "string" || !value.access_token || typeof value.refresh_token !== "string" || !value.refresh_token || !Number.isInteger(value.expires_in) || Number(value.expires_in) <= 0) {
    throw new Error("VK Ads не вернул access_token, refresh_token и expires_in.");
  }
  return { access_token: value.access_token, refresh_token: value.refresh_token, expires_in: Number(value.expires_in) };
}

/** Строит фиксированную страницу согласия VK Ads; API-host и scope нельзя подменить входными данными MCP. */
export function buildVkAdsAuthorizationUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL(VK_ADS_AUTHORIZATION_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", VK_ADS_OAUTH_SCOPES.join(","));
  url.searchParams.set("redirect_uri", redirectUri);
  return url.toString();
}

export function adsOAuthSecretKey(profileName: string, name: "refresh_token" | "access_token_expires_at" | "user_id"): string {
  return `vk-ads-oauth:${profileName}:${name}`;
}

export class VkAdsOAuth {
  private pending: PendingAuthorization | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly callback: URL;

  public constructor(private readonly options: VkAdsOAuthOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.callback = new URL(options.redirectUri);
  }

  public status(): VkAdsOAuthStatus {
    const accessToken = this.options.secretStore.get(credentialAccount(this.options.profileName, "token"));
    const expiresAt = Number(this.options.secretStore.get(adsOAuthSecretKey(this.options.profileName, "access_token_expires_at")) ?? "0");
    const userId = Number(this.options.secretStore.get(adsOAuthSecretKey(this.options.profileName, "user_id")) ?? "");
    return {
      configured: Boolean(this.options.credentials),
      connected: Boolean(accessToken && Number.isFinite(expiresAt)),
      authorization_pending: Boolean(this.pending),
      ...(Number.isInteger(userId) && userId > 0 ? { user_id: userId } : {}),
      ...(Number.isFinite(expiresAt) && expiresAt > 0 ? { access_token_expires_at: new Date(expiresAt).toISOString() } : {}),
    };
  }

  public async beginAuthorization(): Promise<VkAdsAuthorizationStart> {
    const credentials = this.requireCredentials();
    if (this.pending) throw new Error("Подключение VK Ads уже ожидает подтверждения в браузере.");
    const state = randomState();
    const callback = this.callback;
    const server = createHttpServer((request, response) => {
      void this.handleCallback(request.url ?? "/", response, state);
    });
    const timeout = setTimeout(() => this.closePending(), AUTH_TIMEOUT_MS);
    timeout.unref();
    this.pending = { state, server, timeout };
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
        const onListening = () => { server.off("error", onError); resolve(); };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(Number(callback.port), callback.hostname === "[::1]" ? "::1" : callback.hostname);
      });
    } catch (error) {
      this.closePending();
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code === "EADDRINUSE") throw new Error(`Локальный OAuth callback порт ${callback.port} уже занят. Освободите его, затем повторите подключение VK Ads.`);
      throw error;
    }
    const expiresAt = new Date(Date.now() + AUTH_TIMEOUT_MS).toISOString();
    return {
      authorization_url: buildVkAdsAuthorizationUrl(credentials.clientId, callback.toString(), state),
      redirect_uri: callback.toString(),
      expires_at: expiresAt,
      scopes: VK_ADS_OAUTH_SCOPES,
    };
  }

  public async refreshAccessToken(): Promise<string> {
    const refreshToken = this.options.secretStore.get(adsOAuthSecretKey(this.options.profileName, "refresh_token"));
    if (!refreshToken) throw new Error("Нет refresh_token VK Ads OAuth. Сначала выполните vk_ads_oauth_begin и подтвердите доступ.");
    const credentials = this.requireCredentials();
    const payload = await this.exchange({ grant_type: "refresh_token", refresh_token: refreshToken, client_id: credentials.clientId, client_secret: credentials.clientSecret });
    this.saveToken(payload);
    return payload.access_token;
  }

  public cancelAuthorization(): boolean {
    if (!this.pending) return false;
    this.closePending();
    return true;
  }

  private async handleCallback(rawUrl: string, response: import("node:http").ServerResponse, expectedState: string): Promise<void> {
    const url = new URL(rawUrl, this.callback);
    if (url.pathname !== this.callback.pathname) return this.callbackPage(response, 404, "Страница не найдена.");
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const userId = url.searchParams.get("user_id");
    if (!state || !sameState(expectedState, state) || !code) {
      return this.callbackPage(response, 400, "Подтверждение не прошло. Вернитесь в Codex и начните подключение заново.");
    }
    try {
      const payload = await this.exchange({ grant_type: "authorization_code", code, client_id: this.requireCredentials().clientId });
      this.saveToken(payload, userId);
      this.callbackPage(response, 200, "VK Ads подключён. Можно вернуться в Codex.");
    } catch {
      this.callbackPage(response, 400, "VK Ads не подтвердил подключение. Вернитесь в Codex и начните его заново.");
    } finally {
      this.closePending();
    }
  }

  private async exchange(params: Record<string, string>): Promise<TokenResponse> {
    const response = await this.fetchImpl(`${VK_ADS_API_BASE_URL}/oauth2/token.json`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(this.options.timeoutMs),
      redirect: "error",
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const code = payload && typeof payload === "object" && "error" in payload ? String((payload as { error?: unknown }).error) : `HTTP ${response.status}`;
      throw new Error(`VK Ads отклонил подключение: ${code}.`);
    }
    return tokenResponse(payload);
  }

  private saveToken(payload: TokenResponse, rawUserId?: string | null): void {
    this.options.secretStore.set(credentialAccount(this.options.profileName, "token"), payload.access_token);
    this.options.secretStore.set(adsOAuthSecretKey(this.options.profileName, "refresh_token"), payload.refresh_token);
    this.options.secretStore.set(adsOAuthSecretKey(this.options.profileName, "access_token_expires_at"), String(Date.now() + payload.expires_in * 1_000));
    const userId = Number(rawUserId ?? "");
    if (Number.isInteger(userId) && userId > 0) this.options.secretStore.set(adsOAuthSecretKey(this.options.profileName, "user_id"), String(userId));
  }

  private callbackPage(response: import("node:http").ServerResponse, status: number, message: string): void {
    response.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(`<!doctype html><meta charset="utf-8"><title>VK Ads MCP</title><p>${message}</p>`);
  }

  private requireCredentials(): VkAdsOAuthCredentials {
    if (!this.options.credentials) throw new Error("VK Ads client_id и client_secret не настроены для OAuth-подключения.");
    return this.options.credentials;
  }

  private closePending(): void {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending) return;
    clearTimeout(pending.timeout);
    pending.server.close();
  }
}
