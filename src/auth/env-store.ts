import {
  chmod,
  lstat,
  open,
  readFile,
  rename,
  stat,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { VkAdsAuthConfigError } from "./errors.js";

const CLIENT_ID_KEY = "VK_ADS_CLIENT_ID";
const CLIENT_SECRET_KEY = "VK_ADS_CLIENT_SECRET";
const ACCESS_TOKEN_KEY = "VK_ADS_TOKEN";
const REFRESH_TOKEN_KEY = "VK_ADS_REFRESH_TOKEN";
const EXPIRES_AT_KEY = "VK_ADS_TOKEN_EXPIRES_AT";

const REQUIRED_KEYS = [CLIENT_ID_KEY, CLIENT_SECRET_KEY] as const;
const MANAGED_TOKEN_KEYS = [
  ACCESS_TOKEN_KEY,
  REFRESH_TOKEN_KEY,
  EXPIRES_AT_KEY,
] as const;

const LOCK_RETRY_MS = 50;
const LOCK_TIMEOUT_MS = 10_000;
const STALE_LOCK_MS = 30_000;

export const DEFAULT_AUTH_ENV_PATH = fileURLToPath(
  new URL("../../auth.env", import.meta.url),
);

export interface StoredVkAdsCredentials {
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

export interface PersistedTokenSet {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface VkAdsCredentialStore {
  load(): Promise<StoredVkAdsCredentials>;
  saveTokens(tokens: PersistedTokenSet): Promise<void>;
  clearTokens(): Promise<void>;
  withRefreshLock<T>(operation: () => Promise<T>): Promise<T>;
}

function decodeEnvValue(rawValue: string): string {
  const value = rawValue.trim();

  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const decoded: unknown = JSON.parse(value);

      if (typeof decoded === "string") {
        return decoded;
      }
    } catch {
      throw new VkAdsAuthConfigError(
        "auth.env contains an invalid quoted value.",
      );
    }
  }

  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1);
  }

  return value;
}

function encodeEnvValue(value: string): string {
  if (/[\r\n]/u.test(value)) {
    throw new VkAdsAuthConfigError(
      "A token value contains a forbidden line break.",
    );
  }

  return /^[A-Za-z0-9._~+/=-]+$/u.test(value)
    ? value
    : JSON.stringify(value);
}

function parseEnv(text: string): Map<string, string> {
  const values = new Map<string, string>();

  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex < 1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key)) {
      continue;
    }

    if (values.has(key)) {
      throw new VkAdsAuthConfigError(
        `auth.env contains duplicate variable ${key}.`,
      );
    }

    values.set(key, decodeEnvValue(line.slice(separatorIndex + 1)));
  }

  return values;
}

function requireNonEmpty(values: Map<string, string>, key: string): string {
  const value = values.get(key);

  if (value === undefined || value === "") {
    throw new VkAdsAuthConfigError(
      `Required auth.env variable ${key} is missing.`,
    );
  }

  return value;
}

function optionalNonEmpty(
  values: Map<string, string>,
  key: string,
): string | undefined {
  const value = values.get(key);
  return value === undefined || value === "" ? undefined : value;
}

export function parseExpiresAt(value: string | undefined): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }

  if (/^\d+$/u.test(value)) {
    const numeric = Number(value);

    if (!Number.isSafeInteger(numeric) || numeric <= 0) {
      throw new VkAdsAuthConfigError(
        `${EXPIRES_AT_KEY} contains an invalid timestamp.`,
      );
    }

    return numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  }

  const parsed = Date.parse(value);

  if (Number.isNaN(parsed)) {
    throw new VkAdsAuthConfigError(
      `${EXPIRES_AT_KEY} must be an ISO date or Unix timestamp.`,
    );
  }

  return parsed;
}

function updateEnvText(
  text: string,
  updates: ReadonlyMap<string, string>,
): string {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/u);
  const updatedKeys = new Set<string>();

  const updatedLines = lines.map((line) => {
    const separatorIndex = line.indexOf("=");

    if (separatorIndex < 1) {
      return line;
    }

    const key = line.slice(0, separatorIndex).trim();
    const nextValue = updates.get(key);

    if (nextValue === undefined) {
      return line;
    }

    if (updatedKeys.has(key)) {
      throw new VkAdsAuthConfigError(
        `auth.env contains duplicate variable ${key}.`,
      );
    }

    updatedKeys.add(key);
    return `${key}=${encodeEnvValue(nextValue)}`;
  });

  if (updatedLines.at(-1) === "") {
    updatedLines.pop();
  }

  for (const [key, value] of updates) {
    if (!updatedKeys.has(key)) {
      updatedLines.push(`${key}=${encodeEnvValue(value)}`);
    }
  }

  return `${updatedLines.join(newline)}${newline}`;
}

