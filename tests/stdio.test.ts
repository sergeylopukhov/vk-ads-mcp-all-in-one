import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { COMMUNITY_TOOL_NAMES } from "../src/community/tools.js";
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
  BANNER_UPDATE_TOOL,
  BANNERS_LIST_TOOL,
  BANNERS_MASS_ACTION_TOOL,
  BANNERS_REMODERATE_TOOL,
  AD_PLAN_CREATE_TOOL,
  AD_PLAN_GET_TOOL,
  AD_PLAN_UPDATE_TOOL,
  AD_PLANS_MASS_ACTION_TOOL,
  AD_PLANS_LIST_TOOL,
  AD_REFERENCE_LIST_TOOL,
  CONNECTION_CHECK_TOOL,
  CONTENT_HTML5_UPLOAD_TOOL,
  CONTENT_STATIC_UPLOAD_TOOL,
  CONTENT_VIDEO_UPLOAD_TOOL,
  GOALS_LIST_TOOL,
  CURRENCIES_LIST_TOOL,
  LOCAL_GEO_CREATE_TOOL,
  LOCAL_GEO_DELETE_TOOL,
  LOCAL_GEO_UPDATE_TOOL,
  LOCAL_GEOS_LIST_TOOL,
  MOBILE_APPS_LIST_TOOL,
  MOBILE_REFERENCE_LIST_TOOL,
  MOBILE_STORE_APP_GET_TOOL,
  MOBILE_STORE_APP_REFRESH_TOOL,
  REMARKETING_IN_APP_EVENTS_LIST_TOOL,
  REMARKETING_IN_APP_EVENT_UPDATE_TOOL,
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
  SKAD_NETWORK_IDS_TRANSFER_TOOL,
  AUDIT_PIXEL_CHECK_TOOL,
  PROJECTION_PREDICT_TOOL,
  STATISTICS_DAY_LIST_TOOL,
  FAST_STATISTICS_GET_TOOL,
  V2_STATISTICS_GET_TOOL,
  GOAL_STATISTICS_GET_TOOL,
  IN_APP_STATISTICS_GET_TOOL,
  LEAD_FORM_COPY_TOOL,
  LEAD_FORM_CREATE_TOOL,
  LEAD_FORM_GET_TOOL,
  LEAD_FORM_LOGO_UPLOAD_TOOL,
  LEAD_FORM_UPDATE_TOOL,
  LEAD_FORMS_ARCHIVE_TOOL,
  LEAD_FORMS_LIST_TOOL,
  LEAD_FORMS_UNARCHIVE_TOOL,
  LEADS_LIST_TOOL,
  LEAD_FORM_LEADS_EXPORT_TOOL,
  LEAD_FORM_TEST_LEAD_SEND_TOOL,
  OFFLINE_CONVERSION_STATISTICS_DAY_GET_TOOL,
  OFFLINE_CONVERSION_STATISTICS_SUMMARY_GET_TOOL,
  OAUTH_CODE_INFO_TOOL,
  OAUTH_CURRENT_TOKENS_DELETE_TOOL,
  ORD_USER_STATUS_GET_TOOL,
  ORD_USER_UPDATE_TOOL,
  REMARKETING_COUNTERS_LIST_TOOL,
  REMARKETING_COUNTER_CREATE_TOOL,
  REMARKETING_COUNTER_GET_TOOL,
  REMARKETING_COUNTER_DELETE_TOOL,
  REMARKETING_COUNTER_GOAL_CREATE_TOOL,
  REMARKETING_COUNTER_GOAL_UPDATE_TOOL,
  REMARKETING_COUNTER_GOALS_LIST_TOOL,
  REMARKETING_COUNTER_UPDATE_TOOL,
  REMARKETING_PRICELIST_BATCH_CREATE_TOOL,
  REMARKETING_PRICELIST_BATCH_GET_TOOL,
  REMARKETING_PRICELIST_CREATE_TOOL,
  REMARKETING_PRICELISTS_LIST_TOOL,
  REGIONS_LIST_TOOL,
  RESPONDENTS_LIST_TOOL,
  SERVER_INFO,
  SUBSCRIPTION_CREATE_TOOL,
  SUBSCRIPTION_DELETE_TOOL,
  SUBSCRIPTIONS_LIST_TOOL,
  SURVEY_COPY_TOOL,
  SURVEY_CREATE_TOOL,
  SURVEY_GET_TOOL,
  SURVEY_RESPONDENTS_EXPORT_TOOL,
  SURVEY_UPDATE_TOOL,
  SURVEYS_ARCHIVE_TOOL,
  SURVEYS_LIST_TOOL,
  SURVEYS_UNARCHIVE_TOOL,
  TARGETINGS_TREE_GET_TOOL,
  THROTTLING_GET_TOOL,
  TRANSACTION_GROUPS_LIST_TOOL,
  URL_CREATE_TOOL,
  URL_GET_TOOL,
  URL_RESOLVE_TOOL,
  URLS_GET_TOOL,
  USER_LANGUAGE_UPDATE_TOOL,
  USER_PROFILE_GET_TOOL,
  USER_GEO_LIST_TOOL,
} from "../src/server.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const serverEntryPoint = fileURLToPath(
  new URL("../dist/index.js", import.meta.url),
);

