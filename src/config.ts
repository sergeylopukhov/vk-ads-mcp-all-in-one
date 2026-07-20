import { resolve } from "node:path";

import { createSecretStore, type SecretStore } from "./secret-store.js";

export const VK_ADS_API_BASE_URL = "https://ads.vk.com/api/v2" as const;

export type ServerMode = "readonly" | "write";

export interface AppConfig {
  mode: ServerMode;
  /** Имя профиля определяет Keychain accounts при старте; из MCP его менять нельзя. */
  profileName: string;
  /** Метка локального подключения; credential намеренно не выбирается произвольным ID из запроса MCP. */
  connectionId: string;
  secretStore: SecretStore;
  tokenProvider: () => string;
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

function parsePositiveIds(value: string | undefined, variableName: string): number[] {
  if (!value?.trim()) return [];
  const ids = value.split(",").map((item) => Number(item.trim()));
  if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw new Error(`${variableName} должен содержать положительные целые ID через запятую.`);
  }
  return [...new Set(ids)];
}

export function credentialAccount(profileName: string): string {
  return profileName === "default" ? "default" : `${profileName}:token`;
}

export function loadConfig(environment = process.env): AppConfig {
  const mode = environment.VK_ADS_MODE === "write" ? "write" : "readonly";
  const profileName = parseProfileName(environment.VK_ADS_PROFILE);
  const secretStore = createSecretStore(environment);
  const environmentToken = environment.VK_ADS_TOKEN?.trim();

  return {
    mode,
    profileName,
    connectionId: parseConnectionId(environment.VK_ADS_CONNECTION_ID ?? profileName),
    secretStore,
    timeoutMs: parseTimeout(environment.VK_ADS_TIMEOUT_MS),
    tokenProvider: environmentToken
      ? () => environmentToken
      : () => {
        const storedToken = secretStore.get(credentialAccount(profileName));
        if (storedToken) return storedToken;
        throw new Error(`Токен VK Ads не найден. Задайте VK_ADS_TOKEN или настройте безопасное хранилище для профиля ${profileName}.`);
      },
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
