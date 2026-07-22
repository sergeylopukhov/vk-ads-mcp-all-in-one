export type CommunityType = "group" | "page" | "event";

export interface VkCommunity {
  id: number;
  name: string;
  screen_name?: string;
  description?: string;
  type?: string;
  members_count?: number;
  is_verified?: number | boolean;
  is_closed?: number;
  deactivated?: string;
}

export interface VkWallPost { date?: number; text?: string; is_pinned?: number; marked_as_ads?: number }

interface Options {
  tokenProvider: () => string;
  tokenType?: "legacy" | "vk_id";
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
  waitForRequest?: () => Promise<void>;
  now?: () => number;
  cacheTtlMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Изолированный клиент Core VK API: токен VK_API_TOKEN никогда не смешивается с VK Ads token. */
export class VkCommunityClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;
  private readonly cache = new Map<number, { expiresAt: number; value: VkCommunity }>();
  private readonly cacheTtlMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: Options) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? Date.now;
    this.cacheTtlMs = options.cacheTtlMs ?? 10 * 60_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async search(query: string, offset = 0, count = 100, countryId?: number, cityId?: number, type?: CommunityType): Promise<VkCommunity[]> {
    const result = await this.call("groups.search", { q: query, offset, count, ...(countryId ? { country_id: countryId } : {}), ...(cityId ? { city_id: cityId } : {}), ...(type ? { type } : {}) });
    return asItems(result).map(asCommunity).filter((item): item is VkCommunity => item !== null);
  }

  async getByIds(ids: number[]): Promise<VkCommunity[]> {
    const unique = [...new Set(ids)].filter((id) => Number.isInteger(id) && id > 0);
    const found = new Map<number, VkCommunity>();
    const missing: number[] = [];
    for (const id of unique) {
      const cached = this.cache.get(id);
      if (cached && cached.expiresAt > this.now()) found.set(id, cached.value); else missing.push(id);
    }
    for (let index = 0; index < missing.length; index += 500) {
      const result = await this.call("groups.getById", { group_ids: missing.slice(index, index + 500).join(","), fields: "description,members_count,verified,screen_name,activity" });
      for (const raw of asItems(result)) {
        const item = asCommunity(raw);
        if (!item) continue;
        this.cache.set(item.id, { expiresAt: this.now() + this.cacheTtlMs, value: item });
        found.set(item.id, item);
      }
    }
    return unique.flatMap((id) => found.get(id) ? [found.get(id)!] : []);
  }

  async wall(id: number, count: number): Promise<VkWallPost[]> {
    const result = await this.call("wall.get", { owner_id: -id, count, filter: "owner" });
    return asItems(result).map((value) => typeof value === "object" && value !== null && !Array.isArray(value) ? value as VkWallPost : {});
  }

  private async call(method: string, params: Record<string, string | number>): Promise<unknown> {
    const token = this.options.tokenProvider().trim();
    if (!token) throw new Error("Для сообществ задайте отдельный VK_API_TOKEN в локальном .env.");
    const legacy = this.options.tokenType === "legacy";
    const url = new URL(`https://${legacy ? "api.vk.com" : "api.vk.ru"}/method/${method}`);
    const requestParams = { ...params, v: "5.199" };
    for (const [key, value] of Object.entries(requestParams)) url.searchParams.set(key, String(value));
    if (legacy) url.searchParams.set("access_token", token);
    let last: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.options.waitForRequest?.();
        const response = await this.fetchImplementation(url, {
          headers: legacy ? { Accept: "application/json" } : { Authorization: `Bearer ${token}`, Accept: "application/json" },
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
        const payload: unknown = await response.json();
        const error = payload && typeof payload === "object" && !Array.isArray(payload) ? (payload as Record<string, unknown>).error : undefined;
        if (response.ok && !error) return (payload as Record<string, unknown>).response;
        const code = error && typeof error === "object" ? Number((error as Record<string, unknown>).error_code) : undefined;
        if ((response.status === 429 || response.status >= 500 || code === 6) && attempt < 2) { await this.sleep(500 * 2 ** attempt); continue; }
        throw new Error(`VK API ${method} недоступен (${Number.isInteger(code) ? `код ${code}` : `HTTP ${response.status}`}).`);
      } catch (error) {
        last = error instanceof Error ? error : new Error("Сетевая ошибка VK API.");
        if (last.message.startsWith("VK API ")) throw last;
        if (attempt < 2) await this.sleep(500 * 2 ** attempt);
      }
    }
    throw last ?? new Error("VK API недоступен.");
  }
}

function asItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    if (Array.isArray(source.items)) return source.items as unknown[];
    if (Array.isArray(source.groups)) return source.groups as unknown[];
  }
  return [];
}

function asCommunity(value: unknown): VkCommunity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const id = Number(source.id);
  const name = typeof source.name === "string" ? source.name : "";
  return Number.isInteger(id) && id > 0 && name ? {
    id, name,
    ...(typeof source.screen_name === "string" ? { screen_name: source.screen_name } : {}),
    ...(typeof source.description === "string" ? { description: source.description } : {}),
    ...(typeof source.type === "string" ? { type: source.type } : {}),
    ...(Number.isFinite(Number(source.members_count)) ? { members_count: Number(source.members_count) } : {}),
    ...(typeof source.is_verified === "number" || typeof source.is_verified === "boolean" ? { is_verified: source.is_verified } : {}),
    ...(Number.isFinite(Number(source.is_closed)) ? { is_closed: Number(source.is_closed) } : {}),
    ...(typeof source.deactivated === "string" ? { deactivated: source.deactivated } : {}),
  } : null;
}
