import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer as createHttpServer, type Server } from "node:http";

import type { SecretStore } from "./secret-store.js";

const VK_ID_AUTHORIZATION_URL = "https://id.vk.ru/authorize" as const;
const VK_ID_TOKEN_URL = "https://id.vk.ru/oauth2/auth" as const;
const VK_CORE_API_BASE_URL = "https://api.vk.com/method" as const;
const VK_CORE_API_VERSION = "5.199" as const;
const VK_CORE_REDIRECT_URI = "http://localhost" as const;
export const VK_CORE_LOOPBACK_HOST = "127.0.0.1" as const;
export const VK_CORE_LOOPBACK_PORT = 39_873;
const VK_CORE_SCOPE = ["groups", "stats"] as const;
const AUTH_TIMEOUT_MS = 10 * 60_000;

type FetchLike = typeof fetch;

export interface CoreVkAuthStatus {
  configured: boolean;
  connected: boolean;
  authorization_pending: boolean;
  user_id?: number;
  access_token_expires_at?: string;
}

export interface CoreVkAuthOptions {
  clientId: string | undefined;
  profileName: string;
  secretStore: SecretStore;
  timeoutMs: number;
  fetchImpl?: FetchLike;
}

export interface CoreVkAuthorizationStart {
  authorization_url: string;
  redirect_uri: typeof VK_CORE_REDIRECT_URI;
  expires_at: string;
}

interface CoreVkTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id?: number;
}

interface PendingAuthorization {
  state: string;
  codeVerifier: string;
  expiresAt: number;
  server: Server;
  timeout: NodeJS.Timeout;
}

function base64UrlSha256(value: string): string {
  return createHash("sha256").update(value, "ascii").digest("base64url");
}

function randomPkceVerifier(): string {
  return randomBytes(64).toString("base64url");
}

function randomState(): string {
  return randomBytes(32).toString("base64url");
}

function sameState(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected, "utf8");
  const actualBytes = Buffer.from(actual, "utf8");
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

function tokenValue(payload: unknown): CoreVkTokenResponse {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("VK ID вернул ответ неизвестного формата.");
  const value = payload as Record<string, unknown>;
  if (typeof value.access_token !== "string" || !value.access_token || typeof value.refresh_token !== "string" || !value.refresh_token || !Number.isInteger(value.expires_in) || Number(value.expires_in) <= 0) {
    throw new Error("VK ID не вернул пару access_token и refresh_token.");
  }
  return {
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    expires_in: Number(value.expires_in),
    ...(typeof value.user_id === "number" && Number.isInteger(value.user_id) ? { user_id: value.user_id } : {}),
  };
}

export function buildCoreVkAuthorizationUrl(clientId: string, state: string, codeVerifier: string): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: VK_CORE_REDIRECT_URI,
    scope: VK_CORE_SCOPE.join(" "),
    state,
    code_challenge: base64UrlSha256(codeVerifier),
    code_challenge_method: "S256",
  });
  return `${VK_ID_AUTHORIZATION_URL}?${query.toString()}`;
}

export class CoreVkAuth {
  private pending: PendingAuthorization | undefined;
  private readonly fetchImpl: FetchLike;

