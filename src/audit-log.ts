import { chmod, lstat, open } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { VkAdsApiError } from "./vk-ads/errors.js";

export const DEFAULT_AUDIT_LOG_PATH = fileURLToPath(
  new URL("../.vk-ads-audit.jsonl", import.meta.url),
);

export interface VkAdsAuditEvent {
  operation: string;
  outcome: "success" | "failed" | "verification_failed";
}

export interface VkAdsAuditSink {
  ensureReady(): Promise<void>;
  record(event: VkAdsAuditEvent): Promise<void>;
}

async function validateExistingFile(path: string): Promise<void> {
  try {
    const info = await lstat(path);

    if (!info.isFile() || info.isSymbolicLink()) {
      throw new VkAdsApiError(
        "The VK Ads audit log must be a regular file.",
        "audit_log_invalid",
      );
    }

    await chmod(path, 0o600);
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return;
    }

    throw error;
  }
}

export class JsonLinesVkAdsAuditLog implements VkAdsAuditSink {
  constructor(
    readonly path: string = DEFAULT_AUDIT_LOG_PATH,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async ensureReady(): Promise<void> {
    await validateExistingFile(this.path);
    const handle = await open(this.path, "a", 0o600);

    try {
      await handle.sync();
    } finally {
      await handle.close();
    }

    await chmod(this.path, 0o600);
  }

  async record(event: VkAdsAuditEvent): Promise<void> {
    await this.ensureReady();
    const handle = await open(this.path, "a", 0o600);
    const line = `${JSON.stringify({
      timestamp: this.now().toISOString(),
      operation: event.operation,
      outcome: event.outcome,
    })}\n`;

    try {
      await handle.writeFile(line, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}
