export type CommunityType = "group" | "page" | "event";
export type CommunitySearchSort = "relevance" | "members";

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

export interface VkWallPost {
  date?: number;
  text?: string;
  is_pinned?: number;
  marked_as_ads?: number;
}

export interface VkCommunityPage {
  count: number;
  offset: number;
  items: VkCommunity[];
}

export interface VkCommunityClientOptions {
  tokenProvider: () => string;
  tokenType?: "legacy" | "vk_id";
  timeoutMs: number;
  fetchImplementation?: typeof fetch;
  waitForRequest?: () => Promise<void>;
  refreshAfterAuthenticationFailure?: () => Promise<string>;
  now?: () => number;
  cacheTtlMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
}

/** Изолированный клиент Core VK API: его токен не смешивается с VK Ads. */
export class VkCommunityClient {
  private readonly fetchImplementation: typeof fetch;
  private readonly now: () => number;
  private readonly cache = new Map<
    number,
    { expiresAt: number; value: VkCommunity }
  >();
  private readonly cacheTtlMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: VkCommunityClientOptions) {
    this.fetchImplementation = options.fetchImplementation ?? fetch;
    this.now = options.now ?? Date.now;
    this.cacheTtlMs = options.cacheTtlMs ?? 10 * 60_000;
    this.sleep =
      options.sleep ??
      (async (milliseconds) => {
        await new Promise((resolve) => setTimeout(resolve, milliseconds));
      });
  }

  async searchPage(
    query: string,
    offset = 0,
    count = 100,
    countryId?: number,
    cityId?: number,
    type?: CommunityType,
    sort: CommunitySearchSort = "relevance",
  ): Promise<VkCommunityPage> {
    const result = await this.call("groups.search", {
      q: query,
      offset,
      count,
      sort: sort === "members" ? 1 : 0,
      ...(countryId === undefined ? {} : { country_id: countryId }),
      ...(cityId === undefined ? {} : { city_id: cityId }),
      ...(type === undefined ? {} : { type }),
    });
    const items = asItems(result)
      .map(asCommunity)
      .filter((item): item is VkCommunity => item !== null);
    const source = asObject(result);
    const total = Number(source.count);

    return {
      count:
        Number.isInteger(total) && total >= 0 ? total : items.length,
      offset,
      items,
    };
  }

  async getByIds(ids: number[]): Promise<VkCommunity[]> {
    const unique = [...new Set(ids)].filter(
      (id) => Number.isInteger(id) && id > 0,
    );
    const found = new Map<number, VkCommunity>();
    const missing: number[] = [];

    for (const id of unique) {
      const cached = this.cache.get(id);
      if (cached !== undefined && cached.expiresAt > this.now()) {
        found.set(id, cached.value);
      } else {
        missing.push(id);
      }
    }

    for (let index = 0; index < missing.length; index += 500) {
      const result = await this.call("groups.getById", {
        group_ids: missing.slice(index, index + 500).join(","),
        fields:
          "description,members_count,verified,screen_name,activity",
      });
      for (const raw of asItems(result)) {
        const item = asCommunity(raw);
        if (item === null) continue;
        this.cache.set(item.id, {
          expiresAt: this.now() + this.cacheTtlMs,
          value: item,
        });
        found.set(item.id, item);
      }
    }

    return unique.flatMap((id) => {
      const item = found.get(id);
      return item === undefined ? [] : [item];
    });
  }

  async wall(id: number, count: number): Promise<VkWallPost[]> {
    const result = await this.call("wall.get", {
      owner_id: -id,
      count,
      filter: "owner",
    });
    return asItems(result).map((item) => asObject(item));
  }

  private async call(
    method: string,
    params: Record<string, string | number>,
  ): Promise<unknown> {
    if (this.options.tokenProvider().trim() === "") {
      throw new Error(
        "Для инструментов сообществ задайте отдельный VK_API_TOKEN в auth.env.",
      );
    }

    const legacy = this.options.tokenType === "legacy";
    const url = new URL(
      `https://${legacy ? "api.vk.com" : "api.vk.ru"}/method/${method}`,
    );
    for (const [key, value] of Object.entries({
      ...params,
      v: "5.199",
    })) {
      url.searchParams.set(key, String(value));
    }
    let lastError: Error | undefined;
    let authenticationRetried = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const token = this.options.tokenProvider().trim();
        if (legacy) url.searchParams.set("access_token", token);
        await this.options.waitForRequest?.();
        const response = await this.fetchImplementation(url, {
          headers: legacy
            ? { Accept: "application/json" }
            : {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
              },
          signal: AbortSignal.timeout(this.options.timeoutMs),
        });
        const payload: unknown = await response.json();
        const providerError = asObject(payload).error;
        if (response.ok && providerError === undefined) {
          return asObject(payload).response;
        }
        const code = Number(asObject(providerError).error_code);
        if (
          !legacy &&
          !authenticationRetried &&
          this.options.refreshAfterAuthenticationFailure !== undefined &&
          (response.status === 401 || code === 5)
        ) {
          await this.options.refreshAfterAuthenticationFailure();
          authenticationRetried = true;
          continue;
        }
        if (
          (response.status === 429 ||
            response.status >= 500 ||
            code === 6) &&
          attempt < 2
        ) {
          await this.sleep(500 * 2 ** attempt);
          continue;
        }
        throw new Error(
          `VK API ${method} недоступен (${
            Number.isInteger(code)
              ? `код ${code}`
              : `HTTP ${response.status}`
          }).`,
        );
      } catch (error) {
        lastError =
          error instanceof Error
            ? error
            : new Error("Сетевая ошибка VK API.");
        if (lastError.message.startsWith("VK API ")) throw lastError;
        if (attempt < 2) await this.sleep(500 * 2 ** attempt);
      }
    }
    throw lastError ?? new Error("VK API недоступен.");
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const source = asObject(value);
  if (Array.isArray(source.items)) return source.items;
  if (Array.isArray(source.groups)) return source.groups;
  return [];
}

function asCommunity(value: unknown): VkCommunity | null {
  const source = asObject(value);
  const id = Number(source.id);
  const name = typeof source.name === "string" ? source.name : "";
  if (!Number.isInteger(id) || id <= 0 || name === "") return null;

  return {
    id,
    name,
    ...(typeof source.screen_name === "string"
      ? { screen_name: source.screen_name }
      : {}),
    ...(typeof source.description === "string"
      ? { description: source.description }
      : {}),
    ...(typeof source.type === "string" ? { type: source.type } : {}),
    ...(Number.isFinite(Number(source.members_count))
      ? { members_count: Number(source.members_count) }
      : {}),
    ...(typeof source.is_verified === "number" ||
    typeof source.is_verified === "boolean"
      ? { is_verified: source.is_verified }
      : {}),
    ...(Number.isFinite(Number(source.is_closed))
      ? { is_closed: Number(source.is_closed) }
      : {}),
    ...(typeof source.deactivated === "string"
      ? { deactivated: source.deactivated }
      : {}),
  };
}
