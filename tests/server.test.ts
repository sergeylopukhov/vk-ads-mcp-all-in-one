import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  AD_GROUP_CREATE_TOOL,
  AD_GROUP_DELETE_TOOL,
  AD_GROUP_GET_TOOL,
  AD_GROUP_UPDATE_TOOL,
  AD_GROUPS_MASS_ACTION_TOOL,
  AD_GROUPS_LIST_TOOL,
  BANNER_CREATE_TOOL,
  BANNER_DELETE_TOOL,
  BANNER_GET_TOOL,
  BANNERS_LIST_TOOL,
  BANNER_UPDATE_TOOL,
  BANNERS_MASS_ACTION_TOOL,
  BANNERS_REMODERATE_TOOL,
  AD_PLAN_CREATE_TOOL,
  AD_PLAN_GET_TOOL,
  AD_PLAN_UPDATE_TOOL,
  AD_PLANS_MASS_ACTION_TOOL,
  AD_PLANS_LIST_TOOL,
  CONNECTION_CHECK_TOOL,
  CONTENT_HTML5_UPLOAD_TOOL,
  CONTENT_STATIC_UPLOAD_TOOL,
  CONTENT_VIDEO_UPLOAD_TOOL,
  GOALS_LIST_TOOL,
  LOCAL_GEO_CREATE_TOOL,
  LOCAL_GEO_DELETE_TOOL,
  LOCAL_GEO_UPDATE_TOOL,
  LOCAL_GEOS_LIST_TOOL,
  REMARKETING_IN_APP_EVENTS_LIST_TOOL,
  REMARKETING_OFFLINE_GOAL_CREATE_TOOL,
  REMARKETING_OFFLINE_GOAL_DELETE_TOOL,
  REMARKETING_OFFLINE_GOAL_UPDATE_TOOL,
  REMARKETING_OFFLINE_GOALS_LIST_TOOL,
  REMARKETING_USERS_LIST_CREATE_TOOL,
  REMARKETING_USERS_LIST_DELETE_TOOL,
  REMARKETING_USERS_LIST_GET_TOOL,
  REMARKETING_USERS_LIST_UPDATE_TOOL,
  REMARKETING_USERS_LISTS_LIST_TOOL,
  SEGMENT_CREATE_TOOL,
  SEGMENT_DELETE_TOOL,
  SEGMENT_GET_TOOL,
  SEGMENT_RELATION_DELETE_TOOL,
  SEGMENT_RELATION_UPDATE_TOOL,
  SEGMENT_RELATIONS_CREATE_TOOL,
  SEGMENT_RELATIONS_LIST_TOOL,
  SEGMENT_UPDATE_TOOL,
  SEGMENTS_LIST_TOOL,
  SHARING_KEY_ACTIVATE_TOOL,
  SHARING_KEY_CREATE_TOOL,
  SHARING_KEY_DELETE_TOOL,
  SHARING_KEYS_LIST_TOOL,
  AUDIT_PIXEL_CHECK_TOOL,
  PROJECTION_PREDICT_TOOL,
  STATISTICS_DAY_LIST_TOOL,
  FAST_STATISTICS_GET_TOOL,
  V2_STATISTICS_GET_TOOL,
  GOAL_STATISTICS_GET_TOOL,
  IN_APP_STATISTICS_GET_TOOL,
  OFFLINE_CONVERSION_STATISTICS_DAY_GET_TOOL,
  OFFLINE_CONVERSION_STATISTICS_SUMMARY_GET_TOOL,
  OAUTH_CODE_INFO_TOOL,
  OAUTH_CURRENT_TOKENS_DELETE_TOOL,
  LEAD_FORMS_LIST_TOOL,
  LEAD_FORM_GET_TOOL,
  LEAD_FORM_LOGO_UPLOAD_TOOL,
  LEAD_FORM_CREATE_TOOL,
  LEAD_FORM_UPDATE_TOOL,
  LEAD_FORM_COPY_TOOL,
  LEAD_FORMS_ARCHIVE_TOOL,
  LEAD_FORMS_UNARCHIVE_TOOL,
  LEADS_LIST_TOOL,
  LEAD_FORM_LEADS_EXPORT_TOOL,
  LEAD_FORM_TEST_LEAD_SEND_TOOL,
  REMARKETING_COUNTERS_LIST_TOOL,
  REMARKETING_COUNTER_CREATE_TOOL,
  REMARKETING_COUNTER_GET_TOOL,
  REMARKETING_PRICELIST_BATCH_CREATE_TOOL,
  REMARKETING_PRICELIST_BATCH_GET_TOOL,
  REMARKETING_PRICELIST_CREATE_TOOL,
  REMARKETING_PRICELISTS_LIST_TOOL,
  createVkAdsMcpServer,
} from "../src/server.js";

