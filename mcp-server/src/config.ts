import { resolve } from "node:path";

export const VK_ADS_API_BASE_URL = "https://ads.vk.com/api/v2" as const;

export type ServerMode = "readonly" | "write";

export interface VkAdsClientCredentials {
  clientId: string;
  clientSecret: string;
}

export interface AppConfig {
  mode: ServerMode;
  /** Имя локального профиля задаётся при старте; из MCP его менять нельзя. */
  profileName: string;
  /** Метка локального подключения; credential намеренно не выбирается произвольным ID из запроса MCP. */
  connectionId: string;
  tokenProvider: () => string;
  /** Только для локального сохранения нового токена в .env. */
  setAccessToken: (token: string) => void;
  /** Данные приложения не передаются в MCP-инструменты и не логируются. */
  clientCredentials?: VkAdsClientCredentials;
  timeoutMs: number;
  /** Одноразовый preview записи: от 1 до 60 минут, 10 минут по умолчанию. */
  previewTtlMs: number;
  /** Локальный opt-in владельца профиля: preview сохраняется, точная фраза необязательна. */
  requireWriteConfirmation: boolean;
  uploadDir?: string;
  /** Отдельный opt-in каталог для PII списков ремаркетинга. */
  piiUploadDir?: string;
  allowPiiUploads: boolean;
  /** Агентский write меняет отношения между кабинетами, поэтому opt-in отдельный. */
  allowAgencyWrites: boolean;
  /** Изменение профиля кабинета и его уведомлений требует отдельного opt-in. */
  allowProfileWrites: boolean;
  /** Отзыв ключа может остановить кампании получателя; включается только отдельно. */
  allowSharingKeyRevoke: boolean;
  /** Внешний ключ шаринга хранится только локально и никогда не возвращается MCP. */
  externalSharingKey?: string;
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
  /** Локальный audit write-операций содержит только IDs, статусы и хеши. */
  auditFile: string;
}

export interface ProfileStoragePaths {
  envFile: string;
  auditFile: string;
}

function parseTimeout(value: string | undefined): number {
  if (value === undefined) return 30_000;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1_000 || parsed > 120_000) {
    throw new Error("VK_ADS_TIMEOUT_MS должен быть целым числом от 1000 до 120000.");
  }
  return parsed;
}

function parsePreviewTtl(value: string | undefined): number {
  if (value === undefined) return 10 * 60 * 1_000;
  const minutes = Number(value);
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
    throw new Error("VK_ADS_PREVIEW_TTL_MINUTES должен быть целым числом от 1 до 60.");
  }
  return minutes * 60 * 1_000;
}

function parseWriteConfirmation(value: string | undefined): boolean {
  if (value === undefined || value === "1") return true;
  if (value === "0") return false;
  throw new Error("VK_ADS_REQUIRE_WRITE_CONFIRMATION должен быть 0 или 1.");
}

function parseConnectionId(value: string | undefined): string {
  const connectionId = value?.trim() || "default";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(connectionId)) {
    throw new Error("VK_ADS_CONNECTION_ID может содержать только буквы, цифры, _ и - (до 64 символов).");
  }
  return connectionId;
}

export function parseProfileName(value: string | undefined): string {
  const profileName = value?.trim() || "default";
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(profileName)) {
    throw new Error("VK_ADS_PROFILE может содержать только буквы, цифры, _ и - (до 64 символов).");
  }
  return profileName;
}

/**
 * Credential и audit одного профиля живут в отдельном локальном файле.
 * Профиль выбирается только до старта stdio-сервера, никогда MCP-вызовом.
 */
export function resolveProfileStorage(packageDirectory: string, profileName: string): ProfileStoragePaths {
  const profile = parseProfileName(profileName);
  const root = resolve(packageDirectory);
  if (profile === "default") {
    return {
      envFile: resolve(root, ".env"),
      auditFile: resolve(root, ".vk-ads-audit.json"),
    };
  }
  return {
    envFile: resolve(root, "profiles", `${profile}.env`),
    auditFile: resolve(root, "profiles", `${profile}.vk-ads-audit.json`),
  };
}

