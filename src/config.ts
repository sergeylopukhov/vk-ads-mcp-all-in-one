import { resolve } from "node:path";

import { createSecretStore, type SecretStore } from "./secret-store.js";
import type { VkAdsOAuthCredentials } from "./vk-ads-oauth.js";

export const VK_ADS_API_BASE_URL = "https://ads.vk.com/api/v2" as const;
export const VK_ADS_DEFAULT_OAUTH_REDIRECT_URI = "http://127.0.0.1:39874/" as const;

export type ServerMode = "readonly" | "write";

export interface AppConfig {
  mode: ServerMode;
  /** Имя профиля определяет Keychain accounts при старте; из MCP его менять нельзя. */
  profileName: string;
  /** Метка локального подключения; credential намеренно не выбирается произвольным ID из запроса MCP. */
  connectionId: string;
  secretStore: SecretStore;
  /** Публичный идентификатор отдельного VK ID Web-приложения для Core VK API. */
  coreVkClientId?: string;
  /** Credential приложения VK Ads; никогда не передаётся в MCP-ответы. */
  adsOAuthCredentials?: VkAdsOAuthCredentials;
  /** Фиксированный локальный callback, зарегистрированный для OAuth-клиента VK Ads. */
  adsOAuthRedirectUri: string;
  tokenProvider: () => string;
  tokenRefresher?: () => Promise<string>;
  timeoutMs: number;
  uploadDir?: string;
  /** Отдельный opt-in каталог для PII списков ремаркетинга. */
  piiUploadDir?: string;
  allowPiiUploads: boolean;
  /** Агентский write меняет отношения между кабинетами, поэтому opt-in отдельный. */
  allowAgencyWrites: boolean;
  /** Отзыв ключа может остановить кампании получателя; включается только отдельно. */
  allowSharingKeyRevoke: boolean;
  /** SKAdNetwork меняет права мобильного приложения и требует отдельного opt-in. */
  allowSkAdNetworkWrites: boolean;
  /** Единственные iOS-приложения, на которых допустимы тестовые SKAdNetwork-вызовы. */
  skAdNetworkTestAppIds: number[];
  /** Изменение категории in-app события может повлиять на оптимизацию, поэтому включается отдельно. */
  allowInAppEventCategoryWrites: boolean;
  /** Единственные мобильные приложения, в которых допустимо менять категорию события при тестах. */
  inAppEventTestAppIds: number[];
  /** Изменение счётчика может затронуть источник данных; включается только отдельно. */
  allowRemarketingCounterWrites: boolean;
  /** Только эти заранее подготовленные счётчики допустимы для test-write. */
  remarketingCounterTestIds: number[];
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return 30_000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 120_000) {
    throw new Error("VK_ADS_TIMEOUT_MS должен быть целым числом от 1000 до 120000.");
  }
  return parsed;
}

function parseConnectionId(value: string | undefined): string {
  const connectionId = value?.trim() || "default";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(connectionId)) {
    throw new Error("VK_ADS_CONNECTION_ID может содержать только буквы, цифры, _ и - (до 64 символов).");
  }
  return connectionId;
}

function parseProfileName(value: string | undefined): string {
  const profileName = value?.trim() || "default";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profileName)) {
    throw new Error("VK_ADS_PROFILE может содержать только буквы, цифры, _ и - (до 64 символов).");
  }
  return profileName;
}

function parseCoreVkClientId(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const clientId = value.trim();
  if (!/^\d{1,20}$/.test(clientId)) throw new Error("VK_CORE_VK_CLIENT_ID должен быть числовым ID приложения VK ID.");
  return clientId;
}

function parseAdsOAuthRedirectUri(value: string | undefined): string {
  let uri: URL;
  try {
    uri = new URL(value?.trim() || VK_ADS_DEFAULT_OAUTH_REDIRECT_URI);
  } catch {
    throw new Error("VK_ADS_OAUTH_REDIRECT_URI должен быть абсолютным URL локального callback.");
  }
  if (uri.protocol !== "http:" || uri.username || uri.password || uri.search || uri.hash || !uri.port || !["127.0.0.1", "localhost", "[::1]"].includes(uri.hostname)) {
    throw new Error("VK_ADS_OAUTH_REDIRECT_URI разрешает только http://localhost, 127.0.0.1 или ::1 с явным непривилегированным портом.");
  }
  const port = Number(uri.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error("VK_ADS_OAUTH_REDIRECT_URI должен использовать порт от 1024 до 65535.");
  }
  return uri.toString();
}

function parsePositiveIds(value: string | undefined, variableName: string): number[] {
  if (!value?.trim()) return [];
  const ids = value.split(",").map((item) => Number(item.trim()));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error(`${variableName} должен содержать положительные целые ID через запятую.`);
  }
  return [...new Set(ids)];
}

export function credentialAccount(profileName: string, key: "token" | "client_id" | "client_secret"): string {
  if (profileName === "default") return key === "token" ? "default" : key;
  return `${profileName}:${key}`;
}

