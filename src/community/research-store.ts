import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { Activity } from "./analysis.js";

export interface CommunityResearchRun extends Record<string, unknown> {
  run_id: string;
  created_at: string;
  expires_at: string;
}

interface StoredRuns {
  version: 2;
  items: CommunityResearchRun[];
}

/** Хранит только производные публичные данные, без токенов и текстов постов. */
export class CommunityResearchStore {
  constructor(
    private readonly filePath: string,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxRuns = 100,
  ) {}

  async save(run: CommunityResearchRun): Promise<void> {
    const current = await this.read();
    const items = [
      ...current.items.filter((item) => item.run_id !== run.run_id),
      run,
    ]
      .filter((item) => Date.parse(item.expires_at) > this.now())
      .sort(
        (left, right) =>
          Date.parse(right.created_at) - Date.parse(left.created_at),
      )
      .slice(0, this.maxRuns);
    await this.write({ version: 2, items });
  }

  async get(runId: string): Promise<CommunityResearchRun> {
    const current = await this.read();
    const active = current.items.filter(
      (item) => Date.parse(item.expires_at) > this.now(),
    );
    if (active.length !== current.items.length) {
      await this.write({ version: 2, items: active });
    }
    const found = active.find((item) => item.run_id === runId);
    if (found === undefined) {
      throw new Error(
        "Снимок исследования не найден или срок его хранения истёк.",
      );
    }
    return found;
  }

  expiresAt(): string {
    return new Date(this.now() + this.ttlMs).toISOString();
  }

  async findCachedActivities(
    ids: number[],
    analysisFingerprint: string,
  ): Promise<Map<number, Activity>> {
    const wanted = new Set(ids);
    const result = new Map<number, Activity>();
    const current = await this.read();
    for (const run of current.items) {
      if (Date.parse(run.expires_at) <= this.now()) continue;
      const candidates = [
        ...array(run.passed),
        ...array(run.review),
        ...array(run.rejected),
      ];
      for (const candidate of candidates) {
        if (result.size === wanted.size) return result;
        const id =
          typeof candidate.id === "number" ? candidate.id : undefined;
        const activity = record(candidate.activity);
        if (
          id !== undefined &&
          wanted.has(id) &&
          !result.has(id) &&
          activity.analysis_fingerprint === analysisFingerprint
        ) {
          result.set(id, activity as unknown as Activity);
        }
      }
    }
    return result;
  }

  private async read(): Promise<StoredRuns> {
    try {
      const parsed: unknown = JSON.parse(
        await readFile(this.filePath, "utf8"),
      );
      const source =
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      const items = Array.isArray(source.items)
        ? source.items.filter(isResearchRun)
        : [];
      return { version: 2, items };
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return { version: 2, items: [] };
      }
      throw new Error(
        "Не удалось прочитать локальные снимки исследований сообществ.",
      );
    }
  }

  private async write(value: StoredRuns): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value)}\n`, {
      mode: 0o600,
    });
    await rename(temporary, this.filePath);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          item !== null &&
          typeof item === "object" &&
          !Array.isArray(item),
      )
    : [];
}

function isResearchRun(value: unknown): value is CommunityResearchRun {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    typeof item.run_id === "string" &&
    typeof item.created_at === "string" &&
    typeof item.expires_at === "string"
  );
}