function parsePositiveIds(value: string | undefined, variableName: string): number[] {
  if (!value?.trim()) return [];
  const ids = value.split(",").map((item) => Number(item.trim()));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error(`${variableName} должен содержать положительные целые ID через запятую.`);
  }
  return [...new Set(ids)];
}

function parseExternalSharingKey(value: string | undefined): string | undefined {
  const key = value?.trim();
  if (!key) return undefined;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(key)) {
    throw new Error("VK_ADS_EXTERNAL_SHARING_KEY имеет недопустимый формат.");
  }
  return key;
}

export function loadConfig(environment = process.env): AppConfig {
  const mode = environment.VK_ADS_MODE === "write" ? "write" : "readonly";
  const profileName = parseProfileName(environment.VK_ADS_PROFILE);
  let accessToken = environment.VK_ADS_TOKEN?.trim() ?? "";
  const clientId = environment.VK_ADS_CLIENT_ID?.trim();
  const clientSecret = environment.VK_ADS_CLIENT_SECRET?.trim();
  if ((clientId && !clientSecret) || (!clientId && clientSecret)) {
    throw new Error("Укажите в .env обе переменные: VK_ADS_CLIENT_ID и VK_ADS_CLIENT_SECRET.");
  }
  const clientCredentials = clientId && clientSecret ? { clientId, clientSecret } : undefined;
  const externalSharingKey = parseExternalSharingKey(environment.VK_ADS_EXTERNAL_SHARING_KEY);
  if (!accessToken && !clientCredentials) {
    throw new Error("Создайте файл .env и заполните VK_ADS_CLIENT_ID и VK_ADS_CLIENT_SECRET. Токен сервер создаст сам.");
  }

  return {
    mode,
    profileName,
    connectionId: parseConnectionId(environment.VK_ADS_CONNECTION_ID ?? profileName),
    timeoutMs: parseTimeout(environment.VK_ADS_TIMEOUT_MS),
    previewTtlMs: parsePreviewTtl(environment.VK_ADS_PREVIEW_TTL_MINUTES),
    requireWriteConfirmation: parseWriteConfirmation(environment.VK_ADS_REQUIRE_WRITE_CONFIRMATION),
    tokenProvider: () => accessToken,
    setAccessToken: (token) => { accessToken = token; },
    ...(clientCredentials ? { clientCredentials } : {}),
    ...(environment.VK_ADS_UPLOAD_DIR ? { uploadDir: resolve(environment.VK_ADS_UPLOAD_DIR) } : {}),
    ...(environment.VK_ADS_PII_UPLOAD_DIR ? { piiUploadDir: resolve(environment.VK_ADS_PII_UPLOAD_DIR) } : {}),
    allowPiiUploads: environment.VK_ADS_ALLOW_PII_UPLOADS === "1",
    allowAgencyWrites: environment.VK_ADS_ALLOW_AGENCY_WRITES === "1",
    allowProfileWrites: environment.VK_ADS_ALLOW_PROFILE_WRITES === "1",
    allowSharingKeyRevoke: environment.VK_ADS_ALLOW_SHARING_KEY_REVOKE === "1",
    ...(externalSharingKey ? { externalSharingKey } : {}),
    allowSkAdNetworkWrites: environment.VK_ADS_ALLOW_SKADNETWORK_WRITES === "1",
    skAdNetworkTestAppIds: parsePositiveIds(environment.VK_ADS_TEST_IOS_APP_IDS, "VK_ADS_TEST_IOS_APP_IDS"),
    allowInAppEventCategoryWrites: environment.VK_ADS_ALLOW_INAPP_EVENT_CATEGORY_WRITES === "1",
    inAppEventTestAppIds: parsePositiveIds(environment.VK_ADS_TEST_MOBILE_APP_IDS, "VK_ADS_TEST_MOBILE_APP_IDS"),
    allowRemarketingCounterWrites: environment.VK_ADS_ALLOW_REMARKETING_COUNTER_WRITES === "1",
    remarketingCounterTestIds: parsePositiveIds(environment.VK_ADS_TEST_COUNTER_IDS, "VK_ADS_TEST_COUNTER_IDS"),
    auditFile: resolve(environment.VK_ADS_AUDIT_FILE ?? ".vk-ads-audit.json"),
  };
}
