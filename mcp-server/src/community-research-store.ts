import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface CommunityResearchRun extends Record<string, unknown> {
  run_id: string;
  created_at: string;
  expires_at: string;
}

interface StoredRuns {
  version: 1;
  items: CommunityResearchRun[];
}

/** Локальные снимки публичных результатов; токены, тексты постов и raw API-ответы сюда не попадают. */
export class CommunityResearchStore {
  constructor(
    private readonly filePath: string,
    private readonly ttlMs: number,
    private readonly now: () => number = Date.now,
    private readonly maxRuns = 100,
  ) {}

  async save(run: CommunityResearchRun): Promise<void> {
    const current = await this.read();
    const items = [...current.items.filter((item) => item.run_id !== run.run_id), run]
      .filter((item) => Date.parse(item.expires_at) > this.now())
      .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
      .slice(0, this.maxRuns);
    await this.write({ version: 1, items });
  }

  async get(runId: string): Promise<CommunityResearchRun> {
    const current = await this.read();
    const active = current.items.filter((item) => Date.parse(item.expires_at) > this.now());
    if (active.length !== current.items.length) await this.write({ version: 1, items: active });
    const found = active.find((item) => item.run_id === runId);
    if (!found) throw new Error("Снимок исследования не найден или срок его хранения истёк.");
    return found;
  }

  expiresAt(): string {
    return new Date(this.now() + this.ttlMs).toISOString();
  }

  private async read(): Promise<StoredRuns> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { version: 1, items: [] };
      const source = parsed as Record<string, unknown>;
      if (!Array.isArray(source.items)) return { version: 1, items: [] };
      const items = source.items.filter((item): item is CommunityResearchRun => Boolean(item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).run_id === "string" && typeof (item as Record<string, unknown>).created_at === "string" && typeof (item as Record<string, unknown>).expires_at === "string"));
      return { version: 1, items };
    } catch (error) {
      if (error && typeof error === "object" && (error as { code?: string }).code === "ENOENT") return { version: 1, items: [] };
      throw new Error("Не удалось прочитать локальные снимки исследований сообществ.");
    }
  }

  private async write(value: StoredRuns): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}