export function loadConfig(environment = process.env): AppConfig {
  const mode = environment.VK_ADS_MODE === "write" ? "write" : "readonly";
  const profileName = parseProfileName(environment.VK_ADS_PROFILE);
  const secretStore = createSecretStore(environment);
  const coreVkClientId = parseCoreVkClientId(environment.VK_CORE_VK_CLIENT_ID);
  const adsOAuthRedirectUri = parseAdsOAuthRedirectUri(environment.VK_ADS_OAUTH_REDIRECT_URI);
  const environmentToken = environment.VK_ADS_TOKEN?.trim();
  const clientId = environment.VK_ADS_CLIENT_ID?.trim();
  const clientSecret = environment.VK_ADS_CLIENT_SECRET?.trim();
  const credentials: VkAdsOAuthCredentials | undefined = clientId && clientSecret
    ? { clientId, clientSecret }
    : environmentToken
      ? undefined
    : (() => {
      try {
        const storedClientId = secretStore.get(credentialAccount(profileName, "client_id"));
        const storedClientSecret = secretStore.get(credentialAccount(profileName, "client_secret"));
        return storedClientId && storedClientSecret ? { clientId: storedClientId, clientSecret: storedClientSecret } : undefined;
      } catch {
        return undefined;
      }
    })();

  const tokenRefresher = credentials
    ? async (): Promise<string> => {
      const oauthRefreshToken = secretStore.get(`vk-ads-oauth:${profileName}:refresh_token`);
      const body = new URLSearchParams(oauthRefreshToken
        ? { grant_type: "refresh_token", refresh_token: oauthRefreshToken, client_id: credentials.clientId, client_secret: credentials.clientSecret }
        : { grant_type: "client_credentials", client_id: credentials.clientId, client_secret: credentials.clientSecret });
      const response = await fetch(`${VK_ADS_API_BASE_URL}/oauth2/token.json`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
        body,
        signal: AbortSignal.timeout(parseTimeout(environment.VK_ADS_TIMEOUT_MS)),
        redirect: "error",
      });
      if (!response.ok) throw new Error(`Не удалось обновить токен VK Ads: HTTP ${response.status}.`);
      const payload: unknown = await response.json();
      const accessToken = typeof payload === "object" && payload !== null && "access_token" in payload
        ? (payload as { access_token?: unknown }).access_token
        : undefined;
      if (typeof accessToken !== "string" || accessToken.length === 0) {
        throw new Error("VK Ads не вернул access_token при обновлении credential.");
      }
      secretStore.set(credentialAccount(profileName, "token"), accessToken);
      if (oauthRefreshToken && typeof payload === "object" && payload !== null && "refresh_token" in payload && typeof (payload as { refresh_token?: unknown }).refresh_token === "string") {
        secretStore.set(`vk-ads-oauth:${profileName}:refresh_token`, (payload as { refresh_token: string }).refresh_token);
      }
      if (oauthRefreshToken && typeof payload === "object" && payload !== null && "expires_in" in payload && Number.isInteger((payload as { expires_in?: unknown }).expires_in)) {
        secretStore.set(`vk-ads-oauth:${profileName}:access_token_expires_at`, String(Date.now() + Number((payload as { expires_in: number }).expires_in) * 1_000));
      }
      return accessToken;
    }
    : undefined;

  return {
    mode,
    profileName,
    connectionId: parseConnectionId(environment.VK_ADS_CONNECTION_ID ?? profileName),
    secretStore,
    ...(coreVkClientId ? { coreVkClientId } : {}),
    ...(credentials ? { adsOAuthCredentials: credentials } : {}),
    adsOAuthRedirectUri,
    timeoutMs: parseTimeout(environment.VK_ADS_TIMEOUT_MS),
    tokenProvider: environmentToken
      ? () => environmentToken
      : () => {
        const storedToken = secretStore.get(credentialAccount(profileName, "token"));
        // При наличии client credentials клиент сам запросит новый токен до первого API-вызова.
        if (storedToken) return storedToken;
        if (credentials) return "";
        throw new Error(`Токен VK Ads не найден. Задайте VK_ADS_TOKEN или настройте безопасное хранилище для профиля ${profileName}.`);
      },
    ...(tokenRefresher ? { tokenRefresher } : {}),
    ...(environment.VK_ADS_UPLOAD_DIR ? { uploadDir: resolve(environment.VK_ADS_UPLOAD_DIR) } : {}),
    ...(environment.VK_ADS_PII_UPLOAD_DIR ? { piiUploadDir: resolve(environment.VK_ADS_PII_UPLOAD_DIR) } : {}),
    allowPiiUploads: environment.VK_ADS_ALLOW_PII_UPLOADS === "1",
    allowAgencyWrites: environment.VK_ADS_ALLOW_AGENCY_WRITES === "1",
    allowSharingKeyRevoke: environment.VK_ADS_ALLOW_SHARING_KEY_REVOKE === "1",
    allowSkAdNetworkWrites: environment.VK_ADS_ALLOW_SKADNETWORK_WRITES === "1",
    skAdNetworkTestAppIds: parsePositiveIds(environment.VK_ADS_TEST_IOS_APP_IDS, "VK_ADS_TEST_IOS_APP_IDS"),
    allowInAppEventCategoryWrites: environment.VK_ADS_ALLOW_INAPP_EVENT_CATEGORY_WRITES === "1",
    inAppEventTestAppIds: parsePositiveIds(environment.VK_ADS_TEST_MOBILE_APP_IDS, "VK_ADS_TEST_MOBILE_APP_IDS"),
    allowRemarketingCounterWrites: environment.VK_ADS_ALLOW_REMARKETING_COUNTER_WRITES === "1",
    remarketingCounterTestIds: parsePositiveIds(environment.VK_ADS_TEST_COUNTER_IDS, "VK_ADS_TEST_COUNTER_IDS"),
  };
}
