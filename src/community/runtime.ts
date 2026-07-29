import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  open,
  readFile,
  rename,
  unlink,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { VkCommunityTokenManager } from "./token-manager.js";
import { VkCommunityClient } from "./vk-client.js";
import { CommunityResearchStore } from "./research-store.js";

const DEFAULT_AUTH_PATH = fileURLToPath(
  new URL("../../../auth.env", import.meta.url),
);
const DEFAULT_RESEARCH_PATH = fileURLToPath(
  new URL("../../../.vk-community-research.json", import.meta.url),
);

export interface VkCommunityRuntime {
  client: VkCommunityClient;
  store: CommunityResearchStore;
  renewOnStartup: () => Promise<void>;
}

export async function createDefaultVkCommunityRuntime(): Promise<VkCommunityRuntime> {
  const authPath =
    process.env.VK_ADS_AUTH_FILE?.trim() || DEFAULT_AUTH_PATH;
  const values = await readSelected(authPath, [
    "VK_API_TOKEN",
    "VK_API_TOKEN_TYPE",
    "VK_API_CLIENT_ID",
    "VK_API_DEVICE_ID",
    "VK_API_REFRESH_TOKEN",
    "VK_API_TOKEN_EXPIRES_AT",
  ]);
  let accessToken = values.VK_API_TOKEN ?? "";
  const tokenType =
    values.VK_API_TOKEN_TYPE === "legacy" ? "legacy" : "vk_id";
  let nextAllowedAt = 0;
  const waitForRequest = async (): Promise<void> => {
    const now = Date.now();
    const scheduled = Math.max(now, nextAllowedAt);
    nextAllowedAt = scheduled + 350;
    if (scheduled > now) {
      await new Promise((resolve) =>
        setTimeout(resolve, scheduled - now),
      );
    }
  };
  const tokenManager =
    tokenType === "vk_id" &&
    values.VK_API_CLIENT_ID !== undefined &&
    values.VK_API_DEVICE_ID !== undefined &&
    values.VK_API_REFRESH_TOKEN !== undefined
      ? new VkCommunityTokenManager({
          clientId: values.VK_API_CLIENT_ID,
          deviceId: values.VK_API_DEVICE_ID,
          getAccessToken: () => accessToken,
          getRefreshToken: () => values.VK_API_REFRESH_TOKEN,
          getExpiresAt: () => values.VK_API_TOKEN_EXPIRES_AT,
          setAccessToken: (token) => {
            accessToken = token;
          },
          save: async (updates) => updateEnvFile(authPath, updates),
          timeoutMs: 30_000,
        })
      : undefined;
  return {
    client: new VkCommunityClient({
      tokenProvider: () => accessToken,
      tokenType,
      timeoutMs: 30_000,
      waitForRequest,
    }),
    store: new CommunityResearchStore(
      process.env.VK_COMMUNITY_RESEARCH_FILE?.trim() ||
        DEFAULT_RESEARCH_PATH,
      parseTtl(process.env.VK_COMMUNITY_RESEARCH_TTL_DAYS),
    ),
    renewOnStartup: async () => {
      await tokenManager?.renewOnStartup();
    },
  };
}

function parseTtl(value: string | undefined): number {
  const days = value === undefined || value === "" ? 30 : Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error(
      "VK_COMMUNITY_RESEARCH_TTL_DAYS должен быть целым числом от 1 до 365.",
    );
  }
  return days * 24 * 60 * 60 * 1_000;
}

async function readSelected(
  path: string,
  keys: readonly string[],
): Promise<Record<string, string | undefined>> {
  const result: Record<string, string | undefined> = {};
  for (const key of keys) result[key] = process.env[key]?.trim() || undefined;
  try {
    const source = await readFile(path, "utf8");
    for (const line of source.split(/\r?\n/u)) {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
      if (
        match?.[1] !== undefined &&
        keys.includes(match[1]) &&
        result[match[1]] === undefined
      ) {
        result[match[1]] = decodeValue(match[2] ?? "");
      }
    }
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }
  return result;
}

function decodeValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const decoded: unknown = JSON.parse(trimmed);
    if (typeof decoded === "string") return decoded;
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function updateEnvFile(
  path: string,
  updates: Record<string, string>,
): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error("auth.env должен быть обычным локальным файлом.");
  }
  const source = await readFile(path, "utf8");
  const pending = new Map(Object.entries(updates));
  const lines = source.split(/\r?\n/u).map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=.*/u.exec(line);
    const key = match?.[1];
    if (key === undefined || !pending.has(key)) return line;
    const value = pending.get(key)!;
    pending.delete(key);
    return `${key}=${encodeValue(value)}`;
  });
  if (lines.at(-1) === "") lines.pop();
  for (const [key, value] of pending) {
    lines.push(`${key}=${encodeValue(value)}`);
  }
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", info.mode & 0o777);
  try {
    await file.writeFile(`${lines.join("\n")}\n`, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
    await chmod(path, info.mode & 0o777);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

function encodeValue(value: string): string {
  if (/[\r\n]/u.test(value)) {
    throw new Error("Токен содержит недопустимый перенос строки.");
  }
  return /^[A-Za-z0-9._~+/=-]+$/u.test(value)
    ? value
    : JSON.stringify(value);
}