  public constructor(private readonly options: CoreVkAuthOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  public status(): CoreVkAuthStatus {
    const accessToken = this.options.secretStore.get(this.key("access_token"));
    const expiresAt = Number(this.options.secretStore.get(this.key("access_token_expires_at")) ?? "0");
    const userId = Number(this.options.secretStore.get(this.key("user_id")) ?? "");
    return {
      configured: Boolean(this.options.clientId),
      connected: Boolean(accessToken && Number.isFinite(expiresAt)),
      authorization_pending: Boolean(this.pending),
      ...(Number.isInteger(userId) && userId > 0 ? { user_id: userId } : {}),
      ...(Number.isFinite(expiresAt) && expiresAt > 0 ? { access_token_expires_at: new Date(expiresAt).toISOString() } : {}),
    };
  }

  public async beginAuthorization(): Promise<CoreVkAuthorizationStart> {
    const clientId = this.requireClientId();
    if (this.pending) throw new Error("Авторизация Core VK уже ожидает подтверждения в браузере.");
    const state = randomState();
    const codeVerifier = randomPkceVerifier();
    const expiresAt = Date.now() + AUTH_TIMEOUT_MS;
    const server = createHttpServer((request, response) => {
      void this.handleCallback(request.url ?? "/", response, state, codeVerifier);
    });
    const timeout = setTimeout(() => this.closePending(), AUTH_TIMEOUT_MS);
    timeout.unref();
    this.pending = { state, codeVerifier, expiresAt, server, timeout };
    try {
      await new Promise<void>((resolve, reject) => {
        const onError = (error: Error) => { server.off("listening", onListening); reject(error); };
        const onListening = () => { server.off("error", onError); resolve(); };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(VK_CORE_LOOPBACK_PORT, VK_CORE_LOOPBACK_HOST);
      });
    } catch (error) {
      this.closePending();
      const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
      if (code === "EADDRINUSE") throw new Error(`Локальный OAuth callback порт ${VK_CORE_LOOPBACK_PORT} уже занят. Освободите его, затем повторите подключение Core VK.`);
      throw error;
    }
    return { authorization_url: buildCoreVkAuthorizationUrl(clientId, state, codeVerifier), redirect_uri: VK_CORE_REDIRECT_URI, expires_at: new Date(expiresAt).toISOString() };
  }

  public async accessToken(): Promise<string> {
    const accessToken = this.options.secretStore.get(this.key("access_token"));
    const expiresAt = Number(this.options.secretStore.get(this.key("access_token_expires_at")) ?? "0");
    if (accessToken && Number.isFinite(expiresAt) && expiresAt > Date.now() + 60_000) return accessToken;
    const refreshToken = this.options.secretStore.get(this.key("refresh_token"));
    const deviceId = this.options.secretStore.get(this.key("device_id"));
    if (!refreshToken || !deviceId) throw new Error("Core VK не подключён. Сначала выполните vk_core_oauth_begin и подтвердите доступ в браузере.");
    const payload = await this.exchange({ grant_type: "refresh_token", refresh_token: refreshToken, device_id: deviceId, state: randomState() });
    this.saveToken(payload, deviceId);
    return payload.access_token;
  }

  public cancelAuthorization(): boolean {
    if (!this.pending) return false;
    this.closePending();
    return true;
  }

  private async handleCallback(rawUrl: string, response: import("node:http").ServerResponse, expectedState: string, codeVerifier: string): Promise<void> {
    const url = new URL(rawUrl, VK_CORE_REDIRECT_URI);
    if (url.pathname !== "/") return this.callbackPage(response, 404, "Страница не найдена.");
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const deviceId = url.searchParams.get("device_id");
    if (!state || !sameState(expectedState, state) || !code || !deviceId) {
      return this.callbackPage(response, 400, "Подтверждение не прошло. Вернитесь в Codex и начните подключение заново.");
    }
    try {
      const payload = await this.exchange({ grant_type: "authorization_code", code, code_verifier: codeVerifier, redirect_uri: VK_CORE_REDIRECT_URI, device_id: deviceId });
      this.saveToken(payload, deviceId);
      this.callbackPage(response, 200, "VK подключён. Можно вернуться в Codex.");
    } catch {
      this.callbackPage(response, 400, "VK не подтвердил подключение. Вернитесь в Codex и начните его заново.");
    } finally {
      this.closePending();
    }
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

  private async exchange(params: Record<string, string>): Promise<CoreVkTokenResponse> {
    const body = new URLSearchParams({ ...params, client_id: this.requireClientId(), scope: VK_CORE_SCOPE.join(" ") });
    const response = await this.fetchImpl(VK_ID_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(this.options.timeoutMs),
      redirect: "error",
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const errorCode = payload && typeof payload === "object" && "error" in payload ? String((payload as { error?: unknown }).error) : `HTTP ${response.status}`;
      throw new Error(`VK ID отклонил авторизацию: ${errorCode}.`);
    }
    return tokenValue(payload);
  }

  private saveToken(payload: CoreVkTokenResponse, deviceId: string): void {
    const expiresAt = Date.now() + payload.expires_in * 1_000;
    this.options.secretStore.set(this.key("access_token"), payload.access_token);
    this.options.secretStore.set(this.key("refresh_token"), payload.refresh_token);
    this.options.secretStore.set(this.key("access_token_expires_at"), String(expiresAt));
    this.options.secretStore.set(this.key("device_id"), deviceId);
    if (payload.user_id) this.options.secretStore.set(this.key("user_id"), String(payload.user_id));
  }

  private key(name: string): string {
    return `core-vk:${this.options.profileName}:${name}`;
  }

  private requireClientId(): string {
    if (!this.options.clientId) throw new Error("Core VK client_id не задан. Добавьте VK_CORE_VK_CLIENT_ID в конфигурацию запуска.");
    return this.options.clientId;
  }

  private closePending(): void {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending) return;
    clearTimeout(pending.timeout);
    pending.server.close();
  }
}

export class CoreVkClient {
  public constructor(
    private readonly auth: CoreVkAuth,
    private readonly timeoutMs: number,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  public async getCommunityStats(input: { groupId: number; dateFrom?: string; dateTo?: string; interval: "day" | "week" | "month" | "all"; statsGroups?: Array<"visitors" | "reach" | "activity"> }): Promise<unknown> {
    return this.call("stats.get", {
      group_id: String(input.groupId),
      interval: input.interval,
      ...(input.dateFrom ? { date_from: input.dateFrom } : {}),
      ...(input.dateTo ? { date_to: input.dateTo } : {}),
      ...(input.statsGroups?.length ? { stats_groups: input.statsGroups.join(",") } : {}),
    });
  }

  public async listManagedGroups(input: { offset: number; count: number; filter: "admin" | "editor" | "moder" }): Promise<{ count: number; items: Array<Record<string, unknown>> }> {
    const response = await this.call("groups.get", { offset: String(input.offset), count: String(input.count), filter: input.filter, extended: "1" });
    if (!response || typeof response !== "object" || Array.isArray(response)) throw new Error("VK API вернул неизвестный формат списка сообществ.");
    const value = response as { count?: unknown; items?: unknown };
    const items = Array.isArray(value.items) ? value.items : [];
    return {
      count: typeof value.count === "number" && Number.isFinite(value.count) ? value.count : items.length,
      items: items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item))).map(publicGroup),
    };
  }

  private async call(method: "stats.get" | "groups.get", parameters: Record<string, string>): Promise<unknown> {
    const token = await this.auth.accessToken();
    const query = new URLSearchParams({ ...parameters, access_token: token, v: VK_CORE_API_VERSION });
    const response = await this.fetchImpl(`${VK_CORE_API_BASE_URL}/${method}?${query.toString()}`, { method: "GET", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(this.timeoutMs), redirect: "error" });
    const payload: unknown = await response.json().catch(() => undefined);
    if (!response.ok) throw new Error(`Core VK API недоступен: HTTP ${response.status}.`);
    if (!payload || typeof payload !== "object") throw new Error("Core VK API вернул неизвестный формат ответа.");
    const value = payload as { response?: unknown; error?: { error_code?: unknown; error_msg?: unknown } };
    if (value.error) throw new Error(`Core VK API отклонил запрос: ${String(value.error.error_code ?? "unknown_error")}.`);
    return value.response;
  }
}

function publicGroup(item: Record<string, unknown>): Record<string, unknown> {
  const allowed = ["id", "name", "screen_name", "type", "is_closed", "is_admin", "admin_level", "can_post", "can_upload_story", "members_count", "activity"];
  return Object.fromEntries(allowed.flatMap((key) => Object.hasOwn(item, key) ? [[key, item[key]]] : []));
}