describe("VK Ads MCP stdio server", () => {
  it("initializes and exposes the connection-check tool", async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntryPoint],
      cwd: packageRoot,
      stderr: "pipe",
    });
    const client = new Client(
      {
        name: "vk-ads-mcp-test-client",
        version: "0.1.0",
      },
      {
        capabilities: {},
      },
    );

    let stderr = "";
    transport.stderr?.on("data", (chunk: unknown) => {
      stderr += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
    });

    try {
      await client.connect(transport);

      expect(client.getServerVersion()).toEqual(SERVER_INFO);
      await expect(client.listTools()).resolves.toMatchObject({
        tools: [
          {
            name: OAUTH_CODE_INFO_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: OAUTH_CURRENT_TOKENS_DELETE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: CONNECTION_CHECK_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_COUNTERS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_COUNTER_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_COUNTER_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_COUNTER_UPDATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_COUNTER_DELETE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_COUNTER_GOALS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_COUNTER_GOAL_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_COUNTER_GOAL_UPDATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: GOALS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_IN_APP_EVENTS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_IN_APP_EVENT_UPDATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_OFFLINE_GOALS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_OFFLINE_GOAL_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_OFFLINE_GOAL_UPDATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_OFFLINE_GOAL_DELETE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_USERS_LISTS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_USERS_LIST_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_USERS_LIST_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_USERS_LIST_UPDATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_USERS_LIST_DELETE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: SEGMENTS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: SEGMENT_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: SEGMENT_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: SEGMENT_UPDATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: SEGMENT_DELETE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: SEGMENT_RELATIONS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: SEGMENT_RELATIONS_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: SEGMENT_RELATION_UPDATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: SEGMENT_RELATION_DELETE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: SHARING_KEYS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: SHARING_KEY_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: SHARING_KEY_ACTIVATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: SHARING_KEY_DELETE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: AUDIT_PIXEL_CHECK_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: PROJECTION_PREDICT_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: STATISTICS_DAY_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: FAST_STATISTICS_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: V2_STATISTICS_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: GOAL_STATISTICS_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: IN_APP_STATISTICS_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: OFFLINE_CONVERSION_STATISTICS_DAY_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: OFFLINE_CONVERSION_STATISTICS_SUMMARY_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: LEAD_FORM_LOGO_UPLOAD_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: LEAD_FORMS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: LEAD_FORM_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: LEAD_FORM_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: LEAD_FORM_UPDATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: LEAD_FORM_COPY_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: LEAD_FORMS_ARCHIVE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: LEAD_FORMS_UNARCHIVE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: LEADS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: LEAD_FORM_LEADS_EXPORT_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: LEAD_FORM_TEST_LEAD_SEND_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_PRICELISTS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_PRICELIST_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_PRICELIST_BATCH_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: REMARKETING_PRICELIST_BATCH_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: LOCAL_GEOS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: LOCAL_GEO_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: LOCAL_GEO_UPDATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: LOCAL_GEO_DELETE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: AD_PLANS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: AD_PLAN_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: AD_GROUPS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: AD_GROUP_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: BANNERS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: BANNER_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: BANNER_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: BANNER_UPDATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: BANNER_DELETE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: BANNERS_MASS_ACTION_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: BANNERS_REMODERATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: CONTENT_HTML5_UPLOAD_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: CONTENT_STATIC_UPLOAD_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: CONTENT_VIDEO_UPLOAD_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: AD_GROUP_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: AD_GROUP_UPDATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: AD_GROUP_DELETE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: AD_GROUPS_MASS_ACTION_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: AD_PLAN_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: AD_PLAN_UPDATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: AD_PLANS_MASS_ACTION_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: AD_REFERENCE_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: MOBILE_REFERENCE_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: CURRENCIES_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: MOBILE_APPS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: REGIONS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: TRANSACTION_GROUPS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: TARGETINGS_TREE_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: THROTTLING_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: URL_RESOLVE_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: URL_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: URL_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: URLS_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: MOBILE_STORE_APP_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: MOBILE_STORE_APP_REFRESH_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: SKAD_NETWORK_IDS_TRANSFER_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: USER_PROFILE_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: USER_LANGUAGE_UPDATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: ORD_USER_STATUS_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: ORD_USER_UPDATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: USER_GEO_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: SURVEYS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: SURVEY_GET_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: SURVEY_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: SURVEY_UPDATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: SURVEY_COPY_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: SURVEYS_ARCHIVE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: SURVEYS_UNARCHIVE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: RESPONDENTS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: SURVEY_RESPONDENTS_EXPORT_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: SUBSCRIPTIONS_LIST_TOOL,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: true,
            },
          },
          {
            name: SUBSCRIPTION_CREATE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: false,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          {
            name: SUBSCRIPTION_DELETE_TOOL,
            annotations: {
              readOnlyHint: false,
              destructiveHint: true,
              idempotentHint: false,
              openWorldHint: true,
            },
          },
          ...COMMUNITY_TOOL_NAMES.map((name) => ({ name })),
        ],
      });
      expect(stderr).toBe("");
    } finally {
      await client.close();
    }
  });
});
