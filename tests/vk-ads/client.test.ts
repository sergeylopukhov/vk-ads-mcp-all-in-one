import { describe, expect, it, vi } from "vitest";

import {
  VK_ADS_API_V1_BASE_URL,
  VK_ADS_API_V2_BASE_URL,
  VK_ADS_API_V3_BASE_URL,
  VkAdsApiClient,
} from "../../src/vk-ads/client.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

describe("VkAdsApiClient", () => {
  it("loads and sanitizes the current user", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
        id: 123,
        status: "active",
        currency: "RUB",
        types: ["advert"],
        email: "private@example.test",
        username: "private@example.test",
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(client.getCurrentUser()).resolves.toEqual({
      id: 123,
      status: "active",
      currency: "RUB",
      types: ["advert"],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V3_BASE_URL}/user.json`,
      expect.objectContaining({
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: "Bearer access-token",
        },
      }),
    );
    expect(
      JSON.stringify(await client.getCurrentUser()),
    ).not.toContain("private@example.test");
  });

  it("refreshes once after a 401 and retries with the new token", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "old-access"),
      refreshAfterAuthenticationFailure: vi.fn(async () => "new-access"),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: "expired_token" }, 401),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 123 }));
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(client.getCurrentUser()).resolves.toEqual({ id: 123 });
    expect(
      tokenProvider.refreshAfterAuthenticationFailure,
    ).toHaveBeenCalledWith("old-access");
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `${VK_ADS_API_V3_BASE_URL}/user.json`,
      expect.objectContaining({
        headers: expect.objectContaining({
          authorization: "Bearer new-access",
        }),
      }),
    );
  });

  it("does not retry a second rejected request", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "old-access"),
      refreshAfterAuthenticationFailure: vi.fn(async () => "new-access"),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: "expired_token" }, 401),
      )
      .mockResolvedValueOnce(
        jsonResponse({ error: "invalid_token" }, 401),
      );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(client.getCurrentUser()).rejects.toMatchObject({
      code: "invalid_token",
      httpStatus: 401,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(
      tokenProvider.refreshAfterAuthenticationFailure,
    ).toHaveBeenCalledTimes(1);
  });

  it("rejects a malformed successful response", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const client = new VkAdsApiClient(tokenProvider, {
      fetchImpl: vi.fn(async () => jsonResponse({ status: "active" })),
    });

    await expect(client.getCurrentUser()).rejects.toMatchObject({
      code: "invalid_api_response",
      httpStatus: 200,
    });
  });

  it("loads and sanitizes remarketing counters with filters", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          items: [
            {
              id: 17668,
              counter_id: 2_000_000,
              name: "Test counter",
              status: "active",
              system_status: "active",
              working: true,
              flags: ["cookie_sync"],
              private_field: "omitted",
            },
          ],
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.listRemarketingCounters({
        counterIds: [2_000_000, 2_000_001],
        domains: ["example.com", "example.org"],
      }),
    ).resolves.toEqual({
      items: [
        {
          id: 17668,
          counterId: 2_000_000,
          name: "Test counter",
          status: "active",
          systemStatus: "active",
          working: true,
          flags: ["cookie_sync"],
        },
      ],
    });

    const calledUrl = fetchImpl.mock.calls[0]?.[0];
    expect(String(calledUrl)).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/counters.json?_counter_id__in=2000000%2C2000001&_domain__in=example.com%2Cexample.org`,
    );
  });

  it("creates and sanitizes a new remarketing counter", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          id: 17668,
          counter_id: 2_000_000,
          name: "Test counter",
          status: "active",
          system_status: "active",
          working: null,
          flags: [],
          email: "private@example.test",
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });
    const input = {
      name: "Test counter",
      url: "https://example.com",
      email: "private@example.test",
      password: "private-password",
    };

    const result = await client.createRemarketingCounter(input);
    expect(result).toEqual({
      id: 17668,
      counterId: 2_000_000,
      name: "Test counter",
      status: "active",
      systemStatus: "active",
      working: null,
      flags: [],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/counters.json`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
    expect(JSON.stringify(result)).not.toContain(
      "private@example.test",
    );
    expect(JSON.stringify(result)).not.toContain(
      "private-password",
    );
  });

  it("loads and sanitizes one remarketing counter", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          id: 17668,
          counter_id: 2_000_000,
          name: "Test counter",
          status: "active",
          system_status: "active",
          working: null,
          flags: ["cookie_sync"],
          owner_email: "private@example.test",
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    const result = await client.getRemarketingCounter(2_000_000);
    expect(result).toEqual({
      id: 17668,
      counterId: 2_000_000,
      name: "Test counter",
      status: "active",
      systemStatus: "active",
      working: null,
      flags: ["cookie_sync"],
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/counters/2000000.json`,
    );
    expect(JSON.stringify(result)).not.toContain(
      "private@example.test",
    );
  });

  it("loads and sanitizes goals grouped by category", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          mobile_install: [
            {
              goal: "mobile_app",
              description: "App install",
              private_field: "omitted",
            },
          ],
          topmailru: [
            {
              id: 1,
              counter_id: 8,
              counter_name: "Test counter",
              goal: "uss:goal_1",
              description: "Goal 1",
            },
          ],
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(client.listGoals()).resolves.toEqual({
      categories: {
        mobile_install: [
          {
            goal: "mobile_app",
            description: "App install",
          },
        ],
        topmailru: [
          {
            id: 1,
            counterId: 8,
            counterName: "Test counter",
            goal: "uss:goal_1",
            description: "Goal 1",
          },
        ],
      },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/goals.json`,
    );
  });

  it("loads and sanitizes remarketing in-app events", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          count: 1,
          limit: 10,
          offset: 5,
          items: [
            {
              rb_mobile_app_id: 1,
              app_name: "Android test",
              platform: "android",
              status: "approved",
              url: "https://example.test/private-app-url",
              trackers: [
                {
                  id: 133,
                  name: "Tracker",
                  events: [
                    {
                      id: 1,
                      name: "purchase",
                    },
                  ],
                },
              ],
            },
          ],
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.listRemarketingInAppEvents({
        limit: 10,
        offset: 5,
        urlObjectId: "com.test",
      }),
    ).resolves.toEqual({
      count: 1,
      offset: 5,
      items: [
        {
          appId: 1,
          appName: "Android test",
          platform: "android",
          status: "approved",
          trackers: [
            {
              id: 133,
              name: "Tracker",
              events: [
                {
                  id: 1,
                  name: "purchase",
                },
              ],
            },
          ],
        },
      ],
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/inapp_events.json?limit=10&offset=5&_url_object_id=com.test`,
    );
  });

  it("loads and sanitizes remarketing offline goals", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          items: [
            {
              id: 91,
              name: "Store visits",
              type: "email",
              attribution_period: 90,
              load_status: "matched",
              private_rows: ["private@example.test"],
            },
          ],
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.listRemarketingOfflineGoals(),
    ).resolves.toEqual({
      items: [
        {
          id: 91,
          name: "Store visits",
          type: "email",
          attributionPeriod: 90,
          loadStatus: "matched",
        },
      ],
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/offline_goals.json?fields=id%2Cname%2Ctype%2Cattribution_period%2Cload_status`,
    );
  });

  it("uploads a remarketing offline goal as multipart data", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        new Response(null, { status: 204 }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });
    const input = {
      name: "Store visits",
      type: "email" as const,
      attribution_period: 90,
    };

    await expect(
      client.createRemarketingOfflineGoal(
        new Blob(["test@example.com\n"], {
          type: "text/plain",
        }),
        "offline.txt",
        input,
      ),
    ).resolves.toBeUndefined();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/offline_goals.json`,
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("name")).toBe(input.name);
    expect(form.get("type")).toBe(input.type);
    expect(form.get("attribution_period")).toBe("90");
    expect(form.get("list_users")).toBeInstanceOf(Blob);
  });

  it("updates a remarketing offline goal as multipart data", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        new Response(null, { status: 204 }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.updateRemarketingOfflineGoal(
        91,
        { name: "Renamed visits" },
        new Blob(["ID,date\nuser@example.test,28.07.2026\n"], {
          type: "text/csv",
        }),
        "offline.csv",
      ),
    ).resolves.toBeUndefined();
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/offline_goals/91.json`,
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("name")).toBe("Renamed visits");
    expect(form.get("list_users")).toBeInstanceOf(Blob);
  });

  it("deletes a remarketing offline goal", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        new Response(null, { status: 204 }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.deleteRemarketingOfflineGoal(91),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/offline_goals/91.json`,
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });

  it("lists and sanitizes remarketing users lists through v3", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
        items: [
          {
            id: 101,
            name: "Audience",
            status: "ready",
            type: "emails",
            base: 0,
            entries_count: 2000,
            ids_count: 1900,
            matched_ids_count: 1800,
            has_history: false,
            error: [{ line: "private@example.test" }],
          },
        ],
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.listRemarketingUsersLists("Audience"),
    ).resolves.toEqual({
      items: [
        {
          id: 101,
          name: "Audience",
          status: "ready",
          type: "emails",
          base: 0,
          entriesCount: 2000,
          idsCount: 1900,
          matchedIdsCount: 1800,
          hasHistory: false,
        },
      ],
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V3_BASE_URL}/remarketing/users_lists.json?_q=Audience`,
    );
  });

  it("gets one remarketing users list through v3", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
        id: 101,
        name: "Audience",
        status: "ready",
        type: "emails",
        base: 0,
        entries_count: 2000,
        ids_count: 1900,
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.getRemarketingUsersList(101),
    ).resolves.toMatchObject({
      id: 101,
      name: "Audience",
      entriesCount: 2000,
      idsCount: 1900,
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V3_BASE_URL}/remarketing/users_lists/101.json`,
    );
  });

  it("creates a remarketing users list through v3", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
        id: 101,
        name: "Audience",
        status: "receiving",
        type: "email",
        base: 0,
        entries_count: 2000,
        ids_count: 0,
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.createRemarketingUsersList(
        new Blob(["user@example.test\n"], {
          type: "text/plain",
        }),
        "audience.txt",
        {
          name: "Audience",
          type: "emails",
        },
      ),
    ).resolves.toEqual({
      id: 101,
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      `${VK_ADS_API_V3_BASE_URL}/remarketing/users_lists.json`,
    );
    expect(init.method).toBe("POST");
    const form = init.body as FormData;
    expect(form.get("name")).toBe("Audience");
    expect(form.get("type")).toBe("emails");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("updates a remarketing users list through v3", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 204 }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.updateRemarketingUsersList(101, "Renamed"),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V3_BASE_URL}/remarketing/users_lists/101.json`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Renamed" }),
      }),
    );
  });

  it("deletes a remarketing users list through v3", async () => {
      const tokenProvider = {
        getAccessToken: vi.fn(async () => "access-token"),
        refreshAfterAuthenticationFailure: vi.fn(),
      };
      const fetchImpl = vi.fn(async () =>
        new Response(null, { status: 204 }),
      );
      const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

      await expect(
        client.deleteRemarketingUsersList(101),
      ).resolves.toBeUndefined();
      expect(fetchImpl).toHaveBeenCalledWith(
        `${VK_ADS_API_V3_BASE_URL}/remarketing/users_lists/101.json`,
        expect.objectContaining({
          method: "DELETE",
        }),
      );
    });

  it("lists and gets remarketing users lists through v2", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const usersList = {
      id: 101,
      name: "Audience",
      status: "ready",
      type: "emails",
      base: 0,
      entries_count: 2000,
      ids_count: 1900,
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ items: [usersList] }))
      .mockResolvedValueOnce(jsonResponse(usersList));
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.listRemarketingUsersLists(undefined, 2),
    ).resolves.toMatchObject({
      items: [{ id: 101, name: "Audience" }],
    });
    await expect(
      client.getRemarketingUsersList(101, 2),
    ).resolves.toMatchObject({
      id: 101,
      name: "Audience",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/users_lists.json`,
    );
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/users_lists/101.json`,
    );
  });

  it("creates a remarketing users list using the v2 multipart contract", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
        id: 101,
        name: "Audience",
        status: "loading",
        type: "emails",
        base: 0,
        entries_count: 2000,
        ids_count: 0,
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.createRemarketingUsersList(
        new Blob(["user@example.test\n"], {
          type: "text/plain",
        }),
        "audience.txt",
        {
          name: "Audience",
          type: "emails",
        },
        2,
      ),
    ).resolves.toEqual({ id: 101 });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/users_lists.json`,
    );
    const form = init.body as FormData;
    expect(form.get("data")).toBe(
      JSON.stringify({
        name: "Audience",
        type: "emails",
      }),
    );
    expect(form.get("name")).toBeNull();
    expect(form.get("type")).toBeNull();
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("updates and deletes remarketing users lists through legacy endpoints", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(async () =>
      new Response(null, { status: 204 }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await client.updateRemarketingUsersList(101, "Renamed", 2);
    await client.deleteRemarketingUsersList(101, 2);
    await client.deleteRemarketingUsersList(101, 1);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `${VK_ADS_API_V2_BASE_URL}/remarketing/users_lists/101.json`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Renamed" }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `${VK_ADS_API_V2_BASE_URL}/remarketing/users_lists/101.json`,
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      `${VK_ADS_API_V1_BASE_URL}/remarketing_users_list/101.json`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("covers the segment and segment-relation API contracts", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const segment = {
      id: 201,
      name: "Audience segment",
      pass_condition: 1,
      relations_count: 1,
    };
    const relation = {
      id: 301,
      object_type: "remarketing_users_list",
      object_id: 101,
      params: {
        source_id: 101,
        type: "positive",
      },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ count: 1, offset: 5, items: [segment] }),
      )
      .mockResolvedValueOnce(jsonResponse(segment))
      .mockResolvedValueOnce(jsonResponse(segment))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ items: [relation] }))
      .mockResolvedValueOnce(jsonResponse({ items: [relation] }))
      .mockResolvedValueOnce(
        jsonResponse({
          ...relation,
          params: { source_id: 101, type: "negative" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });
    const relationInput = {
      object_type: "remarketing_users_list",
      params: {
        source_id: 101,
        type: "positive",
      },
    };

    await expect(
      client.listSegments({
        limit: 10,
        offset: 5,
        id: 201,
        ids: [201, 202],
        name: "Audience segment",
        nameStartsWith: "Audience",
      }),
    ).resolves.toMatchObject({
      count: 1,
      offset: 5,
      items: [{ id: 201, passCondition: 1 }],
    });
    await expect(client.getSegment(201)).resolves.toMatchObject({
      id: 201,
    });
    await expect(
      client.createSegment({
        name: "Audience segment",
        pass_condition: 1,
        relations: [relationInput],
      }),
    ).resolves.toMatchObject({ id: 201 });
    await expect(
      client.updateSegment(201, { name: "Renamed" }),
    ).resolves.toBeUndefined();
    await expect(client.deleteSegment(201)).resolves.toBeUndefined();
    await expect(
      client.listSegmentRelations(201),
    ).resolves.toMatchObject([{ id: 301 }]);
    await expect(
      client.createSegmentRelations(201, [relationInput]),
    ).resolves.toMatchObject([{ id: 301 }]);
    await expect(
      client.updateSegmentRelation(201, 301, {
        source_id: 101,
        type: "negative",
      }),
    ).resolves.toMatchObject({
      id: 301,
      params: { type: "negative" },
    });
    await expect(
      client.deleteSegmentRelation(201, 301),
    ).resolves.toBeUndefined();

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/segments.json?limit=10&offset=5&_id=201&_id__in=201%2C202&_name=Audience+segment&_name__startswith=Audience`,
    );
    expect(String(fetchImpl.mock.calls[5]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/segments/201/relations.json?fields=id%2Cobject_id%2Cobject_type%2Cparams`,
    );
    expect(fetchImpl.mock.calls[6]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ items: [relationInput] }),
    });
    expect(fetchImpl.mock.calls[7]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        params: { source_id: 101, type: "negative" },
      }),
    });
    expect(fetchImpl.mock.calls[8]?.[1]).toMatchObject({
      method: "DELETE",
    });
  });

  it("covers sharing-key API contracts without exposing users", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const sharingKey = {
      sharing_key: "share-key",
      sources: [
        {
          object_type: "users_list",
          object_id: 101,
        },
      ],
      price: "0",
      is_marketplace: false,
      send_email: false,
      payment_type: "free",
      type: "public",
      users: [
        {
          username: "private@example.test",
        },
      ],
      owner: {
        username: "owner@example.test",
      },
      sharing_url: "https://private.example.test/activate",
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ items: [sharingKey] }),
      )
      .mockResolvedValueOnce(jsonResponse(sharingKey))
      .mockResolvedValueOnce(
        jsonResponse({
          id: 501,
          username: "private@example.test",
          sources: sharingKey.sources,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });
    const source = {
      object_type: "users_list",
      object_id: 101,
    };

    await expect(
      client.listSharingKeys("share-key"),
    ).resolves.toEqual([
      {
        sharingKey: "share-key",
        sources: [
          {
            objectType: "users_list",
            objectId: 101,
          },
        ],
        price: "0",
        isMarketplace: false,
        sendEmail: false,
        paymentType: "free",
        type: "public",
        userCount: 1,
      },
    ]);
    await expect(
      client.createSharingKey({
        sources: [source],
        send_email: false,
        users: [],
      }),
    ).resolves.toMatchObject({
      sharingKey: "share-key",
      userCount: 1,
    });
    await expect(
      client.activateSharingKey("share-key", [source]),
    ).resolves.toEqual({
      id: 501,
      sources: [
        {
          objectType: "users_list",
          objectId: 101,
        },
      ],
    });
    await expect(
      client.deleteSharingKey("share-key"),
    ).resolves.toBeUndefined();

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/sharing_keys.json?fields=sharing_key%2Csources%2Cprice%2Cis_marketplace%2Cpayment_type%2Ctype%2Cusers`,
    );
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        sources: [source],
        send_email: false,
        users: [],
      }),
    });
    expect(fetchImpl.mock.calls[2]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ sources: [source] }),
    });
    expect(fetchImpl.mock.calls[3]?.[1]).toMatchObject({
      method: "DELETE",
    });
  });

  it("covers audit-pixel and projection API contracts", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          audit_pixel: "https://example.test/pixel?id=1",
          generated_audit_pixels: [
            {
              audit_pixel:
                "https://example.test/pixel?id=1&role=counter",
              role: "counter",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          cr_ctr: [
            {
              package_id: 101,
              histogram_id: 501,
              avg_cr: null,
              avg_ctr: 0.01,
            },
          ],
          histograms: [
            {
              count: 1,
              histogram_id: 501,
              histogram: [
                { price: 10, uniqs: 100, share: 0.5 },
              ],
            },
          ],
        }),
      );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.checkAuditPixel("https://example.test/pixel?id=1"),
    ).resolves.toMatchObject({
      generatedAuditPixels: [{ role: "counter" }],
    });
    await expect(
      client.predictProjection({
        package_ids: [101],
        targetings: { pads: [201] },
      }),
    ).resolves.toMatchObject({
      crCtr: [{ packageId: 101, avgCr: null }],
      histograms: [
        {
          id: 501,
          points: [{ price: 10, uniqs: 100, share: 0.5 }],
        },
      ],
    });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V3_BASE_URL}/audit_pixel.json?fields=audit_pixel%2Cgenerated_audit_pixels`,
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        audit_pixel: "https://example.test/pixel?id=1",
      }),
    });
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      `${VK_ADS_API_V3_BASE_URL}/projection.json`,
    );
    expect(fetchImpl.mock.calls[1]?.[1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({
        package_ids: [101],
        targetings: { pads: [201] },
      }),
    });
  });

  it("covers v3 day and fast-statistics contracts", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: 101,
              user_id: 201,
              total: {
                base: { shows: 10, clicks: 2, spent: "3.50" },
              },
            },
          ],
          total: {
            base: { shows: 10, clicks: 2, spent: "3.50" },
          },
          limit: 20,
          offset: 0,
          count: 1,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          last_seen_msg_time: {
            timestamp: 1_700_000_000,
            string: "2023-11-14 22:13:20",
            ago: 10,
          },
          banners: {},
          campaigns: {},
          advertisers: {
            "201": {
              timestamp: 1_700_000_000,
              minutely: {
                clicks: [0, 1],
                shows: [2, 3],
              },
            },
          },
          ad_plans: {},
        }),
      );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.listStatisticsDay({
        resource: "ad_plans",
        date_from: "2026-07-01",
        date_to: "2026-07-28",
        ids: [101],
        fields: ["base"],
        attribution: "conversion",
        limit: 20,
        offset: 0,
      }),
    ).resolves.toMatchObject({
      items: [{ id: 101, userId: 201 }],
      count: 1,
    });
    await expect(
      client.getFastStatistics("users", [201]),
    ).resolves.toEqual({
      lastSeen: {
        timestamp: 1_700_000_000,
        string: "2023-11-14 22:13:20",
        ago: 10,
      },
      items: [
        {
          id: "201",
          timestamp: 1_700_000_000,
          clicks: [0, 1],
          shows: [2, 3],
        },
      ],
    });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V3_BASE_URL}/statistics/ad_plans/day.json?date_from=2026-07-01&date_to=2026-07-28&id=101&fields=base&attribution=conversion&limit=20&offset=0`,
    );
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      `${VK_ADS_API_V3_BASE_URL}/statistics/faststat/users.json?id=201`,
    );
  });

  it("covers v2 general, goal, and in-app statistics", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const response = {
      items: [
        {
          id: 101,
          total: { base: { shows: 1 } },
          rows: [
            {
              date: "2026-07-28",
              base: { shows: 1 },
            },
          ],
        },
      ],
      total: { base: { shows: 1 } },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(response))
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: 101,
              total: { goals: [] },
              rows: [{ date: "2026-07-28", goals: [] }],
            },
          ],
          total: { goals: [] },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: 101,
              total: { inapps: [] },
              rows: [{ date: "2026-07-28", inapps: [] }],
            },
          ],
          total: { inapps: [] },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: 101,
              total: { rate: 0, cost: "0", offline: 0 },
              rows: [
                {
                  date: "2026-07-28",
                  rate: 0,
                  cost: "0",
                  offline: 0,
                },
              ],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: "WRONG_RESOURCE",
              message: "Wrong resource",
            },
          },
          404,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          items: [
            {
              id: 101,
              total: { rate: 0, cost: "0", offline: 0 },
              rows: [
                {
                  date: "2026-07-28",
                  rate: 0,
                  cost: "0",
                  offline: 0,
                },
              ],
            },
          ],
        }),
      );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });
    const base = {
      resource: "ad_plans" as const,
      date_from: "2026-07-28",
      date_to: "2026-07-28",
      ids: [101],
      attribution: "conversion" as const,
    };

    await expect(
      client.getGeneralStatistics({
        ...base,
        granularity: "day",
        metrics: ["base"],
      }),
    ).resolves.toMatchObject({ items: [{ id: 101 }] });
    await expect(
      client.getGoalStatistics({
        ...base,
        conversion_types: ["postclick", "total"],
      }),
    ).resolves.toMatchObject({ total: { goals: [] } });
    await expect(
      client.getInAppStatistics({
        ...base,
        conversion_types: ["postclick"],
      }),
    ).resolves.toMatchObject({ total: { inapps: [] } });
    await expect(
      client.getOfflineConversionStatistics({
        resource: "ad_plans",
        granularity: "day",
        date_from: "2026-07-28",
        date_to: "2026-07-28",
        ids: [101],
      }),
    ).resolves.toMatchObject({
      source: "day",
      items: [{ id: 101, rows: [{ offline: 0 }] }],
    });
    await expect(
      client.getOfflineConversionStatistics({
        resource: "ad_plans",
        granularity: "summary",
        date_from: "2026-07-28",
        date_to: "2026-07-28",
        ids: [101],
      }),
    ).resolves.toMatchObject({
      source: "day_fallback",
      items: [{ id: 101, total: { offline: 0 } }],
    });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/statistics/ad_plans/day.json?date_from=2026-07-28&date_to=2026-07-28&id=101&attribution=conversion&metrics=base`,
    );
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/statistics/goals/ad_plans/day.json?date_from=2026-07-28&date_to=2026-07-28&id=101&attribution=conversion&conversion_type=postclick%2Ctotal`,
    );
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/statistics/inapp/ad_plans/day.json?date_from=2026-07-28&date_to=2026-07-28&id=101&attribution=conversion&conversion_type=postclick`,
    );
    expect(String(fetchImpl.mock.calls[3]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/statistics/offline_conversions/ad_plans/day.json?date_from=2026-07-28&date_to=2026-07-28&id=101`,
    );
    expect(String(fetchImpl.mock.calls[4]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/statistics/offline_conversions/ad_plans/summary.json?date_from=2026-07-28&date_to=2026-07-28&id=101`,
    );
    expect(String(fetchImpl.mock.calls[5]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/statistics/offline_conversions/ad_plans/day.json?date_from=2026-07-28&date_to=2026-07-28&id=101`,
    );
  });

  it("covers the lead-form lifecycle API contracts", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const form = {
      id: "101",
      name: "Test form",
      status: 1,
      first_screen_type: "compact",
      title: "Test",
      description: "Description",
      company_title: "VK",
      logo_id: "logo-id",
      contact_fields: ["first_name", "phone"],
      result_info: { title: "Thanks" },
      agreement: { usage: "template_document" },
      leads_count: 0,
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          count: 1,
          offset: 0,
          limit: 10,
          items: [form],
        }),
      )
      .mockResolvedValueOnce(jsonResponse(form))
      .mockResolvedValueOnce(jsonResponse({ id: "101" }))
      .mockResolvedValueOnce(
        jsonResponse({ ...form, name: "Updated form" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ ...form, id: 102, name: "Copied form" }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ ...form, status: 2 }]),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ ...form, status: 1 }]),
      );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });
    const createInput = {
      name: "Test form",
      first_screen_type: "compact" as const,
      title: "Test",
      description: "Description",
      company_title: "VK",
      logo_id: "logo-id",
      contact_fields: ["first_name", "phone"],
      result_info: { title: "Thanks" },
      agreement: { usage: "template_document" },
    };

    await expect(
      client.listLeadForms({
        limit: 10,
        offset: 0,
        query: "Test",
        sorting: ["-id"],
      }),
    ).resolves.toMatchObject({
      count: 1,
      items: [{ id: 101, companyTitle: "VK" }],
    });
    await expect(client.getLeadForm(101)).resolves.toMatchObject({
      id: 101,
    });
    await expect(
      client.createLeadForm(createInput),
    ).resolves.toMatchObject({ id: 101 });
    await expect(
      client.updateLeadForm(101, { name: "Updated form" }),
    ).resolves.toMatchObject({ name: "Updated form" });
    await expect(
      client.copyLeadForm(101, "Copied form"),
    ).resolves.toMatchObject({ id: 102, name: "Copied form" });
    await expect(
      client.setLeadFormsArchived([101], true),
    ).resolves.toMatchObject([{ id: 101, status: 2 }]);
    await expect(
      client.setLeadFormsArchived([101], false),
    ).resolves.toMatchObject([{ id: 101, status: 1 }]);

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V1_BASE_URL}/lead_ads/lead_forms.json?limit=10&offset=0&q=Test&sorting=-id`,
    );
    expect(String(fetchImpl.mock.calls[4]?.[0])).toBe(
      `${VK_ADS_API_V1_BASE_URL}/lead_ads/lead_forms/101/copy`,
    );
    expect(String(fetchImpl.mock.calls[5]?.[0])).toBe(
      `${VK_ADS_API_V1_BASE_URL}/lead_ads/lead_forms/archive?_form_ids__in=101`,
    );
    expect(String(fetchImpl.mock.calls[6]?.[0])).toBe(
      `${VK_ADS_API_V1_BASE_URL}/lead_ads/lead_forms/unarchive?_form_ids__in=101`,
    );
  });

  it("uploads a lead-form logo as multipart form data", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          id: "logo-id",
          variants: {
            original: "https://cdn.example.test/logo.png",
            "56x56": "https://cdn.example.test/logo-56.png",
          },
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });
    const file = new Blob(["png-data"], { type: "image/png" });

    await expect(
      client.uploadLeadFormLogo(file, "logo.png"),
    ).resolves.toEqual({
      id: "logo-id",
      variants: ["original", "56x56"],
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      `${VK_ADS_API_V1_BASE_URL}/lead_ads/upload_image/logo`,
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect((init.body as FormData).get("file")).toBeInstanceOf(Blob);
    expect(
      ((init.body as FormData).get("file") as File).name,
    ).toBe("logo.png");
  });

  it("covers lead listing, export, and test-lead contracts", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          count: 1,
          offset: 0,
          limit: 10,
          items: [
            {
              id: "501",
              form_id: "101",
              form_name: "Test form",
              ad_plan_id: null,
              ad_group_id: null,
              banner_id: null,
              created_at: "2026-07-29 01:00:00",
              contact_info: { phone: "private" },
              answers: [{ value: "private" }],
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        new Response("header\\n", {
          status: 200,
          headers: { "content-type": "text/csv" },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          is_operation_processed: true,
          message: "sent",
          seconds_before_next_sending: 5,
        }),
      );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.listLeads({
        limit: 10,
        formIds: [101],
        createdAtFrom: "2026-07-29 00:00:00",
      }),
    ).resolves.toEqual({
      count: 1,
      offset: 0,
      limit: 10,
      items: [
        {
          id: "501",
          formId: 101,
          formName: "Test form",
          adPlanId: null,
          adGroupId: null,
          bannerId: null,
          createdAt: "2026-07-29 01:00:00",
        },
      ],
    });
    await expect(
      client.exportLeadFormLeads(101, {
        format: "csv",
        bannerIds: [301],
      }),
    ).resolves.toMatchObject({
      contentType: "text/csv",
    });
    await expect(client.sendTestLead(101)).resolves.toEqual({
      processed: true,
      secondsBeforeNextSending: 5,
    });

    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V1_BASE_URL}/lead_ads/leads.json?limit=10&_form_ids__in=101&_created_at__gte=2026-07-29+00%3A00%3A00`,
    );
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      `${VK_ADS_API_V1_BASE_URL}/lead_ads/lead_forms/101/leads.csv?_banner_id__in=301`,
    );
    expect(String(fetchImpl.mock.calls[2]?.[0])).toBe(
      `${VK_ADS_API_V1_BASE_URL}/lead_ads/lead_forms/101/send_test_lead`,
    );
  });

  it("loads and sanitizes remarketing pricelists with pagination", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          count: 1,
          limit: 10,
          offset: 5,
          items: [
            {
              id: 7,
              name: "Test catalog",
              status: "active",
              source_type: "api",
              export_url: "https://private.example.test/feed.xml",
              credentials: {
                api_key: "secret",
              },
            },
          ],
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.listRemarketingPricelists({
        limit: 10,
        offset: 5,
      }),
    ).resolves.toEqual({
      count: 1,
      offset: 5,
      items: [
        {
          id: 7,
          name: "Test catalog",
          status: "active",
          sourceType: "api",
        },
      ],
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/pricelists.json?limit=10&offset=5`,
    );
  });

  it("creates one remarketing pricelist without exposing credentials", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          id: 8,
          credentials: {
            api_key: "private",
          },
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });
    const input = {
      name: "API catalog",
      status: "active" as const,
      source_type: "api" as const,
      remove_utm_tags: true,
    };

    await expect(
      client.createRemarketingPricelist(input),
    ).resolves.toEqual({
      id: 8,
    });
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/pricelists.json`,
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual(input);
  });

  it("creates an NDJSON offer batch and sanitizes its detail", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ id: 17, status: "pending" }, 201),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 17,
          status: "done",
          errors: [
            {
              event: "offer_warning",
              code: "TITLE_NORMALIZED",
              count: 2,
              errors: [
                {
                  offer_id: "private-offer-id",
                  message: "private provider detail",
                },
              ],
            },
          ],
        }),
      );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });
    const operations = [
      {
        method: "PUT" as const,
        data: {
          id: "offer-1",
          title: "Offer",
          price: "100 RUB",
        },
      },
      {
        method: "DELETE" as const,
        data: {
          id: "offer-2",
        },
      },
    ];

    await expect(
      client.createRemarketingPricelistBatch(8, operations),
    ).resolves.toEqual([{ id: 17, status: "pending" }]);
    const [createUrl, createInit] = fetchImpl.mock.calls[0]!;
    expect(String(createUrl)).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/pricelists/8/batch.json`,
    );
    expect(createInit).toMatchObject({
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: "Bearer access-token",
        "content-type": "application/x-ndjson",
      },
      body: operations.map((item) => JSON.stringify(item)).join("\n"),
    });

    const detail =
      await client.getRemarketingPricelistBatchTask(8, 17);
    expect(detail).toEqual({
      id: 17,
      status: "done",
      errorCount: 2,
      feedFailureCount: 0,
      offerErrorCount: 0,
      offerWarningCount: 2,
    });
    expect(String(fetchImpl.mock.calls[1]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/pricelists/8/batch/17.json`,
    );
    expect(JSON.stringify(detail)).not.toContain(
      "private provider detail",
    );
  });

  it("loads and sanitizes local geos", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          items: [
            {
              id: 1,
              name: "Moscow center",
              regions: [
                {
                  lat: 55.75583,
                  lng: 37.6173,
                  radius: 3000,
                  label: "Center",
                  address: "Test address",
                  private_field: "omitted",
                },
              ],
            },
          ],
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(client.listLocalGeos()).resolves.toEqual({
      items: [
        {
          id: 1,
          name: "Moscow center",
          regions: [
            {
              lat: 55.75583,
              lng: 37.6173,
              radius: 3000,
              label: "Center",
              address: "Test address",
            },
          ],
        },
      ],
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/local_geo.json?fields=id%2Cname%2Cregions`,
    );
  });

  it("creates and sanitizes one local geo", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const providerLocalGeo = {
      id: 2,
      name: "Moscow center",
      regions: [
        {
          lat: 55.75583,
          lng: 37.6173,
          radius: 3000,
          label: "Center",
          address: "Test address",
        },
      ],
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse(providerLocalGeo),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.createLocalGeo({
        name: providerLocalGeo.name,
        regions: providerLocalGeo.regions,
      }),
    ).resolves.toEqual(providerLocalGeo);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/local_geo.json`,
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      name: providerLocalGeo.name,
      regions: providerLocalGeo.regions,
    });
  });

  it("updates and sanitizes one local geo through the fixed endpoint", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const providerLocalGeo = {
      id: 1234,
      name: "Updated Moscow center",
      regions: [
        {
          lat: 55.75,
          lng: 37.61,
          radius: 1500,
          label: "Updated center",
          address: "Updated test address",
        },
      ],
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse(providerLocalGeo),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.updateLocalGeo(providerLocalGeo.id, {
        name: providerLocalGeo.name,
        regions: providerLocalGeo.regions,
      }),
    ).resolves.toEqual(providerLocalGeo);

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/local_geo/1234.json`,
    );
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      name: providerLocalGeo.name,
      regions: providerLocalGeo.regions,
    });
  });

  it("deletes one local geo through the fixed endpoint", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        new Response(null, { status: 204 }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(client.deleteLocalGeo(1234)).resolves.toBeUndefined();

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      `${VK_ADS_API_V2_BASE_URL}/remarketing/local_geo/1234.json`,
    );
    expect(init.method).toBe("DELETE");
  });

  it("loads a normalized ad-plans page with pagination and status", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          count: 1,
          offset: 5,
          items: [
            {
              id: 123,
              name: "Test campaign",
              status: "deleted",
              private_field: "omitted",
            },
          ],
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.listAdPlans({
        limit: 10,
        offset: 5,
        status: "deleted",
      }),
    ).resolves.toEqual({
      count: 1,
      offset: 5,
      items: [
        {
          id: 123,
          name: "Test campaign",
          status: "deleted",
        },
      ],
    });

    const calledUrl = fetchImpl.mock.calls[0]?.[0];
    expect(String(calledUrl)).toBe(
      `${VK_ADS_API_V2_BASE_URL}/ad_plans.json?fields=id%2Cname%2Cstatus&limit=10&offset=5&_status=deleted`,
    );
  });

  it("retries a rate-limited read after Retry-After", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "rate_limit_exceeded",
            },
          }),
          {
            status: 429,
            headers: {
              "content-type": "application/json",
              "retry-after": "0",
            },
          },
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          count: 0,
          offset: 0,
          items: [],
        }),
      );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(client.listAdPlans()).resolves.toEqual({
      count: 0,
      offset: 0,
      items: [],
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a rate-limited write", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: "rate_limit_exceeded",
          },
        },
        429,
      ),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.createAdPlan({
        name: "Test campaign",
        campaigns: [
          {
            name: "Test group",
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "rate_limit_exceeded",
      httpStatus: 429,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid ad-plan status in a provider response", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const client = new VkAdsApiClient(tokenProvider, {
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          count: 1,
          offset: 0,
          items: [
            {
              id: 123,
              name: "Test campaign",
              status: "unknown",
            },
          ],
        }),
      ),
    });

    await expect(client.listAdPlans()).rejects.toMatchObject({
      code: "invalid_api_response",
      httpStatus: 200,
    });
  });

  it("loads one normalized ad plan by id", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          id: 123,
          name: "Test campaign",
          status: "deleted",
          private_field: "omitted",
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(client.getAdPlan(123)).resolves.toEqual({
      id: 123,
      name: "Test campaign",
      status: "deleted",
    });
    expect(fetchImpl.mock.calls[0]?.[0]).toBe(
      `${VK_ADS_API_V2_BASE_URL}/ad_plans/123.json?fields=id%2Cname%2Cstatus`,
    );
  });

  it("preserves a provider 404 for a missing ad plan", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const client = new VkAdsApiClient(tokenProvider, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "not_found",
            },
          },
          404,
        ),
      ),
    });

    await expect(client.getAdPlan(123)).rejects.toMatchObject({
      code: "not_found",
      httpStatus: 404,
    });
  });

  it("creates an ad plan with the official writable fields", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          id: 123,
          ad_groups: [],
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.createAdPlan({
        name: "Regular campaign",
        status: "blocked",
        campaigns: [
          {
            name: "Regular group",
            package_id: 42,
          },
        ],
        budget_limit: "5000",
        enable_offline_goals: false,
      }),
    ).resolves.toEqual({
      id: 123,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V2_BASE_URL}/ad_plans.json`,
      expect.objectContaining({
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer access-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Regular campaign",
          status: "blocked",
          campaigns: [
            {
              name: "Regular group",
              package_id: 42,
            },
          ],
          budget_limit: "5000",
          enable_offline_goals: false,
        }),
      }),
    );
  });

  it("preserves a provider validation error during ad-plan creation", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const client = new VkAdsApiClient(tokenProvider, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "validation_failed",
              fields: {
                name: {
                  code: "required",
                },
              },
            },
          },
          400,
        ),
      ),
    });

    await expect(
      client.createAdPlan({
        name: "Campaign",
        campaigns: [
          {
            name: "Group",
            package_id: 42,
          },
        ],
      }),
    ).rejects.toMatchObject({
      code: "validation_failed",
      httpStatus: 400,
    });
  });

  it("updates an ad plan and accepts the documented 204 response", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.updateAdPlan(123, {
        name: "Renamed campaign",
        budget_limit_day: "1000",
      }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V2_BASE_URL}/ad_plans/123.json`,
      expect.objectContaining({
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer access-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Renamed campaign",
          budget_limit_day: "1000",
        }),
      }),
    );
  });

  it("preserves a provider validation error during ad-plan update", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const client = new VkAdsApiClient(tokenProvider, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "validation_failed",
            },
          },
          400,
        ),
      ),
    });

    await expect(
      client.updateAdPlan(123, {
        name: "Campaign",
      }),
    ).rejects.toMatchObject({
      code: "validation_failed",
      httpStatus: 400,
    });
  });

  it("mass-updates ad plans and accepts the documented 204 response", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.massUpdateAdPlans([
        {
          id: 123,
          status: "blocked",
          budget_limit_day: "1000",
        },
        {
          id: 456,
          max_price: 200,
        },
      ]),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V2_BASE_URL}/ad_plans/mass_action.json`,
      expect.objectContaining({
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: "Bearer access-token",
          "content-type": "application/json",
        },
        body: JSON.stringify([
          {
            id: 123,
            status: "blocked",
            budget_limit_day: "1000",
          },
          {
            id: 456,
            max_price: 200,
          },
        ]),
      }),
    );
  });

  it("preserves a provider mass-action limit error", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const client = new VkAdsApiClient(tokenProvider, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "limit_exceeded",
            },
          },
          400,
        ),
      ),
    });

    await expect(
      client.massUpdateAdPlans([
        {
          id: 123,
          status: "blocked",
        },
      ]),
    ).rejects.toMatchObject({
      code: "limit_exceeded",
      httpStatus: 400,
    });
  });

  it("loads and sanitizes an ad-groups page with documented filters", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          count: 1,
          offset: 5,
          items: [
            {
              id: 321,
              name: "Ad group",
              status: "deleted",
              ad_plan_id: null,
              package_id: 42,
              private_field: "omitted",
            },
          ],
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.listAdGroups({
        limit: 10,
        offset: 5,
        ids: [321, 654],
        statuses: ["blocked", "deleted"],
        lastUpdatedGte: "2026-07-01 00:00:00",
        sorting: ["status", "-id"],
      }),
    ).resolves.toEqual({
      count: 1,
      offset: 5,
      items: [
        {
          id: 321,
          name: "Ad group",
          status: "deleted",
          adPlanId: 0,
          packageId: 42,
        },
      ],
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/ad_groups.json?fields=id%2Cname%2Cstatus%2Cad_plan_id%2Cpackage_id&limit=10&offset=5&_id__in=321%2C654&_status__in=blocked%2Cdeleted&_last_updated__gte=2026-07-01+00%3A00%3A00&sorting=status%2C-id`,
    );
  });

  it("rejects an invalid ad-group provider response", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const client = new VkAdsApiClient(tokenProvider, {
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          count: 1,
          offset: 0,
          items: [
            {
              id: 321,
              name: "Ad group",
              status: "unknown",
              ad_plan_id: 123,
              package_id: 42,
            },
          ],
        }),
      ),
    });

    await expect(client.listAdGroups()).rejects.toMatchObject({
      code: "invalid_api_response",
      httpStatus: 200,
    });
  });

  it("loads one normalized ad group by id", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          id: 321,
          name: "Ad group",
          status: "blocked",
          ad_plan_id: 123,
          package_id: 42,
          max_price: "12.50",
          private_field: "omitted",
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(client.getAdGroup(321)).resolves.toEqual({
      id: 321,
      name: "Ad group",
      status: "blocked",
      adPlanId: 123,
      packageId: 42,
      maxPrice: "12.50",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/ad_groups/321.json?fields=id%2Cname%2Cstatus%2Cad_plan_id%2Cpackage_id%2Cmax_price`,
    );
  });

  it("loads and sanitizes one banner by id", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          id: 987,
          ad_group_id: 321,
          name: "Test banner",
          status: "blocked",
          moderation_status: "pending",
          content: {
            private_asset: 123,
          },
          urls: {
            primary: {
              url: "https://example.test",
            },
          },
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(client.getBanner(987)).resolves.toEqual({
      id: 987,
      adGroupId: 321,
      name: "Test banner",
      status: "blocked",
      moderationStatus: "pending",
      content: {
        private_asset: 123,
      },
      urls: {
        primary: {
          url: "https://example.test",
        },
      },
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `${VK_ADS_API_V2_BASE_URL}/banners/987.json?fields=id%2Cad_group_id%2Cname%2Cstatus%2Cmoderation_status%2Ccontent%2Ctextblocks%2Curls`,
    );
  });

  it("loads a normalized banners page with documented filters", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          count: 1,
          offset: 5,
          items: [
            {
              id: 987,
              ad_group_id: 321,
              name: "Test banner",
              status: "deleted",
              moderation_status: "pending",
              private_field: "omitted",
            },
          ],
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.listBanners({
        limit: 10,
        offset: 5,
        ids: [987, 988],
        adGroupIds: [321, 322],
        adGroupStatuses: ["blocked", "deleted"],
        statusNot: "active",
        updatedGte: "2026-07-01 00:00:00",
        url: "example.test",
        textblock: "test",
      }),
    ).resolves.toEqual({
      count: 1,
      offset: 5,
      items: [
        {
          id: 987,
          adGroupId: 321,
          name: "Test banner",
          status: "deleted",
          moderationStatus: "pending",
        },
      ],
    });

    const calledUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(calledUrl).toBe(
      `${VK_ADS_API_V2_BASE_URL}/banners.json?fields=id%2Cad_group_id%2Cname%2Cstatus%2Cmoderation_status&limit=10&offset=5&_id__in=987%2C988&_ad_group_id__in=321%2C322&_ad_group_status__in=blocked%2Cdeleted&_status__ne=active&_updated__gte=2026-07-01+00%3A00%3A00&_url=example.test&_textblock=test`,
    );
  });

  it("creates a banner in an existing ad group", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        id: 987,
      }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.createBanner(321, {
        name: "Test banner",
        status: "blocked",
        content: {
          image_600x600: {
            id: 456,
          },
        },
        urls: {
          primary: {
            id: 789,
          },
        },
      }),
    ).resolves.toEqual({
      id: 987,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V2_BASE_URL}/ad_groups/321/banners.json`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Test banner",
          status: "blocked",
          content: {
            image_600x600: {
              id: 456,
            },
          },
          urls: {
            primary: {
              id: 789,
            },
          },
        }),
      }),
    );
  });

  it("updates a banner and accepts the documented 204 response", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.updateBanner(987, {
        name: "Renamed banner",
        status: "blocked",
        urls: {
          vk_post: {
            id: 123,
          },
        },
      }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V2_BASE_URL}/banners/987.json`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Renamed banner",
          status: "blocked",
          urls: {
            vk_post: {
              id: 123,
            },
          },
        }),
      }),
    );
  });

  it("deletes a banner and accepts the documented 204 response", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(client.deleteBanner(987)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V2_BASE_URL}/banners/987.json`,
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });

  it("mass-updates banner statuses and accepts the documented 204 response", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.massUpdateBanners([
        { id: 987, status: "blocked" },
        { id: 988, status: "deleted" },
      ]),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V2_BASE_URL}/banners/mass_action.json`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify([
          { id: 987, status: "blocked" },
          { id: 988, status: "deleted" },
        ]),
      }),
    );
  });

  it("requests banner remoderation and validates individual results", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        banners: [
          { id: 987, remoderated: true },
          { id: 988, remoderated: false },
        ],
      }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.remoderateBanners([987, 988]),
    ).resolves.toEqual([
      { id: 987, remoderated: true },
      { id: 988, remoderated: false },
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V2_BASE_URL}/banners/remoderate.json?fields=id%2Cremoderated`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          banners: [{ id: 987 }, { id: 988 }],
        }),
      }),
    );
  });

  it("uploads an HTML5 ZIP as multipart form data", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          id: 1084236,
          variants: {
            original: {
              url: "https://cdn.example.test/creative.zip",
              html_params: {
                name: "creative.zip",
                width: "300",
                height: "250",
                size: 2048,
              },
              filename: "creative.zip",
              media_type: "html5",
              size: 2048,
            },
          },
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });
    const file = new Blob(["zip-data"], {
      type: "application/zip",
    });

    await expect(
      client.uploadHtml5Content(file, "creative.zip"),
    ).resolves.toEqual({
      id: 1084236,
      variants: {
        original: {
          width: 300,
          height: 250,
          size: 2048,
        },
      },
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      `${VK_ADS_API_V2_BASE_URL}/content/html5.json`,
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toEqual({
      accept: "application/json",
      authorization: "Bearer access-token",
    });
    const form = init.body as FormData;
    const uploadedFile = form.get("file");
    expect(uploadedFile).toBeInstanceOf(Blob);
    expect((uploadedFile as File).name).toBe("creative.zip");
  });

  it("uploads a static image with dimensions as multipart form data", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          id: 1084237,
          variants: {
            original: {
              url: "https://cdn.example.test/creative.png",
              width: 300,
              height: 250,
              size: 4096,
            },
          },
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });
    const file = new Blob(["png-data"], {
      type: "image/png",
    });

    await expect(
      client.uploadStaticContent(
        file,
        "creative.png",
        300,
        250,
      ),
    ).resolves.toEqual({
      id: 1084237,
      variants: {
        original: {
          width: 300,
          height: 250,
          size: 4096,
        },
      },
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      `${VK_ADS_API_V2_BASE_URL}/content/static.json`,
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toEqual({
      accept: "application/json",
      authorization: "Bearer access-token",
    });
    const form = init.body as FormData;
    expect((form.get("file") as File).name).toBe("creative.png");
    expect(form.get("data")).toBe(
      JSON.stringify({
        width: 300,
        height: 250,
      }),
    );
  });

  it("uploads a video with dimensions as multipart form data", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          id: 1084238,
          variants: {
            original: {
              url: "https://cdn.example.test/creative.mp4",
              width: 640,
              height: 360,
              size: 8192,
            },
          },
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });
    const file = new Blob(["mp4-data"], {
      type: "video/mp4",
    });

    await expect(
      client.uploadVideoContent(
        file,
        "creative.mp4",
        640,
        360,
      ),
    ).resolves.toEqual({
      id: 1084238,
      variants: {
        original: {
          width: 640,
          height: 360,
          size: 8192,
        },
      },
    });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe(
      `${VK_ADS_API_V2_BASE_URL}/content/video.json`,
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    expect(init.headers).toEqual({
      accept: "application/json",
      authorization: "Bearer access-token",
    });
    const form = init.body as FormData;
    expect((form.get("file") as File).name).toBe("creative.mp4");
    expect(form.get("data")).toBe(
      JSON.stringify({
        width: 640,
        height: 360,
      }),
    );
  });

  it("creates an ad group with documented and package fields", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async (_input: string | URL, _init: RequestInit) =>
        jsonResponse({
          id: 321,
          banners: [
            {
              id: 987,
            },
          ],
        }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.createAdGroup({
        name: "Regular group",
        package_id: 42,
        ad_plan_id: 123,
        status: "blocked",
        objective: "traffic",
        targetings: {
          pads: [1],
        },
        custom_package_field: true,
      }),
    ).resolves.toEqual({
      id: 321,
      bannerIds: [987],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V2_BASE_URL}/ad_groups.json`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Regular group",
          package_id: 42,
          ad_plan_id: 123,
          status: "blocked",
          objective: "traffic",
          targetings: {
            pads: [1],
          },
          custom_package_field: true,
        }),
      }),
    );
  });

  it("preserves a provider validation error during ad-group creation", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const client = new VkAdsApiClient(tokenProvider, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "invalid_package",
            },
          },
          400,
        ),
      ),
    });

    await expect(
      client.createAdGroup({
        name: "Regular group",
        package_id: 42,
      }),
    ).rejects.toMatchObject({
      code: "invalid_package",
      httpStatus: 400,
    });
  });

  it("updates an ad group and accepts the documented 204 response", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.updateAdGroup(321, {
        name: "Renamed group",
        status: "blocked",
        custom_package_field: true,
      }),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V2_BASE_URL}/ad_groups/321.json`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Renamed group",
          status: "blocked",
          custom_package_field: true,
        }),
      }),
    );
  });

  it("preserves a provider validation error during ad-group update", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const client = new VkAdsApiClient(tokenProvider, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "not_allowed_for_package",
            },
          },
          400,
        ),
      ),
    });

    await expect(
      client.updateAdGroup(321, {
        name: "Renamed group",
      }),
    ).rejects.toMatchObject({
      code: "not_allowed_for_package",
      httpStatus: 400,
    });
  });

  it("deletes an ad group and accepts the documented 204 response", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(client.deleteAdGroup(321)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V2_BASE_URL}/ad_groups/321.json`,
      expect.objectContaining({
        method: "DELETE",
      }),
    );
  });

  it("preserves a provider error during ad-group deletion", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const client = new VkAdsApiClient(tokenProvider, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "unknown_ad_group",
            },
          },
          404,
        ),
      ),
    });

    await expect(client.deleteAdGroup(321)).rejects.toMatchObject({
      code: "unknown_ad_group",
      httpStatus: 404,
    });
  });

  it("mass-updates ad groups and accepts the documented 204 response", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(
      async () => new Response(null, { status: 204 }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.massUpdateAdGroups([
        {
          id: 321,
          status: "blocked",
          max_price: "12.50",
        },
        {
          id: 654,
          status: "deleted",
        },
      ]),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V2_BASE_URL}/ad_groups/mass_action.json`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify([
          {
            id: 321,
            status: "blocked",
            max_price: "12.50",
          },
          {
            id: 654,
            status: "deleted",
          },
        ]),
      }),
    );
  });

  it("preserves a provider mass-action error for ad groups", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const client = new VkAdsApiClient(tokenProvider, {
      fetchImpl: vi.fn(async () =>
        jsonResponse(
          {
            error: {
              code: "unknown_ad_groups",
            },
          },
          400,
        ),
      ),
    });

    await expect(
      client.massUpdateAdGroups([
        {
          id: 321,
          status: "blocked",
        },
      ]),
    ).rejects.toMatchObject({
      code: "unknown_ad_groups",
      httpStatus: 400,
    });
  });

  it("validates and locally paginates reference collections", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        count: 3,
        items: [
          { id: 1, name: "one" },
          { id: 2, name: "two" },
          { id: 3, name: "three" },
        ],
      }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.listReferenceData("banner_fields", {
        limit: 1,
        offset: 1,
      }),
    ).resolves.toEqual({
      count: 3,
      limit: 1,
      offset: 1,
      items: [{ id: 2, name: "two" }],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V2_BASE_URL}/banner_fields.json`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("uses the documented API version for reference resources", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ items: [] }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await client.listReferenceData("in_app_event_categories");
    await client.listReferenceData("transaction_groups");

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `${VK_ADS_API_V1_BASE_URL}/inapp_event_categories.json`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `${VK_ADS_API_V2_BASE_URL}/billing/transaction_groups.json`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("validates map-shaped reference responses", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ interests: [], stable: { enabled: true } }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.getReferenceMap("targetings_tree"),
    ).resolves.toEqual({
      interests: [],
      stable: { enabled: true },
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V2_BASE_URL}/targetings_tree.json`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("lists and normalizes surveys", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        count: 1,
        offset: 0,
        limit: 10,
        items: [
          {
            id: "42",
            name: "Survey",
            status: 1,
          first_screen_type: "text",
          logo: {
            id: "survey-logo",
            variants: {},
          },
          respondents_count: 0,
          },
        ],
      }),
    );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.listSurveys({
        limit: 10,
        query: "Survey",
        sorting: ["-id"],
      }),
    ).resolves.toEqual({
      count: 1,
      offset: 0,
      limit: 10,
      items: [
        {
          id: 42,
          name: "Survey",
          status: 1,
          firstScreenType: "text",
          logoId: "survey-logo",
          respondentsCount: 0,
        },
      ],
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      `${VK_ADS_API_V1_BASE_URL}/lead_ads/survey_forms.json?limit=10&q=Survey&sorting=-id`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("creates, updates, copies, and archives surveys through fixed endpoints", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: 42 }))
      .mockResolvedValueOnce(
        jsonResponse({ id: 42, name: "Updated" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ id: 43, name: "Copy" }),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ id: 42, name: "Updated", status: 2 }]),
      );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });
    const createInput = {
      name: "Survey",
      first_screen_type: "text",
      title: "Title",
      company_title: "Company",
      result_info: {},
      pages: [{ blocks: [] }],
      logo_id: "logo",
      gradient: 3,
    };

    await expect(client.createSurvey(createInput)).resolves.toEqual({
      id: 42,
    });
    await expect(
      client.updateSurvey(42, { name: "Updated" }),
    ).resolves.toMatchObject({ id: 42, name: "Updated" });
    await expect(
      client.copySurvey(42, "Copy"),
    ).resolves.toMatchObject({ id: 43, name: "Copy" });
    await expect(
      client.setSurveysArchived([42], true),
    ).resolves.toEqual([
      { id: 42, name: "Updated", status: 2 },
    ]);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `${VK_ADS_API_V1_BASE_URL}/lead_ads/survey_forms.json`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(createInput),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      `${VK_ADS_API_V1_BASE_URL}/lead_ads/survey_forms/archive?_form_ids__in=42`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("drops respondent answers and contact data", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const client = new VkAdsApiClient(tokenProvider, {
      fetchImpl: vi.fn(async () =>
        jsonResponse({
          count: 1,
          offset: 0,
          limit: 20,
          items: [
            {
              id: 7,
              survey_id: 42,
              survey_name: "Survey",
              created_at: "2026-07-29 00:00:00",
              answers: [{ private: true }],
              contact_info: { phone: "private" },
            },
          ],
        }),
      ),
    });

    const result = await client.listRespondents({
      surveyIds: [42],
    });

    expect(result.items).toEqual([
      {
        id: 7,
        surveyId: 42,
        surveyName: "Survey",
        createdAt: "2026-07-29 00:00:00",
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("manages subscriptions through v3 endpoints", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          count: 1,
          offset: 0,
          limit: 20,
          items: [
            {
              id: "9",
              resource: "BANNER",
              callback_url: "https://example.test/callback",
            },
          ],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 10 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(client.listSubscriptions()).resolves.toMatchObject({
      items: [
        {
          id: 9,
          resource: "BANNER",
          callbackUrl: "https://example.test/callback",
        },
      ],
    });
    await expect(
      client.createSubscription(
        "BANNER",
        "https://example.test/callback",
      ),
    ).resolves.toEqual({ id: 10 });
    await expect(client.deleteSubscription(10)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      `${VK_ADS_API_V3_BASE_URL}/subscription/10.json`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("resolves, creates, and reads advertising URLs", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const item = {
      id: 71,
      url: "https://example.test/path",
      url_types: ["external"],
      has_goals: false,
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          id: 71,
          url_types: ["external"],
          has_goals: false,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: 71 }, 201))
      .mockResolvedValueOnce(jsonResponse(item))
      .mockResolvedValueOnce(jsonResponse({ items: [item] }));
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.resolveUrl("https://example.test/path"),
    ).resolves.toEqual({
      id: 71,
      url: "https://example.test/path",
      urlTypes: ["external"],
      hasGoals: false,
    });
    await expect(
      client.createUrl("https://example.test/path"),
    ).resolves.toEqual({ id: 71 });
    await expect(client.getUrl(71)).resolves.toMatchObject({
      id: 71,
      urlTypes: ["external"],
    });
    await expect(client.getUrls([71])).resolves.toHaveLength(1);

    expect(fetchImpl).toHaveBeenNthCalledWith(
      1,
      `${VK_ADS_API_V1_BASE_URL}/urls/?url=https%3A%2F%2Fexample.test%2Fpath`,
      expect.objectContaining({ method: "GET" }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `${VK_ADS_API_V2_BASE_URL}/urls.json`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          url: "https://example.test/path",
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenNthCalledWith(
      4,
      `${VK_ADS_API_V2_BASE_URL}/urls/71.json`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("reads and refreshes mobile-store applications", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const providerApp = {
      id: 91,
      name: "com.example.app",
      status: "active",
      title: "Example",
      content_rating: "3+",
      type: "game",
      category_id: 7,
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(providerApp))
      .mockResolvedValueOnce(jsonResponse(providerApp));
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.getMobileStoreApp("google", "com.example.app"),
    ).resolves.toEqual({
      id: 91,
      identifier: "com.example.app",
      status: "active",
      title: "Example",
      contentRating: "3+",
      type: "game",
      categoryId: 7,
    });
    await expect(
      client.refreshMobileStoreApp("google", "com.example.app"),
    ).resolves.toMatchObject({
      id: 91,
      identifier: "com.example.app",
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `${VK_ADS_API_V2_BASE_URL}/google_apps/com.example.app.json`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reads and updates sanitized user profiles across API versions", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const profile = {
      id: 5,
      username: "private@example.test",
      email: "private@example.test",
      language: "ru",
      status: "active",
      currency: "RUB",
      info_currency: "RUB",
      timezone: 3,
      country: 188,
      types: ["advert"],
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(profile))
      .mockResolvedValueOnce(
        jsonResponse({ ...profile, language: "en" }),
      );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(client.getUserProfile("v2")).resolves.toEqual({
      id: 5,
      language: "ru",
      status: "active",
      currency: "RUB",
      infoCurrency: "RUB",
      timezone: 3,
      country: 188,
      types: ["advert"],
    });
    await expect(
      client.updateUserLanguage("v3", "en"),
    ).resolves.toMatchObject({ id: 5, language: "en" });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      2,
      `${VK_ADS_API_V3_BASE_URL}/user.json`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ language: "en" }),
      }),
    );
  });

  it("handles ORD user data and user-geo pages", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const ordUser = {
      name: "Private Person",
      inn: "private",
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(ordUser))
      .mockResolvedValueOnce(jsonResponse(ordUser))
      .mockResolvedValueOnce(
        jsonResponse({
          count: 1,
          offset: 0,
          items: [{ id: 7, name: "Region" }],
        }),
      );
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(client.getOrdUser()).resolves.toEqual(ordUser);
    await expect(
      client.updateOrdUser({ name: "Private Person" }),
    ).resolves.toEqual(ordUser);
    await expect(
      client.listUserGeo({
        limit: 10,
        ids: [7],
        query: "Region",
      }),
    ).resolves.toEqual({
      count: 1,
      offset: 0,
      limit: 10,
      items: [{ id: 7, name: "Region" }],
    });
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      `${VK_ADS_API_V2_BASE_URL}/user_geo.json?limit=10&_id__in=7&_q=Region`,
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("manages counter goals and mutable remarketing resources", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const counter = {
      id: 8,
      counter_id: 42,
      name: "Updated",
      status: "active",
      system_status: "active",
      working: true,
      flags: ["cookie_sync"],
    };
    const goal = {
      id: 7,
      substr: "/order",
      value: 1,
      name: "Order",
      condition: "jse",
      goal_type: "purchase",
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(counter))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(jsonResponse({ items: [goal] }))
      .mockResolvedValueOnce(jsonResponse(goal))
      .mockResolvedValueOnce(
        jsonResponse({ ...goal, name: "Updated goal" }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(
      client.updateRemarketingCounter(42, {
        name: "Updated",
        flags: ["cookie_sync"],
      }),
    ).resolves.toMatchObject({ counterId: 42, name: "Updated" });
    await expect(
      client.deleteRemarketingCounter(42, "v1"),
    ).resolves.toBeUndefined();
    await expect(
      client.listRemarketingCounterGoals(42),
    ).resolves.toHaveLength(1);
    await expect(
      client.createRemarketingCounterGoal(42, {
        name: "Order",
      }),
    ).resolves.toMatchObject({ id: 7, goalType: "purchase" });
    await expect(
      client.updateRemarketingCounterGoal(42, 7, {
        name: "Updated goal",
      }),
    ).resolves.toMatchObject({ name: "Updated goal" });
    await expect(
      client.updateRemarketingInAppEventCategory(1, 2, 3, 4),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenNthCalledWith(
      6,
      `${VK_ADS_API_V2_BASE_URL}/remarketing/inapp_events/1/trackers/2/events/3.json`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ inapp_event_category_id: 4 }),
      }),
    );
  });

  it("lists and transfers SKAdNetwork identifiers", async () => {
    const tokenProvider = {
      getAccessToken: vi.fn(async () => "access-token"),
      refreshAfterAuthenticationFailure: vi.fn(),
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          count: 1,
          items: [
            {
              rb_mobile_app_id: 65,
              sk_ad_network_ids: { available: 10 },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = new VkAdsApiClient(tokenProvider, { fetchImpl });

    await expect(client.listMobileAppsForSkAd()).resolves.toHaveLength(
      1,
    );
    await expect(
      client.transferSkAdNetworkIds(
        "share",
        65,
        2,
        "user@example.test",
      ),
    ).resolves.toBeUndefined();
    await expect(
      client.transferSkAdNetworkIds(
        "withdraw",
        65,
        2,
        "user@example.test",
      ),
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenNthCalledWith(
      3,
      `${VK_ADS_API_V2_BASE_URL}/apple_apps/65/sk_ad_network_ids/withdraw.json`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          count: 2,
          username: "user@example.test",
        }),
      }),
    );
  });
});