async function ignoreMissingUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

export class EnvFileVkAdsCredentialStore implements VkAdsCredentialStore {
  readonly lockPath: string;

  constructor(readonly path: string = DEFAULT_AUTH_ENV_PATH) {
    this.lockPath = `${path}.lock`;
  }

  async load(): Promise<StoredVkAdsCredentials> {
    const fileInfo = await lstat(this.path);

    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
      throw new VkAdsAuthConfigError(
        "auth.env must be a regular file, not a symbolic link.",
      );
    }

    const values = parseEnv(await readFile(this.path, "utf8"));
    const credentials: StoredVkAdsCredentials = {
      clientId: requireNonEmpty(values, CLIENT_ID_KEY),
      clientSecret: requireNonEmpty(values, CLIENT_SECRET_KEY),
    };
    const accessToken = optionalNonEmpty(values, ACCESS_TOKEN_KEY);
    const refreshToken = optionalNonEmpty(values, REFRESH_TOKEN_KEY);
    const expiresAt = parseExpiresAt(
      optionalNonEmpty(values, EXPIRES_AT_KEY),
    );

    if (accessToken !== undefined) {
      credentials.accessToken = accessToken;
    }

    if (refreshToken !== undefined) {
      credentials.refreshToken = refreshToken;
    }

    if (expiresAt !== undefined) {
      credentials.expiresAt = expiresAt;
    }

    return credentials;
  }

  async saveTokens(tokens: PersistedTokenSet): Promise<void> {
    await this.writeManagedValues(
      new Map<string, string>([
        [ACCESS_TOKEN_KEY, tokens.accessToken],
        [REFRESH_TOKEN_KEY, tokens.refreshToken],
        [EXPIRES_AT_KEY, new Date(tokens.expiresAt).toISOString()],
      ]),
    );
  }

  async clearTokens(): Promise<void> {
    await this.writeManagedValues(
      new Map<string, string>([
        [ACCESS_TOKEN_KEY, ""],
        [REFRESH_TOKEN_KEY, ""],
        [EXPIRES_AT_KEY, ""],
      ]),
    );
  }

  private async writeManagedValues(
    updates: ReadonlyMap<string, string>,
  ): Promise<void> {
    const fileInfo = await lstat(this.path);

    if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
      throw new VkAdsAuthConfigError(
        "auth.env must be a regular file, not a symbolic link.",
      );
    }

    const currentText = await readFile(this.path, "utf8");
    const nextText = updateEnvText(currentText, updates);
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    const mode = fileInfo.mode & 0o777;
    const temporaryFile = await open(temporaryPath, "wx", mode);

    try {
      await temporaryFile.writeFile(nextText, "utf8");
      await temporaryFile.sync();
    } finally {
      await temporaryFile.close();
    }

    try {
      await rename(temporaryPath, this.path);
      await chmod(this.path, mode);
    } catch (error) {
      await ignoreMissingUnlink(temporaryPath);
      throw error;
    }
  }

  async withRefreshLock<T>(operation: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();

    while (true) {
      try {
        const lockFile = await open(this.lockPath, "wx", 0o600);

        try {
          await lockFile.writeFile(
            `${JSON.stringify({
              pid: process.pid,
              createdAt: new Date().toISOString(),
            })}\n`,
            "utf8",
          );

          return await operation();
        } finally {
          await lockFile.close();
          await ignoreMissingUnlink(this.lockPath);
        }
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "EEXIST"
        ) {
          throw error;
        }

        try {
          const lockInfo = await stat(this.lockPath);

          if (Date.now() - lockInfo.mtimeMs > STALE_LOCK_MS) {
            await ignoreMissingUnlink(this.lockPath);
            continue;
          }
        } catch (statError) {
          if (
            statError instanceof Error &&
            "code" in statError &&
            statError.code === "ENOENT"
          ) {
            continue;
          }

          throw statError;
        }

        if (Date.now() - startedAt >= LOCK_TIMEOUT_MS) {
          throw new VkAdsAuthConfigError(
            "Timed out waiting for the auth.env refresh lock.",
          );
        }

        await wait(LOCK_RETRY_MS);
      }
    }
  }
}

export const AUTH_ENV_REQUIRED_KEYS = REQUIRED_KEYS;
export const AUTH_ENV_MANAGED_TOKEN_KEYS = MANAGED_TOKEN_KEYS;