describe("VK Ads MCP tools", () => {
  it("returns a sanitized connection result", async () => {
    const getCurrentUser = vi.fn(async () => ({
      id: 123,
      status: "active",
      currency: "RUB",
      types: ["advert"],
    }));
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const getAdPlan = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const getAdGroup = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const massUpdateBanners = vi.fn();
    const deleteBanner = vi.fn();
    const updateBanner = vi.fn();
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi.fn();
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const oauthOperations = {
      inspectAuthorizationCode: vi.fn(async () => ({
        userTypes: ["advert"],
      })),
      deleteCurrentUserTokens: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listAdPlans,
        listAdGroups,
        getAdPlan,
        createAdPlan,
        updateAdPlan,
        massUpdateAdPlans,
        getAdGroup,
        createAdGroup,
        updateAdGroup,
        deleteAdGroup,
        massUpdateAdGroups,
        getBanner,
        listBanners,
        createBanner,
        updateBanner,
        deleteBanner,
        massUpdateBanners,
        remoderateBanners,
        uploadHtml5Content,
        uploadStaticContent,
        uploadVideoContent: vi.fn(),
        listRemarketingCounters: vi.fn(),
        listGoals: vi.fn(),
        listRemarketingInAppEvents: vi.fn(),
        listRemarketingPricelists: vi.fn(),
        createRemarketingPricelist: vi.fn(),
        listLocalGeos: vi.fn(),
        createLocalGeo: vi.fn(),
        updateLocalGeo: vi.fn(),
        deleteLocalGeo: vi.fn(),
      },
      auditLog,
      oauthOperations,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: CONNECTION_CHECK_TOOL,
          arguments: {},
        }),
      ).resolves.toMatchObject({
        content: [
          {
            type: "text",
            text: "Подключение к VK Рекламе работает.",
          },
        ],
        structuredContent: {
          connected: true,
          apiVersion: "v3",
          user: {
            id: 123,
            status: "active",
            currency: "RUB",
            types: ["advert"],
          },
        },
      });
      await expect(
        client.callTool({
          name: OAUTH_CODE_INFO_TOOL,
          arguments: {
            code: "one-time-code",
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          recognized: true,
          userTypes: ["advert"],
        },
      });
      await expect(
        client.callTool({
          name: OAUTH_CURRENT_TOKENS_DELETE_TOOL,
          arguments: {
            confirmation: "DELETE_ALL_CURRENT_VK_ADS_TOKENS",
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          deleted: true,
          reauthenticated: true,
          auditRecorded: true,
        },
      });
      expect(getCurrentUser).toHaveBeenCalledTimes(3);
      expect(
        oauthOperations.inspectAuthorizationCode,
      ).toHaveBeenCalledWith("one-time-code");
      expect(
        oauthOperations.deleteCurrentUserTokens,
      ).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns sanitized remarketing counters", async () => {
    const listRemarketingCounters = vi.fn(async () => ({
      items: [
        {
          id: 17668,
          counterId: 2_000_000,
          name: "Test counter",
          status: "active" as const,
          systemStatus: "active" as const,
          working: true,
          flags: ["cookie_sync"],
        },
      ],
    }));
    const server = createVkAdsMcpServer({
      getCurrentUser: vi.fn(),
      listRemarketingCounters,
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      listAdPlans: vi.fn(),
      listAdGroups: vi.fn(),
      getAdPlan: vi.fn(),
      createAdPlan: vi.fn(),
      updateAdPlan: vi.fn(),
      massUpdateAdPlans: vi.fn(),
      getAdGroup: vi.fn(),
      createAdGroup: vi.fn(),
      updateAdGroup: vi.fn(),
      deleteAdGroup: vi.fn(),
      massUpdateAdGroups: vi.fn(),
      getBanner: vi.fn(),
      listBanners: vi.fn(),
      createBanner: vi.fn(),
      updateBanner: vi.fn(),
      deleteBanner: vi.fn(),
      massUpdateBanners: vi.fn(),
      remoderateBanners: vi.fn(),
      uploadHtml5Content: vi.fn(),
      uploadStaticContent: vi.fn(),
      uploadVideoContent: vi.fn(),
    });
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: REMARKETING_COUNTERS_LIST_TOOL,
          arguments: {
            counterIds: [2_000_000],
            domains: ["example.com"],
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
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
        },
      });
      expect(listRemarketingCounters).toHaveBeenCalledWith({
        counterIds: [2_000_000],
        domains: ["example.com"],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("creates, rereads, and audits a new remarketing counter", async () => {
    const counter = {
      id: 17668,
      counterId: 2_000_000,
      name: "Test counter",
      status: "active" as const,
      systemStatus: "active" as const,
      working: null,
      flags: [],
    };
    const createRemarketingCounter = vi.fn(
      async () => counter,
    );
    const listRemarketingCounters = vi.fn(async () => ({
      items: [counter],
    }));
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser: vi.fn(async () => ({ id: 1 })),
        listRemarketingCounters,
        createRemarketingCounter,
        listGoals: vi.fn(),
        listRemarketingInAppEvents: vi.fn(),
        listRemarketingPricelists: vi.fn(),
        createRemarketingPricelist: vi.fn(),
        listLocalGeos: vi.fn(),
        createLocalGeo: vi.fn(),
        updateLocalGeo: vi.fn(),
        deleteLocalGeo: vi.fn(),
        listAdPlans: vi.fn(),
        listAdGroups: vi.fn(),
        getAdPlan: vi.fn(),
        createAdPlan: vi.fn(),
        updateAdPlan: vi.fn(),
        massUpdateAdPlans: vi.fn(),
        getAdGroup: vi.fn(),
        createAdGroup: vi.fn(),
        updateAdGroup: vi.fn(),
        deleteAdGroup: vi.fn(),
        massUpdateAdGroups: vi.fn(),
        getBanner: vi.fn(),
        listBanners: vi.fn(),
        createBanner: vi.fn(),
        updateBanner: vi.fn(),
        deleteBanner: vi.fn(),
        massUpdateBanners: vi.fn(),
        remoderateBanners: vi.fn(),
        uploadHtml5Content: vi.fn(),
        uploadStaticContent: vi.fn(),
        uploadVideoContent: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      const result = await client.callTool({
        name: REMARKETING_COUNTER_CREATE_TOOL,
        arguments: {
          mode: "new",
          name: counter.name,
          url: "https://example.com",
          email: "private@example.test",
          password: "private-password",
        },
      });
      expect(result).toMatchObject({
        structuredContent: {
          created: true,
          verified: true,
          auditRecorded: true,
          counter,
        },
      });
      expect(createRemarketingCounter).toHaveBeenCalledWith({
        name: counter.name,
        url: "https://example.com",
        email: "private@example.test",
        password: "private-password",
      });
      expect(listRemarketingCounters).toHaveBeenCalledWith({
        counterId: counter.counterId,
      });
      expect(JSON.stringify(result)).not.toContain(
        "private@example.test",
      );
      expect(JSON.stringify(result)).not.toContain(
        "private-password",
      );
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "remarketing.counters.create",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns one sanitized remarketing counter", async () => {
    const counter = {
      id: 17668,
      counterId: 2_000_000,
      name: "Test counter",
      status: "active" as const,
      systemStatus: "active" as const,
      working: null,
      flags: ["cookie_sync"],
    };
    const getRemarketingCounter = vi.fn(async () => counter);
    const server = createVkAdsMcpServer({
      getCurrentUser: vi.fn(),
      listRemarketingCounters: vi.fn(),
      getRemarketingCounter,
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      listAdPlans: vi.fn(),
      listAdGroups: vi.fn(),
      getAdPlan: vi.fn(),
      createAdPlan: vi.fn(),
      updateAdPlan: vi.fn(),
      massUpdateAdPlans: vi.fn(),
      getAdGroup: vi.fn(),
      createAdGroup: vi.fn(),
      updateAdGroup: vi.fn(),
      deleteAdGroup: vi.fn(),
      massUpdateAdGroups: vi.fn(),
      getBanner: vi.fn(),
      listBanners: vi.fn(),
      createBanner: vi.fn(),
      updateBanner: vi.fn(),
      deleteBanner: vi.fn(),
      massUpdateBanners: vi.fn(),
      remoderateBanners: vi.fn(),
      uploadHtml5Content: vi.fn(),
      uploadStaticContent: vi.fn(),
      uploadVideoContent: vi.fn(),
    });
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: REMARKETING_COUNTER_GET_TOOL,
          arguments: {
            counterId: counter.counterId,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          counter,
        },
      });
      expect(getRemarketingCounter).toHaveBeenCalledWith(
        counter.counterId,
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns sanitized goals grouped by category", async () => {
    const listGoals = vi.fn(async () => ({
      categories: {
        mobile_install: [
          {
            goal: "mobile_app",
            description: "App install",
          },
        ],
      },
    }));
    const server = createVkAdsMcpServer({
      getCurrentUser: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals,
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      listAdPlans: vi.fn(),
      listAdGroups: vi.fn(),
      getAdPlan: vi.fn(),
      createAdPlan: vi.fn(),
      updateAdPlan: vi.fn(),
      massUpdateAdPlans: vi.fn(),
      getAdGroup: vi.fn(),
      createAdGroup: vi.fn(),
      updateAdGroup: vi.fn(),
      deleteAdGroup: vi.fn(),
      massUpdateAdGroups: vi.fn(),
      getBanner: vi.fn(),
      listBanners: vi.fn(),
      createBanner: vi.fn(),
      updateBanner: vi.fn(),
      deleteBanner: vi.fn(),
      massUpdateBanners: vi.fn(),
      remoderateBanners: vi.fn(),
      uploadHtml5Content: vi.fn(),
      uploadStaticContent: vi.fn(),
      uploadVideoContent: vi.fn(),
    });
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: GOALS_LIST_TOOL,
          arguments: {},
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          categories: {
            mobile_install: [
              {
                goal: "mobile_app",
                description: "App install",
              },
            ],
          },
        },
      });
      expect(listGoals).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns sanitized remarketing in-app events", async () => {
    const listRemarketingInAppEvents = vi.fn(async () => ({
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
    }));
    const server = createVkAdsMcpServer({
      getCurrentUser: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents,
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      listAdPlans: vi.fn(),
      listAdGroups: vi.fn(),
      getAdPlan: vi.fn(),
      createAdPlan: vi.fn(),
      updateAdPlan: vi.fn(),
      massUpdateAdPlans: vi.fn(),
      getAdGroup: vi.fn(),
      createAdGroup: vi.fn(),
      updateAdGroup: vi.fn(),
      deleteAdGroup: vi.fn(),
      massUpdateAdGroups: vi.fn(),
      getBanner: vi.fn(),
      listBanners: vi.fn(),
      createBanner: vi.fn(),
      updateBanner: vi.fn(),
      deleteBanner: vi.fn(),
      massUpdateBanners: vi.fn(),
      remoderateBanners: vi.fn(),
      uploadHtml5Content: vi.fn(),
      uploadStaticContent: vi.fn(),
      uploadVideoContent: vi.fn(),
    });
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: REMARKETING_IN_APP_EVENTS_LIST_TOOL,
          arguments: {
            limit: 10,
            offset: 5,
            urlObjectId: "com.test",
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
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
        },
      });
      expect(listRemarketingInAppEvents).toHaveBeenCalledWith({
        limit: 10,
        offset: 5,
        urlObjectId: "com.test",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("creates, rereads, and audits one remarketing offline goal", async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "vk-ads-offline-goal-"),
    );
    const filePath = join(temporaryDirectory, "offline.txt");
    await writeFile(filePath, "test@example.com\n", {
      mode: 0o600,
    });
    const offlineGoal = {
      id: 91,
      name: "Store visits",
      type: "email" as const,
      attributionPeriod: 90,
      loadStatus: "processing",
    };
    const listRemarketingOfflineGoals = vi
      .fn()
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [offlineGoal] });
    const createRemarketingOfflineGoal = vi.fn(
      async () => undefined,
    );
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser: vi.fn(async () => ({ id: 1 })),
        listRemarketingCounters: vi.fn(),
        listGoals: vi.fn(),
        listRemarketingInAppEvents: vi.fn(),
        listRemarketingOfflineGoals,
        createRemarketingOfflineGoal,
        listRemarketingPricelists: vi.fn(),
        createRemarketingPricelist: vi.fn(),
        listLocalGeos: vi.fn(),
        createLocalGeo: vi.fn(),
        updateLocalGeo: vi.fn(),
        deleteLocalGeo: vi.fn(),
        listAdPlans: vi.fn(),
        listAdGroups: vi.fn(),
        getAdPlan: vi.fn(),
        createAdPlan: vi.fn(),
        updateAdPlan: vi.fn(),
        massUpdateAdPlans: vi.fn(),
        getAdGroup: vi.fn(),
        createAdGroup: vi.fn(),
        updateAdGroup: vi.fn(),
        deleteAdGroup: vi.fn(),
        massUpdateAdGroups: vi.fn(),
        getBanner: vi.fn(),
        listBanners: vi.fn(),
        createBanner: vi.fn(),
        updateBanner: vi.fn(),
        deleteBanner: vi.fn(),
        massUpdateBanners: vi.fn(),
        remoderateBanners: vi.fn(),
        uploadHtml5Content: vi.fn(),
        uploadStaticContent: vi.fn(),
        uploadVideoContent: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      const result = await client.callTool({
        name: REMARKETING_OFFLINE_GOAL_CREATE_TOOL,
        arguments: {
          filePath,
          name: offlineGoal.name,
          type: offlineGoal.type,
          attributionPeriod: offlineGoal.attributionPeriod,
        },
      });
      expect(result).toMatchObject({
        structuredContent: {
          created: true,
          verified: true,
          auditRecorded: true,
          offlineGoal,
        },
      });
      expect(
        createRemarketingOfflineGoal,
      ).toHaveBeenCalledWith(
        expect.any(Blob),
        "offline.txt",
        {
          name: offlineGoal.name,
          type: offlineGoal.type,
          attribution_period: offlineGoal.attributionPeriod,
        },
      );
      expect(JSON.stringify(result)).not.toContain(filePath);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "remarketing.offline_goals.create",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
      await rm(temporaryDirectory, {
        recursive: true,
        force: true,
      });
    }
  });

  it("returns sanitized remarketing offline goals", async () => {
    const offlineGoal = {
      id: 91,
      name: "Store visits",
      type: "email" as const,
      attributionPeriod: 90,
      loadStatus: "matched",
    };
    const listRemarketingOfflineGoals = vi.fn(async () => ({
      items: [offlineGoal],
    }));
    const server = createVkAdsMcpServer({
      getCurrentUser: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingOfflineGoals,
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      listAdPlans: vi.fn(),
      listAdGroups: vi.fn(),
      getAdPlan: vi.fn(),
      createAdPlan: vi.fn(),
      updateAdPlan: vi.fn(),
      massUpdateAdPlans: vi.fn(),
      getAdGroup: vi.fn(),
      createAdGroup: vi.fn(),
      updateAdGroup: vi.fn(),
      deleteAdGroup: vi.fn(),
      massUpdateAdGroups: vi.fn(),
      getBanner: vi.fn(),
      listBanners: vi.fn(),
      createBanner: vi.fn(),
      updateBanner: vi.fn(),
      deleteBanner: vi.fn(),
      massUpdateBanners: vi.fn(),
      remoderateBanners: vi.fn(),
      uploadHtml5Content: vi.fn(),
      uploadStaticContent: vi.fn(),
      uploadVideoContent: vi.fn(),
    });
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: REMARKETING_OFFLINE_GOALS_LIST_TOOL,
          arguments: {},
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          items: [offlineGoal],
        },
      });
      expect(listRemarketingOfflineGoals).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("updates, rereads, and audits one remarketing offline goal", async () => {
    const before = {
      id: 91,
      name: "Store visits",
      type: "email" as const,
      attributionPeriod: 90,
      loadStatus: "matched",
    };
    const after = {
      ...before,
      name: "Renamed visits",
    };
    const listRemarketingOfflineGoals = vi
      .fn()
      .mockResolvedValueOnce({ items: [before] })
      .mockResolvedValueOnce({ items: [after] });
    const updateRemarketingOfflineGoal = vi.fn(
      async () => undefined,
    );
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser: vi.fn(async () => ({ id: 1 })),
        listRemarketingCounters: vi.fn(),
        listGoals: vi.fn(),
        listRemarketingInAppEvents: vi.fn(),
        listRemarketingOfflineGoals,
        updateRemarketingOfflineGoal,
        listRemarketingPricelists: vi.fn(),
        createRemarketingPricelist: vi.fn(),
        listLocalGeos: vi.fn(),
        createLocalGeo: vi.fn(),
        updateLocalGeo: vi.fn(),
        deleteLocalGeo: vi.fn(),
        listAdPlans: vi.fn(),
        listAdGroups: vi.fn(),
        getAdPlan: vi.fn(),
        createAdPlan: vi.fn(),
        updateAdPlan: vi.fn(),
        massUpdateAdPlans: vi.fn(),
        getAdGroup: vi.fn(),
        createAdGroup: vi.fn(),
        updateAdGroup: vi.fn(),
        deleteAdGroup: vi.fn(),
        massUpdateAdGroups: vi.fn(),
        getBanner: vi.fn(),
        listBanners: vi.fn(),
        createBanner: vi.fn(),
        updateBanner: vi.fn(),
        deleteBanner: vi.fn(),
        massUpdateBanners: vi.fn(),
        remoderateBanners: vi.fn(),
        uploadHtml5Content: vi.fn(),
        uploadStaticContent: vi.fn(),
        uploadVideoContent: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: REMARKETING_OFFLINE_GOAL_UPDATE_TOOL,
          arguments: {
            id: before.id,
            name: after.name,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          updated: true,
          verified: true,
          auditRecorded: true,
          offlineGoal: after,
        },
      });
      expect(updateRemarketingOfflineGoal).toHaveBeenCalledWith(
        before.id,
        { name: after.name },
        undefined,
        undefined,
      );
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "remarketing.offline_goals.update",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("deletes, rereads, and audits one remarketing offline goal", async () => {
    const offlineGoal = {
      id: 91,
      name: "Store visits",
      type: "email" as const,
      attributionPeriod: 90,
    };
    const listRemarketingOfflineGoals = vi
      .fn()
      .mockResolvedValueOnce({ items: [offlineGoal] })
      .mockResolvedValueOnce({ items: [] });
    const deleteRemarketingOfflineGoal = vi.fn(
      async () => undefined,
    );
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser: vi.fn(async () => ({ id: 1 })),
        listRemarketingCounters: vi.fn(),
        listGoals: vi.fn(),
        listRemarketingInAppEvents: vi.fn(),
        listRemarketingOfflineGoals,
        deleteRemarketingOfflineGoal,
        listRemarketingPricelists: vi.fn(),
        createRemarketingPricelist: vi.fn(),
        listLocalGeos: vi.fn(),
        createLocalGeo: vi.fn(),
        updateLocalGeo: vi.fn(),
        deleteLocalGeo: vi.fn(),
        listAdPlans: vi.fn(),
        listAdGroups: vi.fn(),
        getAdPlan: vi.fn(),
        createAdPlan: vi.fn(),
        updateAdPlan: vi.fn(),
        massUpdateAdPlans: vi.fn(),
        getAdGroup: vi.fn(),
        createAdGroup: vi.fn(),
        updateAdGroup: vi.fn(),
        deleteAdGroup: vi.fn(),
        massUpdateAdGroups: vi.fn(),
        getBanner: vi.fn(),
        listBanners: vi.fn(),
        createBanner: vi.fn(),
        updateBanner: vi.fn(),
        deleteBanner: vi.fn(),
        massUpdateBanners: vi.fn(),
        remoderateBanners: vi.fn(),
        uploadHtml5Content: vi.fn(),
        uploadStaticContent: vi.fn(),
        uploadVideoContent: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: REMARKETING_OFFLINE_GOAL_DELETE_TOOL,
          arguments: {
            id: offlineGoal.id,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          deleted: true,
          verified: true,
          auditRecorded: true,
        },
      });
      expect(deleteRemarketingOfflineGoal).toHaveBeenCalledWith(
        offlineGoal.id,
      );
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "remarketing.offline_goals.delete",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("runs the remarketing users-list tool lifecycle", async () => {
    const temporaryDirectory = await mkdtemp(
      join(tmpdir(), "vk-ads-users-list-"),
    );
    const filePath = join(temporaryDirectory, "audience.txt");
    await writeFile(filePath, "user@example.test\n", {
      mode: 0o600,
    });
    let usersList = {
      id: 101,
      name: "Audience",
      status: "ready",
      type: "emails",
      base: 0,
      entriesCount: 2000,
      idsCount: 1900,
      matchedIdsCount: 1800,
      hasHistory: false,
    };
    let exists = true;
    const listRemarketingUsersLists = vi.fn(async () => ({
      items: exists ? [usersList] : [],
    }));
    const getRemarketingUsersList = vi.fn(async () => usersList);
    const createRemarketingUsersList = vi.fn(
      async () => usersList,
    );
    const updateRemarketingUsersList = vi.fn(
      async (
        _id: number,
        name: string,
      ) => {
        usersList = {
          ...usersList,
          name,
        };
      },
    );
    const deleteRemarketingUsersList = vi.fn(async () => {
      exists = false;
    });
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser: vi.fn(async () => ({ id: 1 })),
        listRemarketingCounters: vi.fn(),
        listGoals: vi.fn(),
        listRemarketingInAppEvents: vi.fn(),
        listRemarketingUsersLists,
        getRemarketingUsersList,
        createRemarketingUsersList,
        updateRemarketingUsersList,
        deleteRemarketingUsersList,
        listRemarketingPricelists: vi.fn(),
        createRemarketingPricelist: vi.fn(),
        listLocalGeos: vi.fn(),
        createLocalGeo: vi.fn(),
        updateLocalGeo: vi.fn(),
        deleteLocalGeo: vi.fn(),
        listAdPlans: vi.fn(),
        listAdGroups: vi.fn(),
        getAdPlan: vi.fn(),
        createAdPlan: vi.fn(),
        updateAdPlan: vi.fn(),
        massUpdateAdPlans: vi.fn(),
        getAdGroup: vi.fn(),
        createAdGroup: vi.fn(),
        updateAdGroup: vi.fn(),
        deleteAdGroup: vi.fn(),
        massUpdateAdGroups: vi.fn(),
        getBanner: vi.fn(),
        listBanners: vi.fn(),
        createBanner: vi.fn(),
        updateBanner: vi.fn(),
        deleteBanner: vi.fn(),
        massUpdateBanners: vi.fn(),
        remoderateBanners: vi.fn(),
        uploadHtml5Content: vi.fn(),
        uploadStaticContent: vi.fn(),
        uploadVideoContent: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: REMARKETING_USERS_LISTS_LIST_TOOL,
          arguments: {},
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          items: [usersList],
        },
      });
      await expect(
        client.callTool({
          name: REMARKETING_USERS_LIST_GET_TOOL,
          arguments: {
            id: usersList.id,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          usersList,
        },
      });
      await expect(
        client.callTool({
          name: REMARKETING_USERS_LIST_CREATE_TOOL,
          arguments: {
            filePath,
            name: usersList.name,
            type: usersList.type,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          created: true,
          verified: true,
          usersList,
        },
      });
      await expect(
        client.callTool({
          name: REMARKETING_USERS_LIST_UPDATE_TOOL,
          arguments: {
            id: usersList.id,
            name: "Renamed audience",
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          updated: true,
          verified: true,
          usersList: {
            name: "Renamed audience",
          },
        },
      });
      await expect(
        client.callTool({
          name: REMARKETING_USERS_LIST_DELETE_TOOL,
          arguments: {
            id: usersList.id,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          deleted: true,
          verified: true,
        },
      });
      expect(createRemarketingUsersList).toHaveBeenCalledWith(
        expect.any(Blob),
        "audience.txt",
        {
          name: "Audience",
          type: "emails",
        },
      );
      expect(updateRemarketingUsersList).toHaveBeenCalledWith(
        usersList.id,
        "Renamed audience",
      );
      expect(deleteRemarketingUsersList).toHaveBeenCalledWith(
        usersList.id,
      );
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "remarketing.users_lists.delete",
        outcome: "success",
      });

    } finally {
      await client.close();
      await server.close();
      await rm(temporaryDirectory, {
        recursive: true,
        force: true,
      });
    }
  });

  it("runs the segment and relation tool lifecycle", async () => {
    let segment = {
      id: 201,
      name: "Audience segment",
      passCondition: 1,
      relationsCount: 1,
    };
    let segmentExists = true;
    let relations: Array<{
      id: number;
      objectType: string;
      objectId: number;
      params: Record<string, unknown>;
    }> = [
      {
        id: 301,
        objectType: "remarketing_users_list",
        objectId: 101,
        params: {
          source_id: 101,
          type: "positive",
        },
      },
    ];
    const listSegments = vi.fn(async () => ({
      count: segmentExists ? 1 : 0,
      offset: 0,
      items: segmentExists ? [segment] : [],
    }));
    const getSegment = vi.fn(async () => segment);
    const createSegment = vi.fn(async () => segment);
    const updateSegment = vi.fn(
      async (
        _id: number,
        input: { name?: string; pass_condition?: number },
      ) => {
        segment = {
          ...segment,
          ...(input.name === undefined
            ? {}
            : { name: input.name }),
          ...(input.pass_condition === undefined
            ? {}
            : { passCondition: input.pass_condition }),
        };
      },
    );
    const deleteSegment = vi.fn(async () => {
      segmentExists = false;
    });
    const listSegmentRelations = vi.fn(async () => relations);
    const createSegmentRelations = vi.fn(async () => {
      const created = {
        id: 302,
        objectType: "remarketing_users_list",
        objectId: 102,
        params: {
          source_id: 102,
          type: "positive",
        },
      };
      relations = [...relations, created];
      return [created];
    });
    const updateSegmentRelation = vi.fn(
      async (
        _segmentId: number,
        relationId: number,
        params: Record<string, unknown>,
      ) => {
        const current = relations.find(
          (relation) => relation.id === relationId,
        )!;
        const updated = { ...current, params };
        relations = relations.map((relation) =>
          relation.id === relationId ? updated : relation,
        );
        return updated;
      },
    );
    const deleteSegmentRelation = vi.fn(
      async (_segmentId: number, relationId: number) => {
        relations = relations.filter(
          (relation) => relation.id !== relationId,
        );
      },
    );
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser: vi.fn(async () => ({ id: 1 })),
        listSegments,
        getSegment,
        createSegment,
        updateSegment,
        deleteSegment,
        listSegmentRelations,
        createSegmentRelations,
        updateSegmentRelation,
        deleteSegmentRelation,
        listRemarketingCounters: vi.fn(),
        listGoals: vi.fn(),
        listRemarketingInAppEvents: vi.fn(),
        listRemarketingPricelists: vi.fn(),
        createRemarketingPricelist: vi.fn(),
        listLocalGeos: vi.fn(),
        createLocalGeo: vi.fn(),
        updateLocalGeo: vi.fn(),
        deleteLocalGeo: vi.fn(),
        listAdPlans: vi.fn(),
        listAdGroups: vi.fn(),
        getAdPlan: vi.fn(),
        createAdPlan: vi.fn(),
        updateAdPlan: vi.fn(),
        massUpdateAdPlans: vi.fn(),
        getAdGroup: vi.fn(),
        createAdGroup: vi.fn(),
        updateAdGroup: vi.fn(),
        deleteAdGroup: vi.fn(),
        massUpdateAdGroups: vi.fn(),
        getBanner: vi.fn(),
        listBanners: vi.fn(),
        createBanner: vi.fn(),
        updateBanner: vi.fn(),
        deleteBanner: vi.fn(),
        massUpdateBanners: vi.fn(),
        remoderateBanners: vi.fn(),
        uploadHtml5Content: vi.fn(),
        uploadStaticContent: vi.fn(),
        uploadVideoContent: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      await expect(
        client.callTool({
          name: SEGMENTS_LIST_TOOL,
          arguments: {},
        }),
      ).resolves.toMatchObject({
        structuredContent: { items: [{ id: 201 }] },
      });
      await expect(
        client.callTool({
          name: SEGMENT_GET_TOOL,
          arguments: { id: 201 },
        }),
      ).resolves.toMatchObject({
        structuredContent: { segment: { id: 201 } },
      });
      await expect(
        client.callTool({
          name: SEGMENT_CREATE_TOOL,
          arguments: {
            name: "Audience segment",
            passCondition: 1,
            relations: [
              {
                objectType: "remarketing_users_list",
                params: { source_id: 101, type: "positive" },
              },
            ],
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: { created: true, verified: true },
      });
      await expect(
        client.callTool({
          name: SEGMENT_UPDATE_TOOL,
          arguments: { id: 201, name: "Renamed segment" },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          updated: true,
          verified: true,
          segment: { name: "Renamed segment" },
        },
      });
      await expect(
        client.callTool({
          name: SEGMENT_RELATIONS_LIST_TOOL,
          arguments: { segmentId: 201 },
        }),
      ).resolves.toMatchObject({
        structuredContent: { items: [{ id: 301 }] },
      });
      await expect(
        client.callTool({
          name: SEGMENT_RELATIONS_CREATE_TOOL,
          arguments: {
            segmentId: 201,
            items: [
              {
                objectType: "remarketing_users_list",
                params: { source_id: 102, type: "positive" },
              },
            ],
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          created: true,
          verified: true,
          items: [{ id: 302 }],
        },
      });
      await expect(
        client.callTool({
          name: SEGMENT_RELATION_UPDATE_TOOL,
          arguments: {
            segmentId: 201,
            relationId: 302,
            params: { source_id: 102, type: "negative" },
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          updated: true,
          verified: true,
          relation: { params: { type: "negative" } },
        },
      });
      await expect(
        client.callTool({
          name: SEGMENT_RELATION_DELETE_TOOL,
          arguments: { segmentId: 201, relationId: 302 },
        }),
      ).resolves.toMatchObject({
        structuredContent: { deleted: true, verified: true },
      });
      await expect(
        client.callTool({
          name: SEGMENT_DELETE_TOOL,
          arguments: { id: 201 },
        }),
      ).resolves.toMatchObject({
        structuredContent: { deleted: true, verified: true },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("runs the sharing-key tool lifecycle", async () => {
    const fixtureDirectory = await mkdtemp(
      join(tmpdir(), "vk-ads-lead-form-logo-"),
    );
    const logoPath = join(fixtureDirectory, "logo.png");
    const exportPath = join(fixtureDirectory, "leads.csv");
    await writeFile(logoPath, "png-data");
    const sharingKey = {
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
      userCount: 0,
    };
    let exists = true;
    const listSharingKeys = vi.fn(
      async (key?: string) =>
        exists &&
        (key === undefined || key === sharingKey.sharingKey)
          ? [sharingKey]
          : [],
    );
    const createSharingKey = vi.fn(async () => sharingKey);
    const activateSharingKey = vi.fn(async () => ({
      id: 501,
      sources: sharingKey.sources,
    }));
    const deleteSharingKey = vi.fn(async () => {
      exists = false;
    });
    const checkAuditPixel = vi.fn(async (auditPixel: string) => ({
      auditPixel,
      generatedAuditPixels: [
        {
          auditPixel: `${auditPixel}&role=counter`,
          role: "counter",
        },
      ],
    }));
    const predictProjection = vi.fn(async () => ({
      crCtr: [
        {
          packageId: 101,
          histogramId: 501,
          avgCr: null,
          avgCtr: 0.01,
        },
      ],
      histograms: [
        {
          id: 501,
          points: [{ price: 10, uniqs: 100, share: 0.5 }],
        },
      ],
    }));
    const listStatisticsDay = vi.fn(async () => ({
      items: [
        {
          id: 101,
          userId: 201,
          total: { base: { shows: 10 } },
        },
      ],
      total: { base: { shows: 10 } },
      limit: 20,
      offset: 0,
      count: 1,
    }));
    const getFastStatistics = vi.fn(async () => ({
      lastSeen: {
        timestamp: 1_700_000_000,
        string: "2023-11-14 22:13:20",
        ago: 10,
      },
      items: [
        {
          id: "101",
          timestamp: 1_700_000_000,
          clicks: [0, 1],
          shows: [2, 3],
        },
      ],
    }));
    const v2StatisticsResult = {
      items: [
        {
          id: 101,
          total: { base: { shows: 1 } },
          rows: [{ date: "2026-07-28", base: { shows: 1 } }],
        },
      ],
      total: { base: { shows: 1 } },
    };
    const getGeneralStatistics = vi.fn(
      async () => v2StatisticsResult,
    );
    const getGoalStatistics = vi.fn(
      async () => v2StatisticsResult,
    );
    const getInAppStatistics = vi.fn(
      async () => v2StatisticsResult,
    );
    const getOfflineConversionStatistics = vi.fn(
      async (input: { granularity: "day" | "summary" }) => ({
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
        source:
          input.granularity === "summary"
            ? ("day_fallback" as const)
            : ("day" as const),
      }),
    );
    const leadForms = new Map([
      [
        301,
        {
          id: 301,
          name: "Test form",
          status: 1,
          firstScreenType: "compact" as const,
          title: "Test",
          description: "Description",
          companyTitle: "VK",
          logoId: "logo-id",
          contactFields: ["first_name", "phone"],
          resultInfo: { title: "Thanks" },
          agreement: { usage: "template_document" },
          leadsCount: 0,
        },
      ],
    ]);
    const listLeadForms = vi.fn(async () => ({
      count: leadForms.size,
      offset: 0,
      limit: 20,
      items: [...leadForms.values()],
    }));
    const getLeadForm = vi.fn(async (id: number) => {
      const form = leadForms.get(id);
      if (form === undefined) throw new Error("missing form");
      return form;
    });
    const createLeadForm = vi.fn(async () => leadForms.get(301)!);
    const uploadLeadFormLogo = vi.fn(async () => ({
      id: "logo-id",
      variants: ["original", "56x56"],
    }));
    const updateLeadForm = vi.fn(
      async (id: number, input: { name?: string }) => {
        const form = leadForms.get(id)!;
        const updated = { ...form, ...input };
        leadForms.set(id, updated);
        return updated;
      },
    );
    const copyLeadForm = vi.fn(async (_id: number, name?: string) => {
      const copied = {
        ...leadForms.get(301)!,
        id: 302,
        name: name ?? "Test form",
      };
      leadForms.set(302, copied);
      return copied;
    });
    const setLeadFormsArchived = vi.fn(
      async (ids: number[], archived: boolean) =>
        ids.map((id) => {
          const updated = {
            ...leadForms.get(id)!,
            status: archived ? 2 : 1,
          };
          leadForms.set(id, updated);
          return updated;
        }),
    );
    const listLeads = vi.fn(async () => ({
      count: 1,
      offset: 0,
      limit: 20,
      items: [
        {
          id: "501",
          formId: 301,
          formName: "Test form",
          adPlanId: null,
          adGroupId: null,
          bannerId: null,
          createdAt: "2026-07-29 01:00:00",
        },
      ],
    }));
    const exportLeadFormLeads = vi.fn(async () => ({
      bytes: new TextEncoder().encode("header\\n"),
      contentType: "text/csv",
    }));
    const sendTestLead = vi.fn(async () => ({
      processed: true,
      secondsBeforeNextSending: 5,
    }));
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser: vi.fn(async () => ({ id: 1 })),
        listSharingKeys,
        createSharingKey,
        activateSharingKey,
        deleteSharingKey,
        checkAuditPixel,
        predictProjection,
        listStatisticsDay,
        getFastStatistics,
        getGeneralStatistics,
        getGoalStatistics,
        getInAppStatistics,
        getOfflineConversionStatistics,
        listLeadForms,
        uploadLeadFormLogo,
        getLeadForm,
        createLeadForm,
        updateLeadForm,
        copyLeadForm,
        setLeadFormsArchived,
        listLeads,
        exportLeadFormLeads,
        sendTestLead,
        listRemarketingCounters: vi.fn(),
        listGoals: vi.fn(),
        listRemarketingInAppEvents: vi.fn(),
        listRemarketingPricelists: vi.fn(),
        createRemarketingPricelist: vi.fn(),
        listLocalGeos: vi.fn(),
        createLocalGeo: vi.fn(),
        updateLocalGeo: vi.fn(),
        deleteLocalGeo: vi.fn(),
        listAdPlans: vi.fn(),
        listAdGroups: vi.fn(),
        getAdPlan: vi.fn(),
        createAdPlan: vi.fn(),
        updateAdPlan: vi.fn(),
        massUpdateAdPlans: vi.fn(),
        getAdGroup: vi.fn(),
        createAdGroup: vi.fn(),
        updateAdGroup: vi.fn(),
        deleteAdGroup: vi.fn(),
        massUpdateAdGroups: vi.fn(),
        getBanner: vi.fn(),
        listBanners: vi.fn(),
        createBanner: vi.fn(),
        updateBanner: vi.fn(),
        deleteBanner: vi.fn(),
        massUpdateBanners: vi.fn(),
        remoderateBanners: vi.fn(),
        uploadHtml5Content: vi.fn(),
        uploadStaticContent: vi.fn(),
        uploadVideoContent: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);
      await expect(
        client.callTool({
          name: SHARING_KEYS_LIST_TOOL,
          arguments: {},
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          items: [{ sharingKey: "share-key", userCount: 0 }],
        },
      });
      await expect(
        client.callTool({
          name: SHARING_KEY_CREATE_TOOL,
          arguments: {
            sources: [
              {
                objectType: "users_list",
                objectId: 101,
              },
            ],
            sendEmail: false,
            users: [],
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          created: true,
          verified: true,
        },
      });
      await expect(
        client.callTool({
          name: SHARING_KEY_ACTIVATE_TOOL,
          arguments: {
            key: "share-key",
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          activated: true,
          verified: true,
          sources: [{ objectType: "users_list", objectId: 101 }],
        },
      });
      await expect(
        client.callTool({
          name: SHARING_KEY_DELETE_TOOL,
          arguments: {
            key: "share-key",
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          deleted: true,
          verified: true,
        },
      });
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "sharing_keys.delete",
        outcome: "success",
      });
      await expect(
        client.callTool({
          name: AUDIT_PIXEL_CHECK_TOOL,
          arguments: {
            auditPixel: "https://example.test/pixel?id=1",
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          generatedAuditPixels: [{ role: "counter" }],
        },
      });
      await expect(
        client.callTool({
          name: PROJECTION_PREDICT_TOOL,
          arguments: {
            packageIds: [101],
            targetings: { pads: [201] },
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          crCtr: [{ packageId: 101 }],
          histograms: [{ id: 501 }],
        },
      });
      expect(predictProjection).toHaveBeenCalledWith({
        package_ids: [101],
        targetings: { pads: [201] },
      });
      await expect(
        client.callTool({
          name: STATISTICS_DAY_LIST_TOOL,
          arguments: {
            resource: "ad_plans",
            dateFrom: "2026-07-01",
            dateTo: "2026-07-28",
            fields: ["base"],
            limit: 20,
            offset: 0,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          items: [{ id: 101, userId: 201 }],
          count: 1,
        },
      });
      await expect(
        client.callTool({
          name: FAST_STATISTICS_GET_TOOL,
          arguments: {
            resource: "ad_plans",
            ids: [101],
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          items: [{ id: "101", clicks: [0, 1] }],
        },
      });
      expect(listStatisticsDay).toHaveBeenCalledWith({
        resource: "ad_plans",
        date_from: "2026-07-01",
        date_to: "2026-07-28",
        fields: ["base"],
        limit: 20,
        offset: 0,
      });
      await expect(
        client.callTool({
          name: V2_STATISTICS_GET_TOOL,
          arguments: {
            resource: "ad_plans",
            granularity: "day",
            dateFrom: "2026-07-28",
            dateTo: "2026-07-28",
            ids: [101],
            metrics: ["base"],
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: { items: [{ id: 101 }] },
      });
      await expect(
        client.callTool({
          name: GOAL_STATISTICS_GET_TOOL,
          arguments: {
            resource: "ad_plans",
            dateFrom: "2026-07-28",
            dateTo: "2026-07-28",
            ids: [101],
            conversionTypes: ["postclick"],
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: { items: [{ id: 101 }] },
      });
      await expect(
        client.callTool({
          name: IN_APP_STATISTICS_GET_TOOL,
          arguments: {
            resource: "ad_plans",
            dateFrom: "2026-07-28",
            dateTo: "2026-07-28",
            ids: [101],
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: { items: [{ id: 101 }] },
      });
      await expect(
        client.callTool({
          name: OFFLINE_CONVERSION_STATISTICS_DAY_GET_TOOL,
          arguments: {
            resource: "ad_plans",
            dateFrom: "2026-07-28",
            dateTo: "2026-07-28",
            ids: [101],
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          items: [{ id: 101, total: { offline: 0 } }],
          source: "day",
        },
      });
      await expect(
        client.callTool({
          name: OFFLINE_CONVERSION_STATISTICS_SUMMARY_GET_TOOL,
          arguments: {
            resource: "ad_plans",
            dateFrom: "2026-07-28",
            dateTo: "2026-07-28",
            ids: [101],
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          items: [{ id: 101, total: { offline: 0 } }],
          source: "day_fallback",
        },
      });
      await expect(
        client.callTool({
          name: LEAD_FORM_LOGO_UPLOAD_TOOL,
          arguments: { filePath: logoPath },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          uploaded: true,
          verified: true,
          id: "logo-id",
          variants: ["original", "56x56"],
        },
      });
      await expect(
        client.callTool({
          name: LEAD_FORMS_LIST_TOOL,
          arguments: {},
        }),
      ).resolves.toMatchObject({
        structuredContent: { items: [{ id: 301 }] },
      });
      await expect(
        client.callTool({
          name: LEAD_FORM_GET_TOOL,
          arguments: { id: 301 },
        }),
      ).resolves.toMatchObject({
        structuredContent: { form: { id: 301 } },
      });
      await expect(
        client.callTool({
          name: LEAD_FORM_CREATE_TOOL,
          arguments: {
            name: "Test form",
            firstScreenType: "compact",
            title: "Test",
            description: "Description",
            companyTitle: "VK",
            logoId: "logo-id",
            contactFields: ["first_name", "phone"],
            resultInfo: { title: "Thanks" },
            agreement: { usage: "template_document" },
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: { created: true, verified: true },
      });
      await expect(
        client.callTool({
          name: LEAD_FORM_UPDATE_TOOL,
          arguments: { id: 301, name: "Updated form" },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          updated: true,
          verified: true,
          form: { name: "Updated form" },
        },
      });
      await expect(
        client.callTool({
          name: LEAD_FORM_COPY_TOOL,
          arguments: { id: 301, name: "Copied form" },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          copied: true,
          verified: true,
          form: { id: 302 },
        },
      });
      await expect(
        client.callTool({
          name: LEAD_FORMS_ARCHIVE_TOOL,
          arguments: { ids: [301, 302] },
        }),
      ).resolves.toMatchObject({
        structuredContent: { updated: true, verified: true },
      });
      await expect(
        client.callTool({
          name: LEAD_FORMS_UNARCHIVE_TOOL,
          arguments: { ids: [301, 302] },
        }),
      ).resolves.toMatchObject({
        structuredContent: { updated: true, verified: true },
      });
      await expect(
        client.callTool({
          name: LEADS_LIST_TOOL,
          arguments: { formIds: [301] },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          items: [{ id: "501", formId: 301 }],
        },
      });
      await expect(
        client.callTool({
          name: LEAD_FORM_LEADS_EXPORT_TOOL,
          arguments: {
            formId: 301,
            format: "csv",
            outputPath: exportPath,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          saved: true,
          verified: true,
          format: "csv",
        },
      });
      await expect(
        client.callTool({
          name: LEAD_FORM_TEST_LEAD_SEND_TOOL,
          arguments: { formId: 301 },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          sent: true,
          verified: true,
          secondsBeforeNextSending: 5,
        },
      });
    } finally {
      await client.close();
      await server.close();
      await rm(fixtureDirectory, {
        recursive: true,
        force: true,
      });
    }
  });

  it("returns sanitized remarketing pricelists", async () => {
    const listRemarketingPricelists = vi.fn(async () => ({
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
    }));
    const server = createVkAdsMcpServer({
      getCurrentUser: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists,
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      listAdPlans: vi.fn(),
      listAdGroups: vi.fn(),
      getAdPlan: vi.fn(),
      createAdPlan: vi.fn(),
      updateAdPlan: vi.fn(),
      massUpdateAdPlans: vi.fn(),
      getAdGroup: vi.fn(),
      createAdGroup: vi.fn(),
      updateAdGroup: vi.fn(),
      deleteAdGroup: vi.fn(),
      massUpdateAdGroups: vi.fn(),
      getBanner: vi.fn(),
      listBanners: vi.fn(),
      createBanner: vi.fn(),
      updateBanner: vi.fn(),
      deleteBanner: vi.fn(),
      massUpdateBanners: vi.fn(),
      remoderateBanners: vi.fn(),
      uploadHtml5Content: vi.fn(),
      uploadStaticContent: vi.fn(),
      uploadVideoContent: vi.fn(),
    });
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: REMARKETING_PRICELISTS_LIST_TOOL,
          arguments: {
            limit: 10,
            offset: 5,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
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
        },
      });
      expect(listRemarketingPricelists).toHaveBeenCalledWith({
        limit: 10,
        offset: 5,
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("creates, rereads, and audits one API pricelist", async () => {
    const pricelist = {
      id: 8,
      name: "API catalog",
      status: "active",
      sourceType: "api",
    };
    const getCurrentUser = vi.fn(async () => ({ id: 1 }));
    const listRemarketingPricelists = vi.fn(async () => ({
      count: 1,
      offset: 0,
      items: [pricelist],
    }));
    const createRemarketingPricelist = vi.fn(
      async () => ({ id: pricelist.id }),
    );
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listRemarketingCounters: vi.fn(),
        listGoals: vi.fn(),
        listRemarketingInAppEvents: vi.fn(),
        listRemarketingPricelists,
        createRemarketingPricelist,
        listLocalGeos: vi.fn(),
        createLocalGeo: vi.fn(),
        updateLocalGeo: vi.fn(),
        deleteLocalGeo: vi.fn(),
        listAdPlans: vi.fn(),
        listAdGroups: vi.fn(),
        getAdPlan: vi.fn(),
        createAdPlan: vi.fn(),
        updateAdPlan: vi.fn(),
        massUpdateAdPlans: vi.fn(),
        getAdGroup: vi.fn(),
        createAdGroup: vi.fn(),
        updateAdGroup: vi.fn(),
        deleteAdGroup: vi.fn(),
        massUpdateAdGroups: vi.fn(),
        getBanner: vi.fn(),
        listBanners: vi.fn(),
        createBanner: vi.fn(),
        updateBanner: vi.fn(),
        deleteBanner: vi.fn(),
        massUpdateBanners: vi.fn(),
        remoderateBanners: vi.fn(),
        uploadHtml5Content: vi.fn(),
        uploadStaticContent: vi.fn(),
        uploadVideoContent: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: REMARKETING_PRICELIST_CREATE_TOOL,
          arguments: {
            name: pricelist.name,
            status: "active",
            sourceType: "api",
            removeUtmTags: true,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          created: true,
          verified: true,
          auditRecorded: true,
          pricelist,
        },
      });
      expect(createRemarketingPricelist).toHaveBeenCalledWith({
        name: pricelist.name,
        status: "active",
        source_type: "api",
        remove_utm_tags: true,
      });
      expect(listRemarketingPricelists).toHaveBeenCalledWith({
        limit: 50,
        offset: 0,
      });
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "remarketing.pricelists.create",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("creates and rereads one offer batch task", async () => {
    const listRemarketingPricelists = vi.fn(async () => ({
      count: 1,
      offset: 0,
      items: [
        {
          id: 8,
          name: "API catalog",
          status: "active",
          sourceType: "api",
        },
      ],
    }));
    const createRemarketingPricelistBatch = vi.fn(
      async () => [{ id: 17, status: "pending" }],
    );
    const getRemarketingPricelistBatchTask = vi.fn(
      async () => ({
        id: 17,
        status: "done",
        errorCount: 0,
        feedFailureCount: 0,
        offerErrorCount: 0,
        offerWarningCount: 0,
      }),
    );
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser: vi.fn(async () => ({ id: 1 })),
        listRemarketingCounters: vi.fn(),
        listGoals: vi.fn(),
        listRemarketingInAppEvents: vi.fn(),
        listRemarketingPricelists,
        createRemarketingPricelist: vi.fn(),
        createRemarketingPricelistBatch,
        getRemarketingPricelistBatchTask,
        listLocalGeos: vi.fn(),
        createLocalGeo: vi.fn(),
        updateLocalGeo: vi.fn(),
        deleteLocalGeo: vi.fn(),
        listAdPlans: vi.fn(),
        listAdGroups: vi.fn(),
        getAdPlan: vi.fn(),
        createAdPlan: vi.fn(),
        updateAdPlan: vi.fn(),
        massUpdateAdPlans: vi.fn(),
        getAdGroup: vi.fn(),
        createAdGroup: vi.fn(),
        updateAdGroup: vi.fn(),
        deleteAdGroup: vi.fn(),
        massUpdateAdGroups: vi.fn(),
        getBanner: vi.fn(),
        listBanners: vi.fn(),
        createBanner: vi.fn(),
        updateBanner: vi.fn(),
        deleteBanner: vi.fn(),
        massUpdateBanners: vi.fn(),
        remoderateBanners: vi.fn(),
        uploadHtml5Content: vi.fn(),
        uploadStaticContent: vi.fn(),
        uploadVideoContent: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const operations = [
      {
        method: "PUT",
        data: {
          id: "offer-1",
          title: "Offer",
          price: "100 RUB",
        },
      },
    ];

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: REMARKETING_PRICELIST_BATCH_CREATE_TOOL,
          arguments: {
            pricelistId: 8,
            operations,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          accepted: true,
          verified: true,
          auditRecorded: true,
          operationCount: 1,
          tasks: [
            {
              id: 17,
              status: "done",
              errorCount: 0,
            },
          ],
        },
      });
      expect(
        createRemarketingPricelistBatch,
      ).toHaveBeenCalledWith(8, operations);
      expect(
        getRemarketingPricelistBatchTask,
      ).toHaveBeenCalledWith(8, 17);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "remarketing.pricelists.batch.create",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns a sanitized offer batch task", async () => {
    const getRemarketingPricelistBatchTask = vi.fn(
      async () => ({
        id: 17,
        status: "done",
        errorCount: 3,
        feedFailureCount: 0,
        offerErrorCount: 1,
        offerWarningCount: 2,
      }),
    );
    const server = createVkAdsMcpServer({
      getCurrentUser: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      getRemarketingPricelistBatchTask,
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      listAdPlans: vi.fn(),
      listAdGroups: vi.fn(),
      getAdPlan: vi.fn(),
      createAdPlan: vi.fn(),
      updateAdPlan: vi.fn(),
      massUpdateAdPlans: vi.fn(),
      getAdGroup: vi.fn(),
      createAdGroup: vi.fn(),
      updateAdGroup: vi.fn(),
      deleteAdGroup: vi.fn(),
      massUpdateAdGroups: vi.fn(),
      getBanner: vi.fn(),
      listBanners: vi.fn(),
      createBanner: vi.fn(),
      updateBanner: vi.fn(),
      deleteBanner: vi.fn(),
      massUpdateBanners: vi.fn(),
      remoderateBanners: vi.fn(),
      uploadHtml5Content: vi.fn(),
      uploadStaticContent: vi.fn(),
      uploadVideoContent: vi.fn(),
    });
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: REMARKETING_PRICELIST_BATCH_GET_TOOL,
          arguments: {
            pricelistId: 8,
            taskId: 17,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          task: {
            id: 17,
            status: "done",
            errorCount: 3,
            feedFailureCount: 0,
            offerErrorCount: 1,
            offerWarningCount: 2,
          },
        },
      });
      expect(
        getRemarketingPricelistBatchTask,
      ).toHaveBeenCalledWith(8, 17);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns sanitized local geos", async () => {
    const listLocalGeos = vi.fn(async () => ({
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
    }));
    const server = createVkAdsMcpServer({
      getCurrentUser: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos,
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      listAdPlans: vi.fn(),
      listAdGroups: vi.fn(),
      getAdPlan: vi.fn(),
      createAdPlan: vi.fn(),
      updateAdPlan: vi.fn(),
      massUpdateAdPlans: vi.fn(),
      getAdGroup: vi.fn(),
      createAdGroup: vi.fn(),
      updateAdGroup: vi.fn(),
      deleteAdGroup: vi.fn(),
      massUpdateAdGroups: vi.fn(),
      getBanner: vi.fn(),
      listBanners: vi.fn(),
      createBanner: vi.fn(),
      updateBanner: vi.fn(),
      deleteBanner: vi.fn(),
      massUpdateBanners: vi.fn(),
      remoderateBanners: vi.fn(),
      uploadHtml5Content: vi.fn(),
      uploadStaticContent: vi.fn(),
      uploadVideoContent: vi.fn(),
    });
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: LOCAL_GEOS_LIST_TOOL,
          arguments: {},
        }),
      ).resolves.toMatchObject({
        structuredContent: {
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
        },
      });
      expect(listLocalGeos).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("creates, rereads, and audits one local geo", async () => {
    const localGeo = {
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
    const getCurrentUser = vi.fn(async () => ({ id: 1 }));
    const createLocalGeo = vi.fn(async () => localGeo);
    const listLocalGeos = vi.fn(async () => ({
      items: [localGeo],
    }));
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listRemarketingCounters: vi.fn(),
        listGoals: vi.fn(),
        listRemarketingInAppEvents: vi.fn(),
        listRemarketingPricelists: vi.fn(),
        createRemarketingPricelist: vi.fn(),
        listLocalGeos,
        createLocalGeo,
        updateLocalGeo: vi.fn(),
        deleteLocalGeo: vi.fn(),
        listAdPlans: vi.fn(),
        listAdGroups: vi.fn(),
        getAdPlan: vi.fn(),
        createAdPlan: vi.fn(),
        updateAdPlan: vi.fn(),
        massUpdateAdPlans: vi.fn(),
        getAdGroup: vi.fn(),
        createAdGroup: vi.fn(),
        updateAdGroup: vi.fn(),
        deleteAdGroup: vi.fn(),
        massUpdateAdGroups: vi.fn(),
        getBanner: vi.fn(),
        listBanners: vi.fn(),
        createBanner: vi.fn(),
        updateBanner: vi.fn(),
        deleteBanner: vi.fn(),
        massUpdateBanners: vi.fn(),
        remoderateBanners: vi.fn(),
        uploadHtml5Content: vi.fn(),
        uploadStaticContent: vi.fn(),
        uploadVideoContent: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: LOCAL_GEO_CREATE_TOOL,
          arguments: {
            name: localGeo.name,
            regions: localGeo.regions,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          created: true,
          verified: true,
          auditRecorded: true,
          localGeo,
        },
      });
      expect(getCurrentUser).toHaveBeenCalledTimes(1);
      expect(createLocalGeo).toHaveBeenCalledWith({
        name: localGeo.name,
        regions: localGeo.regions,
      });
      expect(listLocalGeos).toHaveBeenCalledTimes(1);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "local_geo.create",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preflights, updates, rereads, and audits one local geo", async () => {
    const before = {
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
    const after = {
      id: before.id,
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
    const getCurrentUser = vi.fn(async () => ({ id: 1 }));
    const listLocalGeos = vi
      .fn()
      .mockResolvedValueOnce({ items: [before] })
      .mockResolvedValueOnce({ items: [after] });
    const updateLocalGeo = vi.fn(async () => after);
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listRemarketingCounters: vi.fn(),
        listGoals: vi.fn(),
        listRemarketingInAppEvents: vi.fn(),
        listRemarketingPricelists: vi.fn(),
        createRemarketingPricelist: vi.fn(),
        listLocalGeos,
        createLocalGeo: vi.fn(),
        updateLocalGeo,
        deleteLocalGeo: vi.fn(),
        listAdPlans: vi.fn(),
        listAdGroups: vi.fn(),
        getAdPlan: vi.fn(),
        createAdPlan: vi.fn(),
        updateAdPlan: vi.fn(),
        massUpdateAdPlans: vi.fn(),
        getAdGroup: vi.fn(),
        createAdGroup: vi.fn(),
        updateAdGroup: vi.fn(),
        deleteAdGroup: vi.fn(),
        massUpdateAdGroups: vi.fn(),
        getBanner: vi.fn(),
        listBanners: vi.fn(),
        createBanner: vi.fn(),
        updateBanner: vi.fn(),
        deleteBanner: vi.fn(),
        massUpdateBanners: vi.fn(),
        remoderateBanners: vi.fn(),
        uploadHtml5Content: vi.fn(),
        uploadStaticContent: vi.fn(),
        uploadVideoContent: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: LOCAL_GEO_UPDATE_TOOL,
          arguments: {
            id: after.id,
            name: after.name,
            regions: after.regions,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          updated: true,
          verified: true,
          auditRecorded: true,
          localGeo: after,
        },
      });
      expect(getCurrentUser).toHaveBeenCalledTimes(1);
      expect(updateLocalGeo).toHaveBeenCalledWith(after.id, {
        name: after.name,
        regions: after.regions,
      });
      expect(listLocalGeos).toHaveBeenCalledTimes(2);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "local_geo.update",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preflights, deletes, rereads, and audits one local geo", async () => {
    const localGeo = {
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
    const getCurrentUser = vi.fn(async () => ({ id: 1 }));
    const listLocalGeos = vi
      .fn()
      .mockResolvedValueOnce({ items: [localGeo] })
      .mockResolvedValueOnce({ items: [] });
    const deleteLocalGeo = vi.fn(async () => undefined);
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listRemarketingCounters: vi.fn(),
        listGoals: vi.fn(),
        listRemarketingInAppEvents: vi.fn(),
        listRemarketingPricelists: vi.fn(),
        createRemarketingPricelist: vi.fn(),
        listLocalGeos,
        createLocalGeo: vi.fn(),
        updateLocalGeo: vi.fn(),
        deleteLocalGeo,
        listAdPlans: vi.fn(),
        listAdGroups: vi.fn(),
        getAdPlan: vi.fn(),
        createAdPlan: vi.fn(),
        updateAdPlan: vi.fn(),
        massUpdateAdPlans: vi.fn(),
        getAdGroup: vi.fn(),
        createAdGroup: vi.fn(),
        updateAdGroup: vi.fn(),
        deleteAdGroup: vi.fn(),
        massUpdateAdGroups: vi.fn(),
        getBanner: vi.fn(),
        listBanners: vi.fn(),
        createBanner: vi.fn(),
        updateBanner: vi.fn(),
        deleteBanner: vi.fn(),
        massUpdateBanners: vi.fn(),
        remoderateBanners: vi.fn(),
        uploadHtml5Content: vi.fn(),
        uploadStaticContent: vi.fn(),
        uploadVideoContent: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: LOCAL_GEO_DELETE_TOOL,
          arguments: {
            id: localGeo.id,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          deleted: true,
          verified: true,
          auditRecorded: true,
          id: localGeo.id,
        },
      });
      expect(getCurrentUser).toHaveBeenCalledTimes(1);
      expect(deleteLocalGeo).toHaveBeenCalledWith(localGeo.id);
      expect(listLocalGeos).toHaveBeenCalledTimes(2);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "local_geo.delete",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns a normalized ad-plans page", async () => {
    const getCurrentUser = vi.fn();
    const getAdPlan = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const getAdGroup = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const massUpdateBanners = vi.fn();
    const deleteBanner = vi.fn();
    const updateBanner = vi.fn();
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi.fn();
    const listAdGroups = vi.fn();
    const listAdPlans = vi.fn(async () => ({
      count: 1,
      offset: 5,
      items: [
        {
          id: 123,
          name: "Тестовая кампания",
          status: "blocked" as const,
        },
      ],
    }));
    const server = createVkAdsMcpServer({
      getCurrentUser,
      listAdPlans,
      listAdGroups,
      getAdPlan,
      createAdPlan,
      updateAdPlan,
      massUpdateAdPlans,
      getAdGroup,
      createAdGroup,
      updateAdGroup,
      deleteAdGroup,
      massUpdateAdGroups,
      getBanner,
      listBanners,
      createBanner,
      updateBanner,
      deleteBanner,
      massUpdateBanners,
      remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
    });
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: AD_PLANS_LIST_TOOL,
          arguments: {
            limit: 10,
            offset: 5,
            status: "blocked",
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          count: 1,
          offset: 5,
          items: [
            {
              id: 123,
              name: "Тестовая кампания",
              status: "blocked",
            },
          ],
        },
      });
      expect(listAdPlans).toHaveBeenCalledWith({
        limit: 10,
        offset: 5,
        status: "blocked",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns a normalized ad-groups page", async () => {
    const getCurrentUser = vi.fn();
    const listAdPlans = vi.fn();
    const getAdPlan = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const getAdGroup = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const massUpdateBanners = vi.fn();
    const deleteBanner = vi.fn();
    const updateBanner = vi.fn();
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi.fn();
    const listAdGroups = vi.fn(async () => ({
      count: 1,
      offset: 5,
      items: [
        {
          id: 321,
          name: "Группа объявлений",
          status: "deleted" as const,
          adPlanId: 123,
          packageId: 42,
        },
      ],
    }));
    const server = createVkAdsMcpServer({
      getCurrentUser,
      listAdPlans,
      listAdGroups,
      getAdPlan,
      createAdPlan,
      updateAdPlan,
      massUpdateAdPlans,
      getAdGroup,
      createAdGroup,
      updateAdGroup,
      deleteAdGroup,
      massUpdateAdGroups,
      getBanner,
      listBanners,
      createBanner,
      updateBanner,
      deleteBanner,
      massUpdateBanners,
      remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
    });
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: AD_GROUPS_LIST_TOOL,
          arguments: {
            limit: 10,
            offset: 5,
            statuses: ["blocked", "deleted"],
            sorting: ["status", "-id"],
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          count: 1,
          offset: 5,
          items: [
            {
              id: 321,
              name: "Группа объявлений",
              status: "deleted",
              adPlanId: 123,
              packageId: 42,
            },
          ],
        },
      });
      expect(listAdGroups).toHaveBeenCalledWith({
        limit: 10,
        offset: 5,
        statuses: ["blocked", "deleted"],
        sorting: ["status", "-id"],
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns one normalized ad group", async () => {
    const getCurrentUser = vi.fn();
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const getAdPlan = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const massUpdateBanners = vi.fn();
    const deleteBanner = vi.fn();
    const updateBanner = vi.fn();
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi.fn();
    const getAdGroup = vi.fn(async () => ({
      id: 321,
      name: "Группа объявлений",
      status: "deleted" as const,
      adPlanId: 123,
      packageId: 42,
    }));
    const server = createVkAdsMcpServer({
      getCurrentUser,
      listAdPlans,
      listAdGroups,
      getAdPlan,
      createAdPlan,
      updateAdPlan,
      massUpdateAdPlans,
      getAdGroup,
      createAdGroup,
      updateAdGroup,
      deleteAdGroup,
      massUpdateAdGroups,
      getBanner,
      listBanners,
      createBanner,
      updateBanner,
      deleteBanner,
      massUpdateBanners,
      remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
    });
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: AD_GROUP_GET_TOOL,
          arguments: {
            id: 321,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          id: 321,
          name: "Группа объявлений",
          status: "deleted",
          adPlanId: 123,
          packageId: 42,
        },
      });
      expect(getAdGroup).toHaveBeenCalledWith(321);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns a normalized banners page", async () => {
    const getCurrentUser = vi.fn();
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const getAdPlan = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const getAdGroup = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const getBanner = vi.fn();
    const listBanners = vi.fn(async () => ({
      count: 1,
      offset: 5,
      items: [
        {
          id: 987,
          adGroupId: 321,
          name: "Test banner",
          status: "deleted" as const,
          moderationStatus: "pending" as const,
        },
      ],
    }));
    const createBanner = vi.fn();
    const updateBanner = vi.fn();
    const deleteBanner = vi.fn();
    const massUpdateBanners = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const server = createVkAdsMcpServer({
      getCurrentUser,
      listAdPlans,
      listAdGroups,
      getAdPlan,
      createAdPlan,
      updateAdPlan,
      massUpdateAdPlans,
      getAdGroup,
      createAdGroup,
      updateAdGroup,
      deleteAdGroup,
      massUpdateAdGroups,
      getBanner,
      listBanners,
      createBanner,
      updateBanner,
      deleteBanner,
      massUpdateBanners,
      remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
    });
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: BANNERS_LIST_TOOL,
          arguments: {
            limit: 10,
            offset: 5,
            adGroupStatus: "deleted",
            statuses: ["blocked", "deleted"],
            updatedGte: "2026-07-01 00:00:00",
            url: "example.test",
            textblock: "test",
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
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
        },
      });
      expect(listBanners).toHaveBeenCalledWith({
        limit: 10,
        offset: 5,
        adGroupStatus: "deleted",
        statuses: ["blocked", "deleted"],
        updatedGte: "2026-07-01 00:00:00",
        url: "example.test",
        textblock: "test",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns one sanitized banner", async () => {
    const getCurrentUser = vi.fn();
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const getAdPlan = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const getAdGroup = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const massUpdateBanners = vi.fn();
    const deleteBanner = vi.fn();
    const updateBanner = vi.fn();
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi.fn(async () => ({
      id: 987,
      adGroupId: 321,
      name: "Test banner",
      status: "blocked" as const,
      moderationStatus: "pending" as const,
    }));
    const server = createVkAdsMcpServer({
      getCurrentUser,
      listAdPlans,
      listAdGroups,
      getAdPlan,
      createAdPlan,
      updateAdPlan,
      massUpdateAdPlans,
      getAdGroup,
      createAdGroup,
      updateAdGroup,
      deleteAdGroup,
      massUpdateAdGroups,
      getBanner,
      listBanners,
      createBanner,
      updateBanner,
      deleteBanner,
      massUpdateBanners,
      remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
    });
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: BANNER_GET_TOOL,
          arguments: {
            id: 987,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          id: 987,
          adGroupId: 321,
          name: "Test banner",
          status: "blocked",
          moderationStatus: "pending",
        },
      });
      expect(getBanner).toHaveBeenCalledWith(987);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preflights, creates, rereads, and audits one banner", async () => {
    const getCurrentUser = vi.fn(async () => ({
      id: 1,
    }));
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const getAdPlan = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const getAdGroup = vi.fn(async () => ({
      id: 321,
      name: "Existing group",
      status: "blocked" as const,
      adPlanId: 123,
      packageId: 3122,
    }));
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const createBanner = vi.fn(async () => ({
      id: 987,
    }));
    const updateBanner = vi.fn();
    const deleteBanner = vi.fn();
    const massUpdateBanners = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi.fn(async () => ({
      id: 987,
      adGroupId: 321,
      name: "Test banner",
      status: "blocked" as const,
      moderationStatus: "pending" as const,
      content: {
        image_600x600: {
          id: 456,
          variants: {
            original: {
              width: 600,
              height: 600,
            },
          },
        },
      },
      textblocks: {
        title_40_vkads: {
          text: "Test title",
        },
      },
      urls: {
        primary: {
          id: 789,
          url: "https://example.test",
        },
      },
    }));
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listAdPlans,
        listAdGroups,
        getAdPlan,
        createAdPlan,
        updateAdPlan,
        massUpdateAdPlans,
        getAdGroup,
        createAdGroup,
        updateAdGroup,
        deleteAdGroup,
        massUpdateAdGroups,
        getBanner,
      listBanners,
        createBanner,
        updateBanner,
        deleteBanner,
        massUpdateBanners,
        remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: BANNER_CREATE_TOOL,
          arguments: {
            adGroupId: 321,
            name: "Test banner",
            status: "blocked",
            content: {
              image_600x600: {
                id: 456,
              },
            },
            textblocks: {
              title_40_vkads: {
                text: "Test title",
              },
            },
            urls: {
              primary: {
                id: 789,
              },
            },
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          created: true,
          verified: true,
          auditRecorded: true,
          id: 987,
          banner: {
            id: 987,
            adGroupId: 321,
            name: "Test banner",
            status: "blocked",
            moderationStatus: "pending",
          },
        },
      });
      expect(getCurrentUser).toHaveBeenCalledTimes(1);
      expect(getAdGroup).toHaveBeenCalledWith(321);
      expect(createBanner).toHaveBeenCalledWith(321, {
        name: "Test banner",
        status: "blocked",
        content: {
          image_600x600: {
            id: 456,
          },
        },
        textblocks: {
          title_40_vkads: {
            text: "Test title",
          },
        },
        urls: {
          primary: {
            id: 789,
          },
        },
      });
      expect(getBanner).toHaveBeenCalledWith(987);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "banners.create",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preflights, updates, rereads, and audits one banner", async () => {
    const getCurrentUser = vi.fn();
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const getAdPlan = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const getAdGroup = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const massUpdateBanners = vi.fn();
    const deleteBanner = vi.fn();
    const updateBanner = vi.fn(async () => undefined);
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi
      .fn()
      .mockResolvedValueOnce({
        id: 987,
        adGroupId: 321,
        name: "Old banner",
        status: "blocked" as const,
      })
      .mockResolvedValueOnce({
        id: 987,
        adGroupId: 321,
        name: "Updated banner",
        status: "blocked" as const,
        moderationStatus: "pending" as const,
        urls: {
          vk_post: {
            id: 123,
            url: "https://example.test/post",
          },
        },
      });
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listAdPlans,
        listAdGroups,
        getAdPlan,
        createAdPlan,
        updateAdPlan,
        massUpdateAdPlans,
        getAdGroup,
        createAdGroup,
        updateAdGroup,
        deleteAdGroup,
        massUpdateAdGroups,
        getBanner,
      listBanners,
      createBanner,
        updateBanner,
        deleteBanner,
      massUpdateBanners,
      remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: BANNER_UPDATE_TOOL,
          arguments: {
            id: 987,
            name: "Updated banner",
            urls: {
              vk_post: {
                id: 123,
              },
            },
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          updated: true,
          verified: true,
          auditRecorded: true,
          id: 987,
          banner: {
            id: 987,
            adGroupId: 321,
            name: "Updated banner",
            status: "blocked",
            moderationStatus: "pending",
          },
        },
      });
      expect(getBanner).toHaveBeenNthCalledWith(1, 987);
      expect(updateBanner).toHaveBeenCalledWith(987, {
        name: "Updated banner",
        urls: {
          vk_post: {
            id: 123,
          },
        },
      });
      expect(getBanner).toHaveBeenNthCalledWith(2, 987);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "banners.update",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preflights, deletes, rereads, and audits one banner", async () => {
    const getCurrentUser = vi.fn();
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const getAdPlan = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const getAdGroup = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const updateBanner = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const massUpdateBanners = vi.fn();
    const deleteBanner = vi.fn(async () => undefined);
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi
      .fn()
      .mockResolvedValueOnce({
        id: 987,
        adGroupId: 321,
        name: "Test banner",
        status: "blocked" as const,
      })
      .mockResolvedValueOnce({
        id: 987,
        adGroupId: 321,
        name: "Test banner",
        status: "deleted" as const,
        moderationStatus: "pending" as const,
      });
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listAdPlans,
        listAdGroups,
        getAdPlan,
        createAdPlan,
        updateAdPlan,
        massUpdateAdPlans,
        getAdGroup,
        createAdGroup,
        updateAdGroup,
        deleteAdGroup,
        massUpdateAdGroups,
        getBanner,
      listBanners,
      createBanner,
        updateBanner,
        deleteBanner,
      massUpdateBanners,
      remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: BANNER_DELETE_TOOL,
          arguments: {
            id: 987,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          deleted: true,
          verified: true,
          auditRecorded: true,
          id: 987,
          banner: {
            id: 987,
            adGroupId: 321,
            name: "Test banner",
            status: "deleted",
            moderationStatus: "pending",
          },
        },
      });
      expect(getBanner).toHaveBeenNthCalledWith(1, 987);
      expect(deleteBanner).toHaveBeenCalledWith(987);
      expect(getBanner).toHaveBeenNthCalledWith(2, 987);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "banners.delete",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preflights, mass-updates, rereads, and audits banners", async () => {
    const getCurrentUser = vi.fn();
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const getAdPlan = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const getAdGroup = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const updateBanner = vi.fn();
    const deleteBanner = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const massUpdateBanners = vi.fn(async () => undefined);
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi
      .fn()
      .mockResolvedValueOnce({
        id: 987,
        adGroupId: 321,
        name: "Banner one",
        status: "blocked" as const,
      })
      .mockResolvedValueOnce({
        id: 988,
        adGroupId: 322,
        name: "Banner two",
        status: "blocked" as const,
      })
      .mockResolvedValueOnce({
        id: 987,
        adGroupId: 321,
        name: "Banner one",
        status: "deleted" as const,
        moderationStatus: "pending" as const,
      })
      .mockResolvedValueOnce({
        id: 988,
        adGroupId: 322,
        name: "Banner two",
        status: "deleted" as const,
        moderationStatus: "pending" as const,
      });
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listAdPlans,
        listAdGroups,
        getAdPlan,
        createAdPlan,
        updateAdPlan,
        massUpdateAdPlans,
        getAdGroup,
        createAdGroup,
        updateAdGroup,
        deleteAdGroup,
        massUpdateAdGroups,
        getBanner,
      listBanners,
      createBanner,
        updateBanner,
        deleteBanner,
        massUpdateBanners,
      remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: BANNERS_MASS_ACTION_TOOL,
          arguments: {
            changes: [
              { id: 987, status: "deleted" },
              { id: 988, status: "deleted" },
            ],
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          updated: true,
          verified: true,
          auditRecorded: true,
          requestedCount: 2,
          banners: [
            {
              id: 987,
              adGroupId: 321,
              name: "Banner one",
              status: "deleted",
              moderationStatus: "pending",
            },
            {
              id: 988,
              adGroupId: 322,
              name: "Banner two",
              status: "deleted",
              moderationStatus: "pending",
            },
          ],
        },
      });
      expect(massUpdateBanners).toHaveBeenCalledWith([
        { id: 987, status: "deleted" },
        { id: 988, status: "deleted" },
      ]);
      expect(getBanner).toHaveBeenCalledTimes(4);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "banners.mass_action",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preflights, requests remoderation, rereads, and audits banners", async () => {
    const getCurrentUser = vi.fn();
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const getAdPlan = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const getAdGroup = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const updateBanner = vi.fn();
    const deleteBanner = vi.fn();
    const massUpdateBanners = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn(async () => [
      { id: 987, remoderated: true },
      { id: 988, remoderated: false },
    ]);
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi
      .fn()
      .mockResolvedValueOnce({
        id: 987,
        adGroupId: 321,
        status: "blocked" as const,
        moderationStatus: "banned" as const,
      })
      .mockResolvedValueOnce({
        id: 988,
        adGroupId: 322,
        status: "blocked" as const,
        moderationStatus: "allowed" as const,
      })
      .mockResolvedValueOnce({
        id: 987,
        adGroupId: 321,
        status: "blocked" as const,
        moderationStatus: "pending" as const,
      })
      .mockResolvedValueOnce({
        id: 988,
        adGroupId: 322,
        status: "blocked" as const,
        moderationStatus: "allowed" as const,
      });
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listAdPlans,
        listAdGroups,
        getAdPlan,
        createAdPlan,
        updateAdPlan,
        massUpdateAdPlans,
        getAdGroup,
        createAdGroup,
        updateAdGroup,
        deleteAdGroup,
        massUpdateAdGroups,
        getBanner,
      listBanners,
      createBanner,
        updateBanner,
        deleteBanner,
        massUpdateBanners,
        remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: BANNERS_REMODERATE_TOOL,
          arguments: {
            ids: [987, 988],
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          requested: true,
          verified: true,
          auditRecorded: true,
          requestedCount: 2,
          allRemoderated: false,
          results: [
            { id: 987, remoderated: true },
            { id: 988, remoderated: false },
          ],
          banners: [
            {
              id: 987,
              adGroupId: 321,
              status: "blocked",
              moderationStatus: "pending",
            },
            {
              id: 988,
              adGroupId: 322,
              status: "blocked",
              moderationStatus: "allowed",
            },
          ],
        },
      });
      expect(remoderateBanners).toHaveBeenCalledWith([987, 988]);
      expect(getBanner).toHaveBeenCalledTimes(4);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "banners.remoderate",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preflights, uploads, validates, and audits HTML5 content", async () => {
    const fixtureDirectory = await mkdtemp(
      join(tmpdir(), "vk-ads-html5-test-"),
    );
    const filePath = join(fixtureDirectory, "creative.zip");
    await writeFile(filePath, "zip-data");
    const getCurrentUser = vi.fn(async () => ({
      id: 1,
    }));
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const getAdPlan = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const getAdGroup = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi.fn();
    const createBanner = vi.fn();
    const updateBanner = vi.fn();
    const deleteBanner = vi.fn();
    const massUpdateBanners = vi.fn();
    const remoderateBanners = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn(async () => ({
      id: 1084236,
      variants: {
        original: {
          width: 300,
          height: 250,
          size: 2048,
        },
      },
    }));
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listAdPlans,
        listAdGroups,
        getAdPlan,
        createAdPlan,
        updateAdPlan,
        massUpdateAdPlans,
        getAdGroup,
        createAdGroup,
        updateAdGroup,
        deleteAdGroup,
        massUpdateAdGroups,
        listBanners,
        getBanner,
        createBanner,
        updateBanner,
        deleteBanner,
        massUpdateBanners,
        remoderateBanners,
        uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: CONTENT_HTML5_UPLOAD_TOOL,
          arguments: {
            filePath,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          uploaded: true,
          verified: true,
          auditRecorded: true,
          id: 1084236,
          variants: {
            original: {
              width: 300,
              height: 250,
              size: 2048,
            },
          },
        },
      });
      expect(getCurrentUser).toHaveBeenCalledTimes(1);
      expect(uploadHtml5Content).toHaveBeenCalledWith(
        expect.any(Blob),
        "creative.zip",
      );
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "content.html5.upload",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
      await rm(fixtureDirectory, {
        recursive: true,
        force: true,
      });
    }
  });

  it("preflights, uploads, validates, and audits static content", async () => {
    const fixtureDirectory = await mkdtemp(
      join(tmpdir(), "vk-ads-static-test-"),
    );
    const filePath = join(fixtureDirectory, "creative.png");
    await writeFile(filePath, "png-data");
    const getCurrentUser = vi.fn(async () => ({
      id: 1,
    }));
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const getAdPlan = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const getAdGroup = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi.fn();
    const createBanner = vi.fn();
    const updateBanner = vi.fn();
    const deleteBanner = vi.fn();
    const massUpdateBanners = vi.fn();
    const remoderateBanners = vi.fn();
    const uploadHtml5Content = vi.fn();
    const uploadStaticContent = vi.fn(async () => ({
      id: 1084237,
      variants: {
        original: {
          width: 300,
          height: 250,
          size: 4096,
        },
      },
    }));
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listAdPlans,
        listAdGroups,
        getAdPlan,
        createAdPlan,
        updateAdPlan,
        massUpdateAdPlans,
        getAdGroup,
        createAdGroup,
        updateAdGroup,
        deleteAdGroup,
        massUpdateAdGroups,
        listBanners,
        getBanner,
        createBanner,
        updateBanner,
        deleteBanner,
        massUpdateBanners,
        remoderateBanners,
        uploadHtml5Content,
        uploadStaticContent,
        uploadVideoContent: vi.fn(),
        listRemarketingCounters: vi.fn(),
        listGoals: vi.fn(),
        listRemarketingInAppEvents: vi.fn(),
        listRemarketingPricelists: vi.fn(),
        createRemarketingPricelist: vi.fn(),
        listLocalGeos: vi.fn(),
        createLocalGeo: vi.fn(),
        updateLocalGeo: vi.fn(),
        deleteLocalGeo: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: CONTENT_STATIC_UPLOAD_TOOL,
          arguments: {
            filePath,
            width: 300,
            height: 250,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          uploaded: true,
          verified: true,
          auditRecorded: true,
          id: 1084237,
          variants: {
            original: {
              width: 300,
              height: 250,
              size: 4096,
            },
          },
        },
      });
      expect(getCurrentUser).toHaveBeenCalledTimes(1);
      expect(uploadStaticContent).toHaveBeenCalledWith(
        expect.any(Blob),
        "creative.png",
        300,
        250,
      );
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "content.static.upload",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
      await rm(fixtureDirectory, {
        recursive: true,
        force: true,
      });
    }
  });

  it("preflights, uploads, validates, and audits video content", async () => {
    const fixtureDirectory = await mkdtemp(
      join(tmpdir(), "vk-ads-video-test-"),
    );
    const filePath = join(fixtureDirectory, "creative.mp4");
    await writeFile(filePath, "mp4-data");
    const getCurrentUser = vi.fn(async () => ({
      id: 1,
    }));
    const uploadVideoContent = vi.fn(async () => ({
      id: 1084238,
      variants: {
        original: {
          width: 640,
          height: 360,
          size: 8192,
        },
      },
    }));
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listAdPlans: vi.fn(),
        listAdGroups: vi.fn(),
        getAdPlan: vi.fn(),
        createAdPlan: vi.fn(),
        updateAdPlan: vi.fn(),
        massUpdateAdPlans: vi.fn(),
        getAdGroup: vi.fn(),
        createAdGroup: vi.fn(),
        updateAdGroup: vi.fn(),
        deleteAdGroup: vi.fn(),
        massUpdateAdGroups: vi.fn(),
        listBanners: vi.fn(),
        getBanner: vi.fn(),
        createBanner: vi.fn(),
        updateBanner: vi.fn(),
        deleteBanner: vi.fn(),
        massUpdateBanners: vi.fn(),
        remoderateBanners: vi.fn(),
        uploadHtml5Content: vi.fn(),
        uploadStaticContent: vi.fn(),
        uploadVideoContent,
        listRemarketingCounters: vi.fn(),
        listGoals: vi.fn(),
        listRemarketingInAppEvents: vi.fn(),
        listRemarketingPricelists: vi.fn(),
        createRemarketingPricelist: vi.fn(),
        listLocalGeos: vi.fn(),
        createLocalGeo: vi.fn(),
        updateLocalGeo: vi.fn(),
        deleteLocalGeo: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: CONTENT_VIDEO_UPLOAD_TOOL,
          arguments: {
            filePath,
            width: 640,
            height: 360,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          uploaded: true,
          verified: true,
          auditRecorded: true,
          id: 1084238,
          variants: {
            original: {
              width: 640,
              height: 360,
              size: 8192,
            },
          },
        },
      });
      expect(getCurrentUser).toHaveBeenCalledTimes(1);
      expect(uploadVideoContent).toHaveBeenCalledWith(
        expect.any(Blob),
        "creative.mp4",
        640,
        360,
      );
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "content.video.upload",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
      await rm(fixtureDirectory, {
        recursive: true,
        force: true,
      });
    }
  });

  it("creates, rereads, and audits one ad group", async () => {
    const getCurrentUser = vi.fn(async () => ({
      id: 1,
    }));
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const getAdPlan = vi.fn(async () => ({
      id: 123,
      name: "Campaign",
      status: "blocked" as const,
    }));
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const createAdGroup = vi.fn(async () => ({
      id: 321,
      bannerIds: [],
    }));
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const massUpdateBanners = vi.fn();
    const deleteBanner = vi.fn();
    const updateBanner = vi.fn();
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi.fn();
    const getAdGroup = vi.fn(async () => ({
      id: 321,
      name: "Regular group",
      status: "blocked" as const,
      adPlanId: 123,
      packageId: 42,
    }));
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listAdPlans,
        listAdGroups,
        getAdPlan,
        createAdPlan,
        updateAdPlan,
        massUpdateAdPlans,
        getAdGroup,
        createAdGroup,
        updateAdGroup,
        deleteAdGroup,
        massUpdateAdGroups,
        getBanner,
      listBanners,
      createBanner,
        updateBanner,
        deleteBanner,
      massUpdateBanners,
      remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: AD_GROUP_CREATE_TOOL,
          arguments: {
            name: "Regular group",
            packageId: 42,
            adPlanId: 123,
            status: "blocked",
            objective: "traffic",
            targetings: {
              pads: [1],
            },
            packageFields: {
              custom_package_field: true,
            },
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          created: true,
          verified: true,
          auditRecorded: true,
          id: 321,
          bannerIds: [],
          group: {
            id: 321,
            status: "blocked",
            adPlanId: 123,
            packageId: 42,
          },
        },
      });
      expect(getCurrentUser).toHaveBeenCalledTimes(1);
      expect(getAdPlan).toHaveBeenCalledWith(123);
      expect(createAdGroup).toHaveBeenCalledWith({
        custom_package_field: true,
        name: "Regular group",
        package_id: 42,
        ad_plan_id: 123,
        status: "blocked",
        objective: "traffic",
        targetings: {
          pads: [1],
        },
      });
      expect(getAdGroup).toHaveBeenCalledWith(321);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "ad_groups.create",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preflights, updates, rereads, and audits one ad group", async () => {
    const getCurrentUser = vi.fn();
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const getAdPlan = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn(async () => undefined);
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const massUpdateBanners = vi.fn();
    const deleteBanner = vi.fn();
    const updateBanner = vi.fn();
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi.fn();
    const getAdGroup = vi
      .fn()
      .mockResolvedValueOnce({
        id: 321,
        name: "Old group",
        status: "blocked" as const,
        adPlanId: 123,
        packageId: 42,
      })
      .mockResolvedValueOnce({
        id: 321,
        name: "New group",
        status: "blocked" as const,
        adPlanId: 123,
        packageId: 42,
      });
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listAdPlans,
        listAdGroups,
        getAdPlan,
        createAdPlan,
        updateAdPlan,
        massUpdateAdPlans,
        getAdGroup,
        createAdGroup,
        updateAdGroup,
        deleteAdGroup,
        massUpdateAdGroups,
        getBanner,
      listBanners,
      createBanner,
        updateBanner,
        deleteBanner,
      massUpdateBanners,
      remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: AD_GROUP_UPDATE_TOOL,
          arguments: {
            id: 321,
            name: "New group",
            packageFields: {
              custom_package_field: true,
            },
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          updated: true,
          verified: true,
          auditRecorded: true,
          id: 321,
          group: {
            id: 321,
            name: "New group",
            status: "blocked",
            adPlanId: 123,
            packageId: 42,
          },
        },
      });
      expect(getAdGroup).toHaveBeenNthCalledWith(1, 321);
      expect(updateAdGroup).toHaveBeenCalledWith(321, {
        custom_package_field: true,
        name: "New group",
      });
      expect(getAdGroup).toHaveBeenNthCalledWith(2, 321);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "ad_groups.update",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preflights, deletes, rereads, and audits one ad group", async () => {
    const getCurrentUser = vi.fn();
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const getAdPlan = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn(async () => undefined);
    const massUpdateAdGroups = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const massUpdateBanners = vi.fn();
    const deleteBanner = vi.fn();
    const updateBanner = vi.fn();
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi.fn();
    const getAdGroup = vi
      .fn()
      .mockResolvedValueOnce({
        id: 321,
        name: "Temporary group",
        status: "blocked" as const,
        adPlanId: 123,
        packageId: 42,
      })
      .mockResolvedValueOnce({
        id: 321,
        name: "Temporary group",
        status: "deleted" as const,
        adPlanId: 123,
        packageId: 42,
      });
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listAdPlans,
        listAdGroups,
        getAdPlan,
        createAdPlan,
        updateAdPlan,
        massUpdateAdPlans,
        getAdGroup,
        createAdGroup,
        updateAdGroup,
        deleteAdGroup,
        massUpdateAdGroups,
        getBanner,
      listBanners,
      createBanner,
        updateBanner,
        deleteBanner,
      massUpdateBanners,
      remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: AD_GROUP_DELETE_TOOL,
          arguments: {
            id: 321,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          deleted: true,
          verified: true,
          auditRecorded: true,
          id: 321,
          group: {
            id: 321,
            name: "Temporary group",
            status: "deleted",
            adPlanId: 123,
            packageId: 42,
          },
        },
      });
      expect(getAdGroup).toHaveBeenNthCalledWith(1, 321);
      expect(deleteAdGroup).toHaveBeenCalledWith(321);
      expect(getAdGroup).toHaveBeenNthCalledWith(2, 321);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "ad_groups.delete",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preflights, mass-updates, rereads, and audits ad groups", async () => {
    const getCurrentUser = vi.fn();
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const getAdPlan = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn(async () => undefined);
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const massUpdateBanners = vi.fn();
    const deleteBanner = vi.fn();
    const updateBanner = vi.fn();
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi.fn();
    const getAdGroup = vi
      .fn()
      .mockResolvedValueOnce({
        id: 321,
        name: "Group A",
        status: "blocked" as const,
        adPlanId: 123,
        packageId: 42,
        maxPrice: "10",
      })
      .mockResolvedValueOnce({
        id: 654,
        name: "Group B",
        status: "blocked" as const,
        adPlanId: 123,
        packageId: 42,
        maxPrice: "20",
      })
      .mockResolvedValueOnce({
        id: 321,
        name: "Group A",
        status: "deleted" as const,
        adPlanId: 123,
        packageId: 42,
        maxPrice: "10",
      })
      .mockResolvedValueOnce({
        id: 654,
        name: "Group B",
        status: "blocked" as const,
        adPlanId: 123,
        packageId: 42,
        maxPrice: "25.00",
      });
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listAdPlans,
        listAdGroups,
        getAdPlan,
        createAdPlan,
        updateAdPlan,
        massUpdateAdPlans,
        getAdGroup,
        createAdGroup,
        updateAdGroup,
        deleteAdGroup,
        massUpdateAdGroups,
        getBanner,
      listBanners,
      createBanner,
        updateBanner,
        deleteBanner,
      massUpdateBanners,
      remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: AD_GROUPS_MASS_ACTION_TOOL,
          arguments: {
            changes: [
              {
                id: 321,
                status: "deleted",
              },
              {
                id: 654,
                max_price: "25",
              },
            ],
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          updated: true,
          verified: true,
          auditRecorded: true,
          requestedCount: 2,
          groups: [
            {
              id: 321,
              status: "deleted",
            },
            {
              id: 654,
              status: "blocked",
              maxPrice: "25.00",
            },
          ],
        },
      });
      expect(getAdGroup).toHaveBeenCalledTimes(4);
      expect(massUpdateAdGroups).toHaveBeenCalledWith([
        {
          id: 321,
          status: "deleted",
        },
        {
          id: 654,
          max_price: "25",
        },
      ]);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "ad_groups.mass_action",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("returns one normalized ad plan", async () => {
    const getCurrentUser = vi.fn();
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const getAdGroup = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const massUpdateBanners = vi.fn();
    const deleteBanner = vi.fn();
    const updateBanner = vi.fn();
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi.fn();
    const getAdPlan = vi.fn(async () => ({
      id: 123,
      name: "Тестовая кампания",
      status: "deleted" as const,
    }));
    const server = createVkAdsMcpServer({
      getCurrentUser,
      listAdPlans,
      listAdGroups,
      getAdPlan,
      createAdPlan,
      updateAdPlan,
      massUpdateAdPlans,
      getAdGroup,
      createAdGroup,
      updateAdGroup,
      deleteAdGroup,
      massUpdateAdGroups,
      getBanner,
      listBanners,
      createBanner,
      updateBanner,
      deleteBanner,
      massUpdateBanners,
      remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
    });
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: AD_PLAN_GET_TOOL,
          arguments: {
            id: 123,
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          id: 123,
          name: "Тестовая кампания",
          status: "deleted",
        },
      });
      expect(getAdPlan).toHaveBeenCalledWith(123);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("creates, rereads, and audits one ad plan", async () => {
    const getCurrentUser = vi.fn(async () => ({
      id: 1,
    }));
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const createAdPlan = vi.fn(async () => ({
      id: 123,
    }));
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn();
    const getAdGroup = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const massUpdateBanners = vi.fn();
    const deleteBanner = vi.fn();
    const updateBanner = vi.fn();
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi.fn();
    const getAdPlan = vi.fn(async () => ({
      id: 123,
      name: "Обычная кампания",
      status: "blocked" as const,
    }));
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listAdPlans,
        listAdGroups,
        getAdPlan,
        createAdPlan,
        updateAdPlan,
        massUpdateAdPlans,
        getAdGroup,
        createAdGroup,
        updateAdGroup,
        deleteAdGroup,
        massUpdateAdGroups,
        getBanner,
      listBanners,
      createBanner,
        updateBanner,
        deleteBanner,
      massUpdateBanners,
      remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: AD_PLAN_CREATE_TOOL,
          arguments: {
            name: "Обычная кампания",
            status: "blocked",
            objective: "traffic",
            campaigns: [
              {
                name: "Обычная группа",
                status: "blocked",
                package_id: 42,
              },
            ],
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          created: true,
          verified: true,
          auditRecorded: true,
          id: 123,
          campaign: {
            id: 123,
            name: "Обычная кампания",
            status: "blocked",
          },
        },
      });
      expect(auditLog.ensureReady).toHaveBeenCalledTimes(1);
      expect(getCurrentUser).toHaveBeenCalledTimes(1);
      expect(createAdPlan).toHaveBeenCalledWith({
        name: "Обычная кампания",
        status: "blocked",
        objective: "traffic",
        campaigns: [
          {
            name: "Обычная группа",
            status: "blocked",
            package_id: 42,
          },
        ],
      });
      expect(getAdPlan).toHaveBeenCalledWith(123);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "ad_plans.create",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preflights, updates, rereads, and audits one ad plan", async () => {
    const getCurrentUser = vi.fn();
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn(async () => undefined);
    const massUpdateAdPlans = vi.fn();
    const getAdGroup = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const massUpdateBanners = vi.fn();
    const deleteBanner = vi.fn();
    const updateBanner = vi.fn();
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi.fn();
    const getAdPlan = vi
      .fn()
      .mockResolvedValueOnce({
        id: 123,
        name: "Old name",
        status: "blocked" as const,
      })
      .mockResolvedValueOnce({
        id: 123,
        name: "New name",
        status: "blocked" as const,
      });
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listAdPlans,
        listAdGroups,
        getAdPlan,
        createAdPlan,
        updateAdPlan,
        massUpdateAdPlans,
        getAdGroup,
        createAdGroup,
        updateAdGroup,
        deleteAdGroup,
        massUpdateAdGroups,
        getBanner,
      listBanners,
      createBanner,
        updateBanner,
        deleteBanner,
      massUpdateBanners,
      remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: AD_PLAN_UPDATE_TOOL,
          arguments: {
            id: 123,
            name: "New name",
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          updated: true,
          verified: true,
          auditRecorded: true,
          id: 123,
          campaign: {
            id: 123,
            name: "New name",
            status: "blocked",
          },
        },
      });
      expect(auditLog.ensureReady).toHaveBeenCalledTimes(1);
      expect(getAdPlan).toHaveBeenNthCalledWith(1, 123);
      expect(updateAdPlan).toHaveBeenCalledWith(123, {
        name: "New name",
      });
      expect(getAdPlan).toHaveBeenNthCalledWith(2, 123);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "ad_plans.update",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("preflights, mass-updates, rereads, and audits ad plans", async () => {
    const getCurrentUser = vi.fn();
    const listAdPlans = vi.fn();
    const listAdGroups = vi.fn();
    const createAdPlan = vi.fn();
    const updateAdPlan = vi.fn();
    const massUpdateAdPlans = vi.fn(async () => undefined);
    const getAdGroup = vi.fn();
    const createAdGroup = vi.fn();
    const updateAdGroup = vi.fn();
    const deleteAdGroup = vi.fn();
    const massUpdateAdGroups = vi.fn();
    const uploadStaticContent = vi.fn();
    const uploadHtml5Content = vi.fn();
    const remoderateBanners = vi.fn();
    const massUpdateBanners = vi.fn();
    const deleteBanner = vi.fn();
    const updateBanner = vi.fn();
    const createBanner = vi.fn();
    const listBanners = vi.fn();
    const getBanner = vi.fn();
    const getAdPlan = vi
      .fn()
      .mockResolvedValueOnce({
        id: 123,
        name: "Campaign A",
        status: "blocked" as const,
      })
      .mockResolvedValueOnce({
        id: 456,
        name: "Campaign B",
        status: "blocked" as const,
      })
      .mockResolvedValueOnce({
        id: 123,
        name: "Campaign A",
        status: "deleted" as const,
      })
      .mockResolvedValueOnce({
        id: 456,
        name: "Campaign B",
        status: "deleted" as const,
      });
    const auditLog = {
      ensureReady: vi.fn(async () => undefined),
      record: vi.fn(async () => undefined),
    };
    const server = createVkAdsMcpServer(
      {
        getCurrentUser,
        listAdPlans,
        listAdGroups,
        getAdPlan,
        createAdPlan,
        updateAdPlan,
        massUpdateAdPlans,
        getAdGroup,
        createAdGroup,
        updateAdGroup,
        deleteAdGroup,
        massUpdateAdGroups,
        getBanner,
      listBanners,
      createBanner,
        updateBanner,
        deleteBanner,
      massUpdateBanners,
      remoderateBanners,
      uploadHtml5Content,
      uploadStaticContent,
      uploadVideoContent: vi.fn(),
      listRemarketingCounters: vi.fn(),
      listGoals: vi.fn(),
      listRemarketingInAppEvents: vi.fn(),
      listRemarketingPricelists: vi.fn(),
      createRemarketingPricelist: vi.fn(),
      listLocalGeos: vi.fn(),
      createLocalGeo: vi.fn(),
      updateLocalGeo: vi.fn(),
      deleteLocalGeo: vi.fn(),
      },
      auditLog,
    );
    const client = new Client({
      name: "vk-ads-mcp-unit-test",
      version: "0.1.0",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();

    try {
      await Promise.all([
        server.connect(serverTransport),
        client.connect(clientTransport),
      ]);

      await expect(
        client.callTool({
          name: AD_PLANS_MASS_ACTION_TOOL,
          arguments: {
            changes: [
              {
                id: 123,
                status: "deleted",
              },
              {
                id: 456,
                status: "deleted",
              },
            ],
          },
        }),
      ).resolves.toMatchObject({
        structuredContent: {
          updated: true,
          verified: true,
          auditRecorded: true,
          requestedCount: 2,
          campaigns: [
            {
              id: 123,
              status: "deleted",
            },
            {
              id: 456,
              status: "deleted",
            },
          ],
        },
      });
      expect(getAdPlan).toHaveBeenCalledTimes(4);
      expect(massUpdateAdPlans).toHaveBeenCalledWith([
        {
          id: 123,
          status: "deleted",
        },
        {
          id: 456,
          status: "deleted",
        },
      ]);
      expect(auditLog.record).toHaveBeenCalledWith({
        operation: "ad_plans.mass_action",
        outcome: "success",
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
