import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface TokenRateLimiterOptions {
  credentialFingerprint?: string;
  directory?: string;
  intervalMs?: number;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
}

/**
 * Последовательная очередь VK Ads. При fingerprint синхронизирует процессы,
 * использующие один credential; имя state-файла содержит только его SHA-256.
 */
export class TokenRateLimiter {
  private nextAllowedAt = 0;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly stateFile?: string;
  private readonly lockDirectory?: string;

  constructor(options: TokenRateLimiterOptions = {}) {
    this.intervalMs = options.intervalMs ?? 1_000;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    if (options.credentialFingerprint) {
      const directory = options.directory ?? tmpdir();
      this.stateFile = join(directory, `vk-ads-rate-${options.credentialFingerprint}.json`);
      this.lockDirectory = `${this.stateFile}.lock`;
    }
  }

  async wait(): Promise<void> {
    if (!this.stateFile || !this.lockDirectory) return this.waitInProcess();
    const scheduledAt = await this.reserveGlobalSlot();
    const delay = scheduledAt - this.now();
    if (delay > 0) await this.sleep(delay);
  }

  private async waitInProcess(): Promise<void> {
    const now = this.now();
    const scheduledAt = Math.max(now, this.nextAllowedAt);
    this.nextAllowedAt = scheduledAt + this.intervalMs;
    const delay = scheduledAt - now;
    if (delay > 0) await this.sleep(delay);
  }

  private async reserveGlobalSlot(): Promise<number> {
    await this.acquireLock();
    try {
      const now = this.now();
      const stored = this.readNextAllowedAt();
      const scheduledAt = Math.max(now, stored);
      writeFileSync(this.stateFile!, JSON.stringify({ next_allowed_at: scheduledAt + this.intervalMs }), { encoding: "utf8", mode: 0o600 });
      return scheduledAt;
    } finally {
      rmSync(this.lockDirectory!, { recursive: true, force: true });
    }
  }

  private readNextAllowedAt(): number {
    try {
      const value: unknown = JSON.parse(readFileSync(this.stateFile!, "utf8"));
      if (!value || typeof value !== "object") return 0;
      const timestamp = (value as Record<string, unknown>).next_allowed_at;
      return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : 0;
    } catch {
      return 0;
    }
  }

  private async acquireLock(): Promise<void> {
    for (;;) {
      try {
        mkdirSync(this.lockDirectory!);
        return;
      } catch (error: unknown) {
        if (!isAlreadyExists(error)) throw error;
        try {
          if (this.now() - statSync(this.lockDirectory!).mtimeMs > 30_000) rmSync(this.lockDirectory!, { recursive: true, force: true });
        } catch {
          // Другой процесс уже освободил lock между stat и удалением.
        }
        await this.sleep(25);
      }
    }
  }
}

function isAlreadyExists(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}
