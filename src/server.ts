import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { buildRecommendations, comparePeriods, detectAnomalies, diagnoseDelivery, findInefficientRows, rankRows, type AnalyticsRow } from "./analytics.js";
import type { ServerMode } from "./config.js";
import { statisticsToExportRows, toCsv, toXlsx, type ExportRow } from "./export.js";
import { searchCatalog, toolCatalog } from "./tool-catalog.js";
import { VERIFIED_AD_GROUP_FIELDS, VERIFIED_AD_PLAN_FIELDS, VERIFIED_BANNER_FIELDS, VkAdsApiError, VkAdsClient, type VkObject, type VkPagedResponse } from "./vk-client.js";
import { WriteGate, type TestWriteOperation } from "./write-gate.js";
import { validateHtml5Upload, validateImageUpload, validateLeadFormImageUpload, validateRemarketingUserListUpload, validateVideoUpload } from "./upload-policy.js";
import { validateConfirmedTestBannerDraft, type KnownStaticImage } from "./banner-preflight.js";
import { validateTestAdGroupParent, validateTestAdPlanDraft, type WritePreflightResult } from "./write-preflight.js";
import { validateAdvertisingDestination } from "./destination-policy.js";

const pagingSchema = {
  offset: z.number().int().nonnegative().default(0).describe("Смещение в списке."),
  limit: z.number().int().min(1).max(200).default(100).describe("Размер страницы, не более 200."),
};

const statisticsInputSchema = {
  object_type: z.enum(["ad_plans", "campaigns", "ad_groups", "banners", "users"]),
  period: z.enum(["summary", "day"]).default("summary"),
  ids: z.array(z.number().int()).max(50).optional(),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  metrics: z.string().default("base"),
};

const inAppStatisticsInputSchema = {
  object_type: z.enum(["ad_plans", "ad_groups", "banners", "users"]),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ids: z.array(z.number().int()).max(50).optional(),
  attribution: z.enum(["conversion", "impression"]).optional(),
  conversion_type: z.enum(["postclick", "postview", "total"]).optional(),
};

const offlineConversionStatisticsInputSchema = {
  object_type: z.enum(["ad_plans", "ad_groups", "users"]),
  ids: z.array(z.number().int().positive()).min(1).max(50),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};

const goalStatisticsInputSchema = {
  object_type: z.enum(["ad_plans", "ad_groups", "banners", "users"]).default("banners"),
  ids: z.array(z.number().int().positive()).min(1).max(50),
  date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
};

const reachForecastInputSchema = {
  package_ids: z.array(z.number().int().positive()).min(1).max(20).optional(),
  campaign_id: z.number().int().positive().optional(),
  targetings: z.object({
    pads: z.array(z.number().int().positive()).min(1).max(200),
    age: z.array(z.number().int().min(0).max(79)).max(80).optional(),
    interests: z.array(z.number().int()).max(200).optional(),
    interests_soc_dem: z.array(z.number().int()).max(200).optional(),
    interests_stable: z.array(z.number().int()).max(200).optional(),
    mobile_operation_systems: z.array(z.number().int()).max(50).optional(),
    mobile_operators: z.array(z.number().int()).max(100).optional(),
    mobile_types: z.array(z.string().min(1).max(80)).max(20).optional(),
    mobile_vendors: z.array(z.number().int()).max(100).optional(),
    regions: z.array(z.number().int()).max(200).optional(),
    sex: z.array(z.enum(["male", "female"])).min(1).max(2).optional(),
  }).strict(),
};

const callableReadTools = [
  "vk_status",
  "vk_get_user",
  "vk_get_ad_plans",
  "vk_get_ad_plan",
  "vk_get_campaigns",
  "vk_get_campaign",
  "vk_get_ad_groups",
  "vk_get_ad_group",
  "vk_get_banners",
  "vk_get_banner",
  "vk_get_urls",
  "vk_resolve_url",
  "vk_get_banner_patterns",
  "vk_get_banner_fields",
  "vk_get_statistics",
  "vk_get_goal_statistics",
  "vk_get_packages",
  "vk_get_package",
  "vk_get_package_fields",
  "vk_get_packages_pads",
  "vk_get_search_phrases",
  "vk_get_reach_forecast",
  "vk_get_currencies",
  "vk_get_remarketing_counters",
  "vk_get_remarketing_counter",
  "vk_get_counter_goals",
  "vk_get_remarketing_lists",
  "vk_get_remarketing_list",
  "vk_get_inapp_events",
  "vk_get_inapp_event_categories",
  "vk_get_inapp_stats",
  "vk_get_offline_conversions",
  "vk_get_realtime_stats",
  "vk_get_segments",
  "vk_get_segment",
  "vk_get_local_geos",
  "vk_get_throttling",
  "vk_get_targetings_tree",
  "vk_get_pads_tree",
  "vk_get_mobile_categories",
  "vk_get_mobile_apps",
  "vk_get_mobile_app_users",
  "vk_get_mobile_os",
  "vk_get_mobile_operators",
  "vk_get_mobile_types",
  "vk_get_mobile_vendors",
  "vk_get_regions",
  "vk_get_goals",
  "vk_get_agency_clients",
  "vk_get_manager_clients",
  "vk_get_sharing_keys",
  "vk_select_client",
  "vk_get_lead_forms",
  "vk_get_leads",
  "vk_export_csv",
  "vk_export_xlsx",
  "analytics_compare_periods",
  "analytics_rank_campaigns",
  "analytics_find_inefficient_campaigns",
  "analytics_recommendations",
  "analytics_anomalies",
  "analytics_delivery_issues",
] as const;

// Получено живым запросом GET /banners.json?fields=... 19.07.2026.
// Это не догадка по чужому серверу: список нужен, чтобы агент не посылал в VK
// неизвестные поля и не раскрывал произвольный query passthrough.
const verifiedBannerFields = VERIFIED_BANNER_FIELDS;

const analyticsRowSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().optional(),
  ctr: z.number().finite().optional(),
  cpc: z.number().finite().optional(),
  cpa: z.number().finite().optional(),
  spent: z.number().finite().optional(),
  clicks: z.number().finite().optional(),
  goals: z.number().finite().optional(),
});

const analyticsThresholdsSchema = z.object({
  min_spent: z.number().finite().nonnegative().optional(),
  max_cpc: z.number().finite().nonnegative().optional(),
  max_cpa: z.number().finite().nonnegative().optional(),
  min_ctr: z.number().finite().nonnegative().optional(),
});

const analyticsTimeSeriesPointSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number().finite(),
});

const deliveryDiagnosticInputSchema = z.object({
  id: z.union([z.string(), z.number()]),
  name: z.string().optional(),
  status: z.string().optional(),
  delivery: z.string().optional(),
  moderation_status: z.string().optional(),
});

const exportRowsSchema = z.array(z.record(z.string().min(1).max(120), z.union([z.string().max(10_000), z.number().finite(), z.boolean(), z.null()]))).min(1).max(1_000);

const testWriteOperationSchema = z.enum(["create_url", "create_test_ad_plan", "create_test_campaign", "create_test_ad_group", "create_test_banner", "create_test_segment", "rename_test_ad_plan", "rename_test_campaign", "rename_test_ad_group", "rename_test_banner", "rename_test_segment", "rename_test_lead_form", "rename_test_remarketing_counter", "delete_test_remarketing_counter", "update_test_counter_goal", "update_test_inapp_event_category", "update_test_pricelist", "create_test_async_report", "delete_test_async_report", "block_test_ad_plans", "block_test_ad_groups", "block_test_banners", "remoderate_test_banners", "delete_test_ad_plan", "delete_test_ad_group", "delete_test_segment", "add_test_segment_relation", "delete_test_segment_relation", "upload_static_image", "upload_html5", "upload_test_video", "upload_lead_form_logo", "create_test_offer_batch", "export_leads", "export_survey_respondents", "upload_test_remarketing_user_list", "rename_test_remarketing_user_list", "delete_test_remarketing_user_list", "connect_agency_client", "create_test_local_geo", "update_test_local_geo", "delete_test_local_geo", "copy_test_lead_form", "copy_test_survey_form", "manage_test_lead_forms_archive", "manage_test_survey_forms_archive", "send_test_lead", "create_test_sharing_key", "revoke_created_sharing_key", "share_test_skadnetwork_ids", "withdraw_test_skadnetwork_ids"]);

const confirmedTestGroupTargetingsSchema = z.object({
  geo: z.object({
    regions: z.array(z.number().int().positive()).min(1).max(200),
  }).strict(),
  age: z.object({
    age_list: z.array(z.number().int().min(18).max(80)).min(1).max(63),
    expand: z.boolean(),
  }).strict(),
}).strict();

function normalizeTestWritePayloadCore(
  operation: TestWriteOperation,
  payload: Record<string, unknown>,
  uploadDir?: string,
  piiUploadDir = process.env.VK_ADS_PII_UPLOAD_DIR,
  allowPiiUploads = process.env.VK_ADS_ALLOW_PII_UPLOADS === "1",
  allowAgencyWrites = process.env.VK_ADS_ALLOW_AGENCY_WRITES === "1",
): Record<string, unknown> {
  switch (operation) {
    case "create_url": {
      const parsed = z.object({
        url: z.string().min(1).max(2_048).url(),
      }).parse(payload);
      return { url: validateAdvertisingDestination(parsed.url).url };
    }
    case "create_test_ad_plan": {
      const parsed = z.object({
        name: z.string().min(14).max(120).startsWith("__MCP_TEST__"),
        objective: z.string().min(1).max(80),
        package_id: z.number().int().positive(),
      }).parse(payload);
      return parsed;
    }
    case "create_test_ad_group": {
      const parsed = z.object({
        ad_plan_id: z.number().int().positive(),
        package_id: z.number().int().positive(),
        name: z.string().min(14).max(120).startsWith("__MCP_TEST__"),
        targetings: confirmedTestGroupTargetingsSchema,
      }).parse(payload);
      return parsed;
    }
    case "create_test_campaign": {
      const parsed = z.object({
        ad_plan_id: z.number().int().positive(),
        package_id: z.literal(2860),
        objective: z.literal("appinstalls"),
        name: z.string().min(14).max(120).startsWith("__MCP_TEST__"),
      }).parse(payload);
      return parsed;
    }
    case "create_test_banner": {
      const parsed = z.object({
        ad_group_id: z.number().int().positive(),
        name: z.string().min(14).max(120).startsWith("__MCP_TEST__"),
        primary_url_id: z.number().int().positive(),
        landscape_image_id: z.number().int().positive(),
        icon_image_id: z.number().int().positive(),
        title: z.string().trim().min(1).max(40),
        text: z.string().trim().min(1).max(90),
        cta: z.literal("install"),
      }).parse(payload);
      return parsed;
    }
    case "create_test_segment": {
      const parsed = z.object({
        name: z.string().min(14).max(120).startsWith("__MCP_TEST__"),
        counter_source_id: z.number().int().positive(),
        left_days: z.number().int().min(1).max(365).default(365),
        goal_id: z.string().max(120).default(""),
      }).parse(payload);
      return parsed;
    }
    case "copy_test_lead_form":
    case "copy_test_survey_form":
      return z.object({ form_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__") }).parse(payload);
    case "rename_test_lead_form":
      return z.object({ form_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__") }).parse(payload);
    case "rename_test_remarketing_counter":
      return z.object({ counter_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__") }).parse(payload);
    case "delete_test_remarketing_counter":
      return z.object({ counter_id: z.number().int().positive() }).parse(payload);
    case "update_test_counter_goal":
      return z.object({ counter_id: z.number().int().positive(), goal_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__"), value: z.number().int().min(-2_147_483_647).max(2_147_483_647), goal_type: z.enum(["content", "search", "basket", "wishlist", "checkout", "payment_info", "purchase", "lead", "registration", "custom"]) }).parse(payload);
    case "update_test_inapp_event_category":
      return z.object({ app_id: z.number().int().positive(), tracker_id: z.number().int().positive(), event_id: z.number().int().positive(), category_id: z.number().int().positive() }).parse(payload);
    case "manage_test_lead_forms_archive":
    case "manage_test_survey_forms_archive":
      return z.object({ action: z.enum(["archive", "unarchive"]), form_ids: z.array(z.number().int().positive()).min(1).max(50) }).parse(payload);
    case "send_test_lead":
      return z.object({ form_id: z.number().int().positive() }).parse(payload);
    case "create_test_sharing_key":
      return z.object({ segment_id: z.number().int().positive(), recipient: z.string().trim().min(3).max(254).refine((value) => !/[\r\n]/.test(value), "Получатель не должен содержать переносы строк.") }).parse(payload);
    case "revoke_created_sharing_key":
      return z.object({ key_handle: z.string().uuid() }).parse(payload);
    case "share_test_skadnetwork_ids":
    case "withdraw_test_skadnetwork_ids":
      return z.object({ app_id: z.number().int().positive(), recipient: z.string().trim().min(3).max(254).refine((value) => !/[\r\n]/.test(value), "Получатель не должен содержать переносы строк."), count: z.number().int().min(1).max(10_000) }).parse(payload);
    case "rename_test_ad_plan": {
      const parsed = z.object({
        ad_plan_id: z.number().int().positive(),
        name: z.string().min(14).max(120).startsWith("__MCP_TEST__"),
      }).parse(payload);
      return parsed;
    }
    case "rename_test_campaign": {
      const parsed = z.object({
        campaign_id: z.number().int().positive(),
        name: z.string().min(14).max(120).startsWith("__MCP_TEST__"),
      }).parse(payload);
      return parsed;
    }
    case "rename_test_ad_group": {
      const parsed = z.object({
        ad_group_id: z.number().int().positive(),
        name: z.string().min(14).max(120).startsWith("__MCP_TEST__"),
      }).parse(payload);
      return parsed;
    }
    case "rename_test_banner": {
      const parsed = z.object({
        banner_id: z.number().int().positive(),
        name: z.string().min(14).max(120).startsWith("__MCP_TEST__"),
      }).parse(payload);
      return parsed;
    }
    case "rename_test_segment":
      return z.object({ segment_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__") }).parse(payload);
    case "update_test_pricelist": {
      const parsed = z.object({
        pricelist_id: z.number().int().positive(),
        name: z.string().min(14).max(120).startsWith("__MCP_TEST__"),
        status: z.enum(["active", "blocked"]),
        remove_utm_tags: z.boolean(),
        export_url: z.string().min(1).max(2_048).url().optional(),
      }).parse(payload);
      return { ...parsed, ...(parsed.export_url ? { export_url: validateAdvertisingDestination(parsed.export_url).url } : {}) };
    }
    case "create_test_async_report":
      return z.object({
        title: z.string().min(14).max(120).startsWith("__MCP_TEST__"),
        advertisers: z.array(z.number().int().positive()).min(1).max(50),
        date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        metrics: z.array(z.enum(["acs", "cart_count", "clicks", "conversions", "cpa", "cpc", "cr", "cr_cart", "cr_purchase", "ctr", "inapp_count", "money", "purchase_count", "romi", "shows", "top_goal_count", "value", "video_100cost", "video_100pct", "video_10sec", "video_10sec_cost", "video_10sec_rate", "video_25pct", "video_50pct", "video_75pct", "video_avg_depth", "video_started", "video_view_rate"])).min(1).max(30),
        slices: z.array(z.enum(["ad_plan_id", "advertiser_id", "age", "banner_id", "campaign_id", "day", "feed_id", "geo", "hour", "inapp_id", "interests", "month", "offer_id", "search_phrase", "sex", "shop_id", "top_goal_id", "week", "year"])).min(1).max(16).refine((value) => value.includes("advertiser_id"), "slices должен содержать advertiser_id"),
      }).parse(payload);
    case "delete_test_async_report":
      return z.object({ report_id: z.number().int().positive() }).parse(payload);
    case "block_test_ad_plans":
      return z.object({ ad_plan_ids: z.array(z.number().int().positive()).min(1).max(200) }).parse(payload);
    case "block_test_ad_groups":
      return z.object({ ad_group_ids: z.array(z.number().int().positive()).min(1).max(200) }).parse(payload);
    case "block_test_banners":
      return z.object({ banner_ids: z.array(z.number().int().positive()).min(1).max(200) }).parse(payload);
    case "remoderate_test_banners":
      return z.object({ banner_ids: z.array(z.number().int().positive()).min(1).max(200) }).parse(payload);
    case "delete_test_ad_plan":
      return z.object({ ad_plan_id: z.number().int().positive() }).parse(payload);
    case "delete_test_ad_group":
      return z.object({ ad_group_id: z.number().int().positive() }).parse(payload);
    case "delete_test_segment":
      return z.object({ segment_id: z.number().int().positive() }).parse(payload);
    case "add_test_segment_relation":
      return z.object({ segment_id: z.number().int().positive(), nested_segment_id: z.number().int().positive() }).parse(payload);
    case "delete_test_segment_relation":
      return z.object({ segment_id: z.number().int().positive(), relation_id: z.number().int().positive() }).parse(payload);
    case "upload_static_image": {
      if (!uploadDir) throw new Error("Для upload задайте VK_ADS_UPLOAD_DIR с локальным безопасным каталогом.");
      const { file_path } = z.object({ file_path: z.string().min(1).max(1024) }).parse(payload);
      const image = validateImageUpload(file_path, uploadDir);
      return { file_path: image.filePath, filename: image.filename, mime_type: image.mimeType, size: image.size, sha256: image.sha256, width: image.width, height: image.height };
    }
    case "upload_html5": {
      if (!uploadDir) throw new Error("Для upload задайте VK_ADS_UPLOAD_DIR с локальным безопасным каталогом.");
      const { file_path } = z.object({ file_path: z.string().min(1).max(1_024) }).parse(payload);
      const creative = validateHtml5Upload(file_path, uploadDir);
      return { file_path: creative.filePath, filename: creative.filename, mime_type: creative.mimeType, size: creative.size, sha256: creative.sha256, width: creative.width, height: creative.height, html_file: creative.htmlFile };
    }
    case "upload_test_video": {
      if (!uploadDir) throw new Error("Для upload задайте VK_ADS_UPLOAD_DIR с локальным безопасным каталогом.");
      const { file_path, width, height } = z.object({
        file_path: z.string().min(1).max(1024),
        width: z.number().int().min(1).max(16_384),
        height: z.number().int().min(1).max(16_384),
      }).parse(payload);
      const video = validateVideoUpload(file_path, uploadDir);
      if (video.width !== width || video.height !== height) {
        throw new Error(`Заявленные размеры видео ${width}×${height} не совпадают с размерами MP4 ${video.width}×${video.height}.`);
      }
      return { file_path: video.filePath, filename: video.filename, mime_type: video.mimeType, size: video.size, sha256: video.sha256, width: video.width, height: video.height };
    }
    case "upload_lead_form_logo": {
      if (!uploadDir) throw new Error("Для upload задайте VK_ADS_UPLOAD_DIR с локальным безопасным каталогом.");
      const { file_path } = z.object({ file_path: z.string().min(1).max(1_024) }).parse(payload);
      const image = validateLeadFormImageUpload(file_path, uploadDir);
      return { file_path: image.filePath, filename: image.filename, mime_type: image.mimeType, size: image.size, sha256: image.sha256, width: image.width, height: image.height, role: "logo" };
    }
    case "create_test_offer_batch": return z.object({ pricelist_id: z.number().int().positive(), offer_id: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/), product_type: z.string().regex(/^[A-Za-z0-9._ -]{1,100}$/), title: z.string().trim().min(1).max(150), link: z.string().url(), image_link: z.string().url(), price: z.string().regex(/^\d+(?:\.\d{1,2})? [A-Z]{3}$/) }).parse(payload);
    case "export_leads": {
      const parsed = z.object({
        form_id: z.number().int().positive(),
        format: z.enum(["csv", "xlsx"]),
        ad_plan_ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
        ad_group_ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
        banner_ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
        created_at_gte: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).optional(),
        created_at_lte: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).optional(),
      }).parse(payload);
      return parsed;
    }
    case "export_survey_respondents":
      return z.object({ form_id: z.number().int().positive() }).parse(payload);
    case "upload_test_remarketing_user_list": {
      if (!allowPiiUploads || !piiUploadDir) {
        throw new Error("Загрузка списка ремаркетинга с PII отключена. Нужны VK_ADS_ALLOW_PII_UPLOADS=1 и отдельный VK_ADS_PII_UPLOAD_DIR.");
      }
      const { file_path, name, type } = z.object({
        file_path: z.string().min(1).max(1_024),
        name: z.string().min(14).max(120).startsWith("__MCP_TEST__"),
        type: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
      }).parse(payload);
      const list = validateRemarketingUserListUpload(file_path, piiUploadDir);
      return { file_path: list.filePath, filename: list.filename, mime_type: list.mimeType, size: list.size, sha256: list.sha256, line_count: list.lineCount, name, type };
    }
    case "rename_test_remarketing_user_list":
      return z.object({ list_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__") }).parse(payload);
    case "delete_test_remarketing_user_list":
      return z.object({ list_id: z.number().int().positive() }).parse(payload);
    case "connect_agency_client": {
      if (!allowAgencyWrites) throw new Error("Агентское подключение отключено. Для него нужен отдельный VK_ADS_ALLOW_AGENCY_WRITES=1 при запуске.");
      return z.object({ user_id: z.number().int().positive(), access_type: z.literal("full_access") }).parse(payload);
    }
    case "create_test_local_geo": {
      const parsed = z.object({
        name: z.string().min(14).max(120).startsWith("__MCP_TEST__"),
        regions: z.array(z.object({
          lat: z.number().finite().min(-90).max(90),
          lng: z.number().finite().min(-180).max(180),
          radius: z.number().int().min(1).max(100_000),
          label: z.string().trim().min(1).max(200),
          address: z.string().trim().min(1).max(500).optional(),
        }).strict()).min(1).max(200),
      }).parse(payload);
      return parsed;
    }
    case "update_test_local_geo": {
      const parsed = z.object({
        local_geo_id: z.number().int().positive(),
        name: z.string().min(14).max(120).startsWith("__MCP_TEST__"),
        regions: z.array(z.object({
          lat: z.number().finite().min(-90).max(90),
          lng: z.number().finite().min(-180).max(180),
          radius: z.number().int().min(1).max(100_000),
          label: z.string().trim().min(1).max(200),
          address: z.string().trim().min(1).max(500).optional(),
        }).strict()).min(1).max(200),
      }).parse(payload);
      return parsed;
    }
    case "delete_test_local_geo":
      return z.object({ local_geo_id: z.number().int().positive() }).parse(payload);
  }
}

function textAndData<T extends VkObject>(data: T, message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    structuredContent: data,
  };
}

function normalizePaged(response: VkPagedResponse) {
  return {
    count: response.count,
    offset: response.offset,
    items: response.items,
  };
}

function resolveAdvertisingUrl(source: string): VkObject {
  let parsed: URL;
  try {
    parsed = new URL(source);
  } catch {
    throw new Error("Некорректный URL.");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.username || parsed.password || !parsed.hostname) {
    throw new Error("Разрешён только абсолютный HTTP(S) URL без логина и пароля.");
  }
  const sensitive = /(?:token|secret|password|authorization|auth|signature|sig|key|code)/i;
  const sanitized = new URL(parsed);
  sanitized.hash = "";
  const query: VkObject[] = [];
  const utm: VkObject = {};
  for (const [key, value] of parsed.searchParams) {
    const safeValue = sensitive.test(key) ? "[redacted]" : value;
    sanitized.searchParams.set(key, safeValue);
    query.push({ key, value: safeValue, redacted: sensitive.test(key) });
    if (/^utm_/i.test(key)) utm[key] = safeValue;
  }
  return {
    normalized_url: sanitized.toString(),
    protocol: parsed.protocol.slice(0, -1),
    hostname: parsed.hostname,
    pathname: parsed.pathname,
    is_vk_domain: /(^|\.)vk\.(com|ru)$/i.test(parsed.hostname) || /(^|\.)ads\.vk\.(com|ru)$/i.test(parsed.hostname),
    has_fragment: Boolean(parsed.hash),
    query,
    utm,
  };
}

function remarketingListMetadata(item: VkObject): VkObject {
  const allowed = ["id", "name", "status", "type", "created", "entries_count", "ids_count", "matched_ids_count", "has_history"];
  return Object.fromEntries(allowed.flatMap((key) => Object.hasOwn(item, key) ? [[key, item[key]]] : []));
}

/** Не раскрывает users, e-mail, URL и идентификаторы SKAdNetwork из v1 mobile_app_users. */
function mobileAppUserMetadata(item: VkObject): VkObject {
  const allowed = ["app_name", "platform", "url_object_id", "rb_mobile_app_id", "campaign_ids", "category_id"];
  const result = Object.fromEntries(allowed.flatMap((key) => Object.hasOwn(item, key) ? [[key, item[key]]] : [])) as VkObject;
  if (Array.isArray(item.sk_ad_network_ids)) result.sk_ad_network_ids_count = item.sk_ad_network_ids.length;
  return result;
}

/** Ключ и sharing URL — bearer secrets, поэтому доступны лишь безопасные признаки объекта. */
function sharingKeyMetadata(item: VkObject): VkObject {
  const allowed = ["id", "source_type", "source_id", "created", "updated", "status", "expires_at"];
  const result = Object.fromEntries(allowed.flatMap((key) => Object.hasOwn(item, key) ? [[key, item[key]]] : [])) as VkObject;
  if (Array.isArray(item.sources)) result.sources_count = item.sources.length;
  else if (item.sources && typeof item.sources === "object") result.source_types = Object.keys(item.sources as VkObject).sort();
  if (Array.isArray(item.users)) result.recipients_count = item.users.length;
  return result;
}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/** Скрывает app URL, пользователей и сами идентификаторы, оставляя только preflight-счётчики. */
function skAdNetworkMetadata(app: VkObject): VkObject {
  const ids = app.sk_ad_network_ids && typeof app.sk_ad_network_ids === "object" ? app.sk_ad_network_ids as VkObject : {};
  const users = Array.isArray(app.users) ? app.users : [];
  return {
    app_id: app.rb_mobile_app_id ?? null,
    platform: typeof app.platform === "string" ? app.platform : null,
    campaigns_count: Array.isArray(app.campaign_ids) ? app.campaign_ids.length : 0,
    available_ids: nonNegativeInteger(ids.available),
    used_ids: nonNegativeInteger(ids.used),
    total_ids: nonNegativeInteger(ids.total),
    recipients_count: users.length,
  };
}

function skAdNetworkRecipientAvailable(app: VkObject, recipient: string): number | null {
  const users = Array.isArray(app.users) ? app.users : [];
  const found = users.find((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const user = (entry as VkObject).user;
    return Boolean(user && typeof user === "object" && String((user as VkObject).username).toLowerCase() === recipient.toLowerCase());
  });
  if (!found || typeof found !== "object") return null;
  const ids = (found as VkObject).sk_ad_network_ids;
  if (!ids || typeof ids !== "object") return null;
  return nonNegativeInteger((ids as VkObject).available);
}

async function preflightSkAdNetwork(
  client: VkAdsClient,
  operation: "share_test_skadnetwork_ids" | "withdraw_test_skadnetwork_ids",
  payload: Record<string, unknown>,
  allowedTestAppIds: readonly number[],
): Promise<{ ready: boolean; checks: Array<{ code: string; status: "pass" | "fail"; message: string }> }> {
  const appId = payload.app_id as number;
  const count = payload.count as number;
  const recipient = payload.recipient as string;
  const checks: Array<{ code: string; status: "pass" | "fail"; message: string }> = [];
  const inAllowlist = allowedTestAppIds.includes(appId);
  checks.push({ code: "test_app_allowlist", status: inAllowlist ? "pass" : "fail", message: inAllowlist ? "iOS-приложение есть в локальном allowlist тестов." : "iOS app ID не входит в VK_ADS_TEST_IOS_APP_IDS." });
  if (!inAllowlist) return { ready: false, checks };
  const app = await client.getAppleAppSkAdNetworkStatus(appId);
  const available = nonNegativeInteger((app.sk_ad_network_ids as VkObject | undefined)?.available);
  checks.push({ code: "owner_free_ids", status: available >= count ? "pass" : "fail", message: available >= count ? "У владельца достаточно свободных SKAdNetwork IDs." : "У владельца недостаточно свободных SKAdNetwork IDs." });
  if (operation === "withdraw_test_skadnetwork_ids") {
    const campaignCount = Array.isArray(app.campaign_ids) ? app.campaign_ids.length : 0;
    checks.push({ code: "no_linked_campaigns", status: campaignCount === 0 ? "pass" : "fail", message: campaignCount === 0 ? "У тестового приложения нет связанных кампаний." : "У тестового приложения есть связанные кампании; withdraw заблокирован." });
    const recipientAvailable = skAdNetworkRecipientAvailable(app, recipient);
    checks.push({ code: "recipient_free_ids", status: recipientAvailable !== null && recipientAvailable >= count ? "pass" : "fail", message: recipientAvailable !== null && recipientAvailable >= count ? "У получателя достаточно свободных IDs для безопасного withdraw." : "Не подтверждено, что у получателя есть нужное число свободных IDs; withdraw заблокирован." });
  }
  return { ready: checks.every((check) => check.status === "pass"), checks };
}

async function inAppEventFromPages(client: VkAdsClient, input: { appId: number; trackerId: number; eventId: number }): Promise<VkObject> {
  const pageSize = 200;
  for (let offset = 0; offset < 2_000; offset += pageSize) {
    const page = await client.listInAppEvents(offset, pageSize);
    const item = page.items.find((candidate) => (
      Number(candidate.id) === input.eventId
      && Number(candidate.tracker_id) === input.trackerId
      && Number(candidate.rb_mobile_app_id ?? candidate.app_id ?? candidate.url_object_id) === input.appId
    ));
    if (item) return item;
    if (offset + page.items.length >= page.count) break;
  }
  throw new Error("In-app событие не найдено среди объектов, доступных текущему кабинету.");
}

async function preflightInAppEventCategory(
  client: VkAdsClient,
  payload: Record<string, unknown>,
  allowedTestAppIds: readonly number[],
): Promise<{ ready: boolean; checks: Array<{ code: string; status: "pass" | "fail"; message: string }> }> {
  const appId = payload.app_id as number;
  const checks: Array<{ code: string; status: "pass" | "fail"; message: string }> = [];
  const appAllowed = allowedTestAppIds.includes(appId);
  checks.push({ code: "test_app_allowlist", status: appAllowed ? "pass" : "fail", message: appAllowed ? "Мобильное приложение есть в локальном allowlist тестов." : "app_id не входит в VK_ADS_TEST_MOBILE_APP_IDS." });
  if (!appAllowed) return { ready: false, checks };

  const categories = await client.listInAppEventCategories();
  const categoryFound = categories.some((category) => Number(category.id) === Number(payload.category_id));
  checks.push({ code: "category_exists", status: categoryFound ? "pass" : "fail", message: categoryFound ? "Категория подтверждена справочником VK Ads." : "category_id отсутствует в справочнике VK Ads." });

  try {
    await inAppEventFromPages(client, { appId, trackerId: payload.tracker_id as number, eventId: payload.event_id as number });
    checks.push({ code: "event_access", status: "pass", message: "Событие принадлежит разрешённому приложению и доступно текущему кабинету." });
  } catch {
    checks.push({ code: "event_access", status: "fail", message: "Событие не найдено в доступном списке текущего кабинета." });
  }
  return { ready: checks.every((check) => check.status === "pass"), checks };
}

function observedFields(items: VkObject[]): string[] {
  return [...new Set(items.flatMap((item) => Object.keys(item)))].sort();
}

function itemFromList(items: VkObject[], id: number, label: string): VkObject {
  const item = items.find((candidate) => Number(candidate.id) === id);
  if (!item) throw new Error(`${label} не найден среди объектов, доступных текущему кабинету.`);
  return item;
}

function packageFromList(items: VkObject[], id: number): VkObject {
  return itemFromList(items, id, "Пакет");
}

async function remarketingListFromPages(client: VkAdsClient, id: number): Promise<VkObject> {
  const pageSize = 200;
  for (let offset = 0; offset < 2_000; offset += pageSize) {
    const page = await client.listRemarketingUserLists(offset, pageSize);
    const item = page.items.find((candidate) => Number(candidate.id) === id);
    if (item) return remarketingListMetadata(item);
    if (offset + page.items.length >= page.count) break;
  }
  throw new Error("Список ремаркетинга не найден среди metadata списков, доступных текущему кабинету.");
}

async function leadFormFromPages(client: VkAdsClient, id: number): Promise<VkObject> {
  const pageSize = 200;
  for (let offset = 0; offset < 2_000; offset += pageSize) {
    const page = await client.listLeadForms(offset, pageSize);
    const item = page.items.find((candidate) => Number(candidate.id) === id);
    if (item) return item;
    if (offset + page.items.length >= page.count) break;
  }
  throw new Error("Лид-форма не найдена среди metadata форм, доступных текущему кабинету.");
}

async function surveyFormFromPages(client: VkAdsClient, id: number): Promise<VkObject> {
  const pageSize = 200;
  for (let offset = 0; offset < 2_000; offset += pageSize) {
    const page = await client.listSurveyForms(offset, pageSize);
    const item = page.items.find((candidate) => Number(candidate.id) === id);
    if (item) return item;
    if (offset + page.items.length >= page.count) break;
  }
  throw new Error("Опросная форма не найдена среди metadata форм, доступных текущему кабинету.");
}

async function searchPhraseFromList(client: VkAdsClient, id: number): Promise<VkObject> {
  return itemFromList(await client.listSearchPhrases(), id, "Список поисковых фраз");
}

async function subscriptionFromPages(client: VkAdsClient, id: number): Promise<VkObject> {
  const pageSize = 200;
  for (let offset = 0; offset < 2_000; offset += pageSize) {
    const page = await client.listSubscriptions(offset, pageSize);
    const item = page.items.find((candidate) => Number(candidate.id) === id);
    if (item) return item;
    if (offset + page.items.length >= page.count) break;
  }
  throw new Error("Подписка не найдена среди metadata объектов, доступных текущему кабинету.");
}

async function transactionGroupFromPages(client: VkAdsClient, id: number): Promise<VkObject> {
  const pageSize = 200;
  for (let offset = 0; offset < 2_000; offset += pageSize) {
    const page = await client.listTransactionGroups(offset, pageSize);
    const item = page.items.find((candidate) => Number(candidate.id) === id);
    if (item) return item;
    if (offset + page.items.length >= page.count) break;
  }
  throw new Error("Группа транзакций не найдена среди объектов, доступных текущему кабинету.");
}

async function pricelistFromPages(client: VkAdsClient, id: number): Promise<VkObject> {
  const pageSize = 50;
  for (let offset = 0; offset < 2_000; offset += pageSize) {
    const page = await client.listPricelists(offset, pageSize);
    const item = page.items.find((candidate) => Number(candidate.id) === id);
    if (item) return item;
    if (offset + page.items.length >= page.count) break;
  }
  throw new Error("Прайс-лист не найден среди metadata объектов, доступных текущему кабинету.");
}

function writeImpact(operation: TestWriteOperation): { risk: "low" | "medium" | "high"; expected_change: string } {
  switch (operation) {
    case "create_url": return { risk: "low", expected_change: "Зарегистрировать HTTPS landing URL в VK Ads; показы, banner и расход не создаются." };
    case "create_test_ad_plan": return { risk: "low", expected_change: "Создать остановленный изолированный test ad plan; показы и расход не запускаются." };
    case "create_test_campaign": return { risk: "low", expected_change: "Создать остановленную test campaign package 2860 внутри test ad plan; показы и расход не запускаются." };
    case "create_test_ad_group": return { risk: "low", expected_change: "Создать остановленную test ad group внутри test ad plan; показы и расход не запускаются." };
    case "create_test_banner": return { risk: "low", expected_change: "Создать остановленный banner только в __MCP_TEST__ группе package_id=2860; расход не запускается." };
    case "create_test_segment": return { risk: "low", expected_change: "Создать изолированный __MCP_TEST__ сегмент с read-only источником; существующие объекты не изменяются." };
    case "copy_test_lead_form": return { risk: "low", expected_change: "Создать копию только существующей __MCP_TEST__ лид-формы; новая форма также получает test-префикс." };
    case "rename_test_lead_form": return { risk: "low", expected_change: "Переименовать только существующую __MCP_TEST__ лид-форму; контактные поля, страницы и уведомления не изменяются." };
    case "update_test_inapp_event_category": return { risk: "medium", expected_change: "Изменить категорию только одного события разрешённого тестового мобильного приложения; настройки кампаний и объявления не изменяются." };
    case "copy_test_survey_form": return { risk: "low", expected_change: "Создать копию только существующего __MCP_TEST__ опроса; новая форма также получает test-префикс." };
    case "manage_test_lead_forms_archive": return { risk: "medium", expected_change: "Архивировать или вернуть из архива только __MCP_TEST__ лид-формы." };
    case "manage_test_survey_forms_archive": return { risk: "medium", expected_change: "Архивировать или вернуть из архива только __MCP_TEST__ опросы." };
    case "send_test_lead": return { risk: "medium", expected_change: "Отправить один служебный тестовый лид только для __MCP_TEST__ формы; контактные данные и ответы не передаются." };
    case "create_test_sharing_key": return { risk: "medium", expected_change: "Создать ключ только для __MCP_TEST__ сегмента и передать его указанному получателю через VK Ads; сам ключ не будет показан или записан в audit." };
    case "revoke_created_sharing_key": return { risk: "high", expected_change: "Отозвать только ключ, созданный текущим MCP-сеансом. Отзыв может остановить кампании получателя, поэтому требует отдельного opt-in при запуске." };
    case "share_test_skadnetwork_ids": return { risk: "high", expected_change: "Передать свободные SKAdNetwork IDs только из allowlist тестового iOS-приложения. Кампании не должны быть затронуты." };
    case "withdraw_test_skadnetwork_ids": return { risk: "high", expected_change: "Вернуть только свободные SKAdNetwork IDs из allowlist тестового iOS-приложения. Если есть связанные кампании или недостаточно свободных IDs, операция блокируется." };
    case "rename_test_ad_plan": return { risk: "low", expected_change: "Переименовать только test ad plan." };
    case "rename_test_remarketing_counter": return { risk: "low", expected_change: "Переименовать только allowlist test-счётчик ремаркетинга." };
    case "delete_test_remarketing_counter": return { risk: "high", expected_change: "Удалить только allowlist test-счётчик ремаркетинга; операция необратима." };
    case "update_test_counter_goal": return { risk: "low", expected_change: "Изменить только allowlist __MCP_TEST__ цель test-счётчика ремаркетинга." };
    case "rename_test_campaign": return { risk: "low", expected_change: "Переименовать только test campaign." };
    case "rename_test_ad_group": return { risk: "low", expected_change: "Переименовать только test ad group." };
    case "rename_test_banner": return { risk: "low", expected_change: "Переименовать только test banner." };
    case "rename_test_segment": return { risk: "low", expected_change: "Переименовать только test-сегмент." };
    case "update_test_pricelist": return { risk: "low", expected_change: "Изменить только test-каталог __MCP_TEST__; кампании и товары не создаются." };
    case "create_test_async_report": return { risk: "low", expected_change: "Создать только временный __MCP_TEST__ серверный отчёт; кампании и расход не меняются." };
    case "delete_test_async_report": return { risk: "medium", expected_change: "Удалить только временный __MCP_TEST__ серверный отчёт." };
    case "block_test_ad_plans": return { risk: "low", expected_change: "Массово оставить только __MCP_TEST__ ad plan в статусе blocked; показы и расход не запускаются." };
    case "block_test_ad_groups": return { risk: "low", expected_change: "Массово оставить только __MCP_TEST__ ad group в статусе blocked; показы и расход не запускаются." };
    case "block_test_banners": return { risk: "low", expected_change: "Массово оставить только __MCP_TEST__ banner в статусе blocked; показы и расход не запускаются." };
    case "remoderate_test_banners": return { risk: "low", expected_change: "Запросить повторную модерацию только для __MCP_TEST__ banner, если VK Ads явно разрешает её; бюджет и статус не меняются." };
    case "delete_test_ad_plan": return { risk: "medium", expected_change: "Пометить test ad plan как deleted; операция необратима в интерфейсе сервера." };
    case "delete_test_ad_group": return { risk: "medium", expected_change: "Пометить test ad group как deleted; операция необратима в интерфейсе сервера." };
    case "delete_test_segment": return { risk: "medium", expected_change: "Удалить только test-сегмент; операция необратима." };
    case "add_test_segment_relation": return { risk: "low", expected_change: "Добавить связь только между двумя test-сегментами." };
    case "delete_test_segment_relation": return { risk: "medium", expected_change: "Удалить связь только из test-сегмента." };
    case "upload_static_image": return { risk: "low", expected_change: "Загрузить статичное изображение в контент VK Ads; banner и показы не создаются." };
    case "upload_html5": return { risk: "low", expected_change: "Загрузить проверенный HTML5 ZIP-креатив в контент VK Ads; banner и показы не создаются." };
    case "upload_test_video": return { risk: "low", expected_change: "Загрузить MP4-видео в контент VK Ads; banner, показы и расход не создаются." };
    case "upload_lead_form_logo": return { risk: "low", expected_change: "Загрузить PNG/JPEG logo для лид-формы; сама форма, объявления, показы и расход не меняются." };
    case "create_test_offer_batch": return { risk: "low", expected_change: "Создать одну batch-задачу с synthetic offer только в __MCP_TEST__ прайс-листе; кампании и расход не меняются." };
    case "export_leads": return { risk: "medium", expected_change: "Получить экспорт лидов с персональными данными в памяти текущего MCP-сеанса; данные не попадут в audit." };
    case "export_survey_respondents": return { risk: "medium", expected_change: "Получить экспорт ответов опроса с персональными данными в памяти текущего MCP-сеанса; данные не попадут в audit." };
    case "upload_test_remarketing_user_list": return { risk: "medium", expected_change: "Загрузить новый __MCP_TEST__ список ремаркетинга из отдельно разрешённого PII-файла; содержимое не попадёт в ответ или audit." };
    case "rename_test_remarketing_user_list": return { risk: "low", expected_change: "Переименовать только существующий __MCP_TEST__ список ремаркетинга." };
    case "delete_test_remarketing_user_list": return { risk: "medium", expected_change: "Удалить только неиспользуемый __MCP_TEST__ список ремаркетинга; операция необратима." };
    case "connect_agency_client": return { risk: "medium", expected_change: "Привязать существующий рекламный кабинет к агентству с полным доступом; операция меняет отношения кабинетов." };
    case "create_test_local_geo": return { risk: "low", expected_change: "Создать новый __MCP_TEST__ список локального гео. Его можно изменить или удалить только тем же безопасным lifecycle." };
    case "update_test_local_geo": return { risk: "low", expected_change: "Изменить только существующий __MCP_TEST__ список локального гео." };
    case "delete_test_local_geo": return { risk: "medium", expected_change: "Удалить только неиспользуемый __MCP_TEST__ список локального гео; операция необратима." };
  }
}

async function captureWriteBefore(client: VkAdsClient, operation: TestWriteOperation, payload: Record<string, unknown>): Promise<VkObject | null> {
  switch (operation) {
    case "create_test_ad_group": return client.getAdPlan(payload.ad_plan_id as number);
    case "create_test_campaign": return client.getAdPlan(payload.ad_plan_id as number);
    case "create_test_banner": return client.getAdGroup(payload.ad_group_id as number);
    case "copy_test_lead_form": return publicFormConfiguration(await client.getLeadFormDetail(payload.form_id as number));
    case "rename_test_lead_form": return publicFormConfiguration(await client.getLeadFormDetail(payload.form_id as number));
    case "rename_test_remarketing_counter":
    case "delete_test_remarketing_counter": return publicCounterMetadata(await client.getRemarketingCounter(payload.counter_id as number));
    case "update_test_counter_goal": return publicCounterMetadata(await client.getRemarketingCounter(payload.counter_id as number));
    case "update_test_inapp_event_category": return publicSensitiveMetadata(await inAppEventFromPages(client, { appId: payload.app_id as number, trackerId: payload.tracker_id as number, eventId: payload.event_id as number })) as VkObject;
    case "send_test_lead": return publicFormConfiguration(await client.getLeadFormDetail(payload.form_id as number));
    case "create_test_sharing_key": return { segment: publicSensitiveMetadata(await client.getSegment(payload.segment_id as number)), recipients_count: 1 } as VkObject;
    case "revoke_created_sharing_key": return { only_current_session_key: true };
    case "share_test_skadnetwork_ids":
    case "withdraw_test_skadnetwork_ids": return skAdNetworkMetadata(await client.getAppleAppSkAdNetworkStatus(payload.app_id as number));
    case "copy_test_survey_form": return publicFormConfiguration(await client.getSurveyFormDetail(payload.form_id as number));
    case "manage_test_lead_forms_archive": return { items: await Promise.all((payload.form_ids as number[]).map(async (id) => publicFormConfiguration(await client.getLeadFormDetail(id)))) };
    case "manage_test_survey_forms_archive": return { items: await Promise.all((payload.form_ids as number[]).map(async (id) => publicFormConfiguration(await client.getSurveyFormDetail(id)))) };
    case "rename_test_segment":
    case "delete_test_segment":
    case "add_test_segment_relation":
    case "delete_test_segment_relation": return client.getSegment(payload.segment_id as number);
    case "rename_test_ad_plan":
    case "delete_test_ad_plan": return client.getAdPlan(payload.ad_plan_id as number);
    case "rename_test_campaign": return client.getCampaign(payload.campaign_id as number);
    case "block_test_ad_plans": return { items: await Promise.all((payload.ad_plan_ids as number[]).map((id) => client.getAdPlan(id))) };
    case "block_test_ad_groups": return { items: await Promise.all((payload.ad_group_ids as number[]).map((id) => client.getAdGroup(id))) };
    case "block_test_banners": return { items: await Promise.all((payload.banner_ids as number[]).map((id) => client.getBanner(id))) };
    case "remoderate_test_banners": return { items: await Promise.all((payload.banner_ids as number[]).map((id) => client.getBanner(id))) };
    case "rename_test_ad_group":
    case "delete_test_ad_group": return client.getAdGroup(payload.ad_group_id as number);
    case "rename_test_banner": return client.getBanner(payload.banner_id as number);
    case "update_test_pricelist": return pricelistFromPages(client, payload.pricelist_id as number);
    case "delete_test_async_report": return client.getCustomReport(payload.report_id as number);
    case "export_leads": return { lead_form: await leadFormFromPages(client, payload.form_id as number), sensitive: true };
    case "export_survey_respondents": return { survey_form: publicFormConfiguration(await client.getSurveyFormDetail(payload.form_id as number)), sensitive: true };
    case "rename_test_remarketing_user_list":
    case "delete_test_remarketing_user_list": return { list: await client.getRemarketingUserList(payload.list_id as number), sensitive: true };
    case "update_test_local_geo":
    case "delete_test_local_geo": return itemFromList(await client.listLocalGeo(), payload.local_geo_id as number, "Local geo");
    default: return null;
  }
}

async function preflightConfirmedTestBanner(
  client: VkAdsClient,
  payload: Record<string, unknown>,
  knownImages: ReadonlyMap<number, KnownStaticImage>,
  groupFromBefore?: VkObject | null,
): Promise<{ ready: boolean; checks: Array<{ code: string; status: "pass" | "fail"; message: string }> }> {
  const checks: Array<{ code: string; status: "pass" | "fail"; message: string }> = [...validateConfirmedTestBannerDraft({
    landscape_image_id: payload.landscape_image_id as number,
    icon_image_id: payload.icon_image_id as number,
    title: payload.title as string,
    text: payload.text as string,
  }, knownImages).checks];

  const group = groupFromBefore ?? await client.getAdGroup(payload.ad_group_id as number);
  const groupName = typeof group.name === "string" ? group.name : "";
  const groupReady = groupName.startsWith("__MCP_TEST__") && Number(group.package_id) === 2860;
  checks.push(groupReady
    ? { code: "ad_group", status: "pass", message: "Test ad group package_id=2860 подтверждена." }
    : { code: "ad_group", status: "fail", message: "Нужна существующая __MCP_TEST__ group с package_id=2860." });

  try {
    const url = await client.getUrl(payload.primary_url_id as number);
    const urlReady = Number(url.id) === Number(payload.primary_url_id);
    checks.push(urlReady
      ? { code: "primary_url", status: "pass", message: "Зарегистрированный primary URL подтверждён." }
      : { code: "primary_url", status: "fail", message: "primary_url_id не подтверждён VK Ads." });
  } catch {
    checks.push({ code: "primary_url", status: "fail", message: "primary_url_id не найден или недоступен текущему кабинету." });
  }

  return { ready: checks.every((check) => check.status === "pass"), checks };
}

async function preflightTestAdPlan(client: VkAdsClient, payload: Record<string, unknown>): Promise<WritePreflightResult> {
  return validateTestAdPlanDraft({
    package_id: payload.package_id as number,
    objective: payload.objective as string,
  }, await client.listPackages());
}

async function preflightTestAdGroup(
  client: VkAdsClient,
  payload: Record<string, unknown>,
  adPlanFromBefore?: VkObject | null,
): Promise<WritePreflightResult> {
  const adPlan = adPlanFromBefore ?? await client.getAdPlan(payload.ad_plan_id as number);
  return validateTestAdGroupParent(adPlan, payload.package_id as number, await client.listPackages());
}

async function captureWriteAfter(client: VkAdsClient, operation: TestWriteOperation, payload: Record<string, unknown>, result: VkObject): Promise<VkObject> {
  try {
    switch (operation) {
      case "create_url": return { reread: true, item: await client.getUrl(result.id as number) };
      case "create_test_ad_plan": return { reread: true, item: await client.getAdPlan(result.id as number) };
      case "create_test_campaign": return { reread: true, item: await client.getCampaign(result.id as number) };
      case "create_test_ad_group": return { reread: true, item: await client.getAdGroup(result.id as number) };
      case "create_test_banner": {
        const banners = await client.listBanners(0, 20, { adGroupId: payload.ad_group_id as number, fields: ["id", "name", "status", "ad_group_id", "content", "textblocks", "urls"] });
        const item = banners.items.find((banner) => Number(banner.id) === Number(result.id));
        return item ? { reread: true, item } : { reread: false, reason: "Созданный banner не найден при повторном чтении группы." };
      }
      case "create_test_segment": return { reread: true, item: await client.getSegment(result.id as number) };
      case "copy_test_lead_form": return { reread: true, item: publicFormConfiguration(await client.getLeadFormDetail(result.id as number)) };
      case "rename_test_lead_form": return { reread: true, item: publicFormConfiguration(await client.getLeadFormDetail(payload.form_id as number)) };
      case "rename_test_remarketing_counter": return { reread: true, item: publicCounterMetadata(await client.getRemarketingCounter(payload.counter_id as number)) };
      case "delete_test_remarketing_counter": return { reread: false, reason: "Test-счётчик удалён; detail-чтение после удаления не выполняется." };
      case "update_test_counter_goal": return { reread: true, items: (await client.listRemarketingCounterGoals(payload.counter_id as number)).filter((item) => Number(item.id) === Number(payload.goal_id)).map(publicCounterMetadata) };
      case "update_test_inapp_event_category": return { reread: true, item: publicSensitiveMetadata(await inAppEventFromPages(client, { appId: payload.app_id as number, trackerId: payload.tracker_id as number, eventId: payload.event_id as number })) as VkObject };
      case "send_test_lead": return { reread: true, item: publicFormConfiguration(await client.getLeadFormDetail(payload.form_id as number)), test_lead_sent: true };
      case "create_test_sharing_key": return { reread: false, reason: "Ключ намеренно не перечитывается: список содержит bearer-secret. Для отзыва используйте key_handle в текущем MCP-сеансе." };
      case "revoke_created_sharing_key": return { reread: false, reason: "Ключ отозван; повторный list не выполняется, чтобы не обрабатывать bearer-secret." };
      case "share_test_skadnetwork_ids":
      case "withdraw_test_skadnetwork_ids": return { reread: true, item: skAdNetworkMetadata(await client.getAppleAppSkAdNetworkStatus(payload.app_id as number)) };
      case "copy_test_survey_form": return { reread: true, item: publicFormConfiguration(await client.getSurveyFormDetail(result.id as number)) };
      case "manage_test_lead_forms_archive": return { reread: true, items: await Promise.all((payload.form_ids as number[]).map(async (id) => publicFormConfiguration(await client.getLeadFormDetail(id)))) };
      case "manage_test_survey_forms_archive": return { reread: true, items: await Promise.all((payload.form_ids as number[]).map(async (id) => publicFormConfiguration(await client.getSurveyFormDetail(id)))) };
      case "rename_test_ad_plan":
      case "delete_test_ad_plan": return { reread: true, item: await client.getAdPlan(payload.ad_plan_id as number) };
      case "rename_test_campaign": return { reread: true, item: await client.getCampaign(payload.campaign_id as number) };
      case "block_test_ad_plans": return { reread: true, items: await Promise.all((payload.ad_plan_ids as number[]).map((id) => client.getAdPlan(id))) };
      case "block_test_ad_groups": return { reread: true, items: await Promise.all((payload.ad_group_ids as number[]).map((id) => client.getAdGroup(id))) };
      case "block_test_banners": return { reread: true, items: await Promise.all((payload.banner_ids as number[]).map((id) => client.getBanner(id))) };
      case "remoderate_test_banners": return { reread: true, items: await Promise.all((payload.banner_ids as number[]).map((id) => client.getBanner(id))) };
      case "rename_test_ad_group":
      case "delete_test_ad_group": return { reread: true, item: await client.getAdGroup(payload.ad_group_id as number) };
      case "rename_test_banner": return { reread: true, item: await client.getBanner(payload.banner_id as number) };
      case "rename_test_segment":
      case "delete_test_segment":
      case "add_test_segment_relation":
      case "delete_test_segment_relation": return { reread: true, item: await client.getSegment(payload.segment_id as number) };
      case "update_test_pricelist": return { reread: true, item: await pricelistFromPages(client, payload.pricelist_id as number) };
      case "create_test_async_report": return { reread: true, item: await client.getCustomReport(result.id as number) };
      case "delete_test_async_report": return { reread: false, reason: "Временный отчёт удалён; detail-чтение после удаления не выполняется." };
      case "upload_static_image": return { reread: false, reason: "Для static content не подтверждён безопасный GET endpoint; возвращён ответ upload.", content_id: result.id ?? null };
      case "upload_html5": return { reread: false, reason: "Для HTML5 content не подтверждён безопасный GET endpoint; возвращён ответ upload.", content_id: result.id ?? null };
      case "upload_test_video": return { reread: false, reason: "Для video content не подтверждён безопасный GET endpoint; возвращён ответ upload.", content_id: result.id ?? null };
      case "upload_lead_form_logo": return { reread: false, reason: "VK API не документирует безопасное чтение загруженного файла; возвращён только metadata upload.", image_id: result.id ?? null };
      case "create_test_offer_batch": return { reread: false, reason: "Batch API возвращает task metadata; detail-чтение доступно отдельным инструментом только для test-прайс-листа." };
      case "export_leads": return { reread: false, reason: "Экспорт лидов не сохраняется сервером и не попадает в audit." };
      case "export_survey_respondents": return { reread: false, reason: "Экспорт ответов опроса не сохраняется сервером и не попадает в audit." };
      case "upload_test_remarketing_user_list": return { reread: false, reason: "Содержимое списка и его история не читаются после загрузки; возвращён ответ VK Ads без исходных записей." };
      case "rename_test_remarketing_user_list":
      case "delete_test_remarketing_user_list": return { reread: true, item: remarketingListMetadata(await client.getRemarketingUserList(payload.list_id as number)) };
      case "connect_agency_client": return { reread: false, reason: "Повторное чтение клиентов агентства может содержать PII; возвращён ответ операции подключения." };
      case "create_test_local_geo": {
        const item = (await client.listLocalGeo()).find((candidate) => Number(candidate.id) === Number(result.id));
        return item ? { reread: true, item } : { reread: false, reason: "Созданное local geo не найдено при повторном чтении списка." };
      }
      case "update_test_local_geo": return { reread: true, item: itemFromList(await client.listLocalGeo(), payload.local_geo_id as number, "Local geo") };
      case "delete_test_local_geo": return { reread: false, reason: "Local geo удалён; повторное detail-чтение намеренно не выполняется." };
    }
  } catch {
    return { reread: false, reason: "VK Ads не вернул карточку после записи; результат записи сохранён в audit без тела ответа." };
  }
}

function publicAccount(user: VkObject) {
  const text = (value: unknown): string | null => value === null || value === undefined ? null : String(value);
  return {
    id: user.id ?? null,
    username: text(user.username),
    currency: text(user.currency),
    info_currency: text(user.info_currency),
    status: text(user.status),
    timezone: text(user.timezone),
  };
}

/** Не выдаёт ответы формы, телефон, email, имя или произвольные поля лида. */
function publicLeadMetadata(lead: VkObject): VkObject {
  const allowed = ["id", "form_id", "form_name", "ad_plan_id", "ad_group_id", "banner_id", "created_at", "status"];
  return Object.fromEntries(allowed.flatMap((key) => Object.prototype.hasOwnProperty.call(lead, key) ? [[key, lead[key]]] : []));
}

/** Идентичная политика для лидов и ответов опросов: никакого PII или ответов. */
function publicRespondentMetadata(respondent: VkObject): VkObject {
  const allowed = ["id", "form_id", "form_name", "ad_plan_id", "ad_group_id", "banner_id", "created_at", "status"];
  return Object.fromEntries(allowed.flatMap((key) => Object.prototype.hasOwnProperty.call(respondent, key) ? [[key, respondent[key]]] : []));
}

/**
 * Настройки форм иногда содержат email/телефон получателей уведомлений. Не
 * возвращаем такие реквизиты и не выдаём произвольные поля, даже read-only.
 */
function publicFormConfiguration(form: VkObject): VkObject {
  const forbidden = /(?:answer|respondent|phone|email|contact|notification|recipient|webhook|token|secret|password)/iu;
  const sanitize = (value: unknown, key = ""): unknown => {
    if (forbidden.test(key)) return undefined;
    if (Array.isArray(value)) return value.map((item) => sanitize(item)).filter((item) => item !== undefined);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as VkObject).flatMap(([childKey, childValue]) => {
      const safe = sanitize(childValue, childKey);
      return safe === undefined ? [] : [[childKey, safe]];
    }));
    return value;
  };
  return sanitize(form) as VkObject;
}

/** Общая строгая проекция для ОРД и финансовых capability-инструментов. */
function publicSensitiveMetadata(value: unknown): unknown {
  const forbidden = /(?:name|phone|email|password|login|username|recipient|webhook|inn|kpp|bank|bik|account|requisite|address|contract|document|file|url|link|site|token|secret|key|signature|auth|payment|wallet|card)/iu;
  if (Array.isArray(value)) return value.map(publicSensitiveMetadata).filter((item) => item !== undefined);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as VkObject).flatMap(([key, child]) => {
    if (forbidden.test(key)) return [];
    const safe = publicSensitiveMetadata(child);
    return safe === undefined ? [] : [[key, safe]];
  }));
}

/** Клиент агентства может быть физлицом: оставляем только технические признаки связи. */
function publicAgencyClientMetadata(value: VkObject): VkObject {
  const allowed = ["id", "user_id", "status", "access_type", "role", "created", "updated", "is_active"];
  return Object.fromEntries(allowed.flatMap((key) => Object.hasOwn(value, key) ? [[key, value[key]]] : []));
}

/** Счётчик может иметь настройки/реквизиты владельца: возвращаем только техническую metadata. */
function publicCounterMetadata(value: VkObject): VkObject {
  const allowed = ["id", "name", "status", "type", "user_id", "created", "created_at", "updated", "updated_at", "is_active"];
  return Object.fromEntries(allowed.flatMap((key) => Object.hasOwn(value, key) ? [[key, value[key]]] : []));
}

function findAgencyClient(items: VkObject[], clientId: number, managerId?: number): VkObject {
  const item = items.find((candidate) => {
    const candidateClientId = Number(candidate.client_id ?? candidate.user_id ?? candidate.id);
    const manager = candidate.manager;
    const candidateManagerId = Number(candidate.manager_id ?? (manager && typeof manager === "object" ? (manager as VkObject).id : undefined));
    return candidateClientId === clientId && (managerId === undefined || candidateManagerId === managerId);
  });
  if (!item) throw new Error("Клиент не найден среди доступных связей текущего credential.");
  return publicAgencyClientMetadata(item);
}

/** Права роли не обходятся: 403/404/405 возвращаются как состояние capability. */
async function capabilityRead(action: () => Promise<unknown>): Promise<VkObject> {
  try {
    return { available: true, data: publicSensitiveMetadata(await action()) };
  } catch (error) {
    if (error instanceof VkAdsApiError && [403, 404, 405].includes(error.status)) {
      return { available: false, http_status: error.status, reason: "Метод недоступен для текущего credential или роли; данные кабинета не изменялись." };
    }
    throw error;
  }
}

function readId(args: Record<string, unknown>): number {
  return z.object({ id: z.number().int().positive() }).parse(args).id;
}

async function callReadTool(
  client: VkAdsClient,
  toolName: (typeof callableReadTools)[number],
  args: Record<string, unknown>,
): Promise<VkObject> {
  const page = () => z.object(pagingSchema).parse(args);

  switch (toolName) {
    case "vk_status":
      return { authenticated: true, account: publicAccount(await client.getUser()) };
    case "vk_get_user":
      return { account: publicAccount(await client.getUser()) };
    case "vk_get_ad_plans": {
      const { offset, limit, fields, user_id } = z.object({ ...pagingSchema, fields: z.array(z.enum(VERIFIED_AD_PLAN_FIELDS)).min(1).max(VERIFIED_AD_PLAN_FIELDS.length).optional(), user_id: z.number().int().positive().optional() }).parse(args);
      return normalizePaged(await (user_id === undefined ? client.listAdPlans(offset, limit, fields) : client.listAdPlans(offset, limit, fields, user_id)));
    }
    case "vk_get_ad_plan":
      return client.getAdPlan(readId(args));
    case "vk_get_campaigns": {
      const { offset, limit, user_id } = z.object({ ...pagingSchema, user_id: z.number().int().positive().optional() }).parse(args);
      return normalizePaged(await (user_id === undefined ? client.listCampaigns(offset, limit) : client.listCampaigns(offset, limit, user_id)));
    }
    case "vk_get_campaign":
      return client.getCampaign(readId(args));
    case "vk_get_ad_groups": {
      const { offset, limit, fields, user_id } = z.object({ ...pagingSchema, fields: z.array(z.enum(VERIFIED_AD_GROUP_FIELDS)).min(1).max(VERIFIED_AD_GROUP_FIELDS.length).optional(), user_id: z.number().int().positive().optional() }).parse(args);
      return normalizePaged(await (user_id === undefined ? client.listAdGroups(offset, limit, fields) : client.listAdGroups(offset, limit, fields, user_id)));
    }
    case "vk_get_ad_group":
      return client.getAdGroup(readId(args));
    case "vk_get_banners": {
      const { offset, limit, ad_group_id, fields, user_id } = z.object({
        ...pagingSchema,
        ad_group_id: z.number().int().positive().optional(),
        fields: z.array(z.enum(verifiedBannerFields)).min(1).max(40).optional(),
        user_id: z.number().int().positive().optional(),
      }).parse(args);
      return normalizePaged(await client.listBanners(offset, limit, {
        ...(ad_group_id !== undefined ? { adGroupId: ad_group_id } : {}),
        ...(fields ? { fields } : {}),
        ...(user_id !== undefined ? { userId: user_id } : {}),
      }));
    }
    case "vk_get_banner":
      return client.getBanner(readId(args));
    case "vk_get_urls":
      return client.getUrl(readId(args));
    case "vk_resolve_url": {
      const { url } = z.object({ url: z.string().min(1).max(2_048).url() }).parse(args);
      return resolveAdvertisingUrl(url);
    }
    case "vk_get_banner_patterns":
      return { items: await client.listBannerPatterns() };
    case "vk_get_banner_fields": {
      const { offset, limit } = page();
      return normalizePaged(await client.listBannerFieldDefinitions(offset, limit));
    }
    case "vk_get_statistics": {
      const { object_type, period, ids, date_from, date_to, metrics } = z.object(statisticsInputSchema).parse(args);
      const statistics = await client.getStatistics({
        objectType: object_type,
        period,
        ...(ids ? { ids } : {}),
        ...(date_from ? { dateFrom: date_from } : {}),
        ...(date_to ? { dateTo: date_to } : {}),
        metrics,
      });
      return { items: statistics.items, total: statistics.total };
    }
    case "vk_get_goal_statistics": {
      const { object_type, ids, date_from, date_to } = z.object(goalStatisticsInputSchema).parse(args);
      const statistics = await client.getGoalStatistics({ objectType: object_type, ids, dateFrom: date_from, dateTo: date_to });
      return { items: statistics.items, total: statistics.total };
    }
    case "vk_get_packages":
      return { items: await client.listPackages() };
    case "vk_get_package":
      return { item: packageFromList(await client.listPackages(), readId(args)) };
    case "vk_get_package_fields": {
      const items = await client.listPackages();
      return { fields: observedFields(items), observed_items: items.length };
    }
    case "vk_get_packages_pads":
      return { items: await client.listPackagePads() };
    case "vk_get_search_phrases":
      return { items: await client.listSearchPhrases() };
    case "vk_get_reach_forecast": {
      const parsed = z.object(reachForecastInputSchema).superRefine((value, context) => {
        if ((value.package_ids === undefined) === (value.campaign_id === undefined)) {
          context.addIssue({ code: "custom", message: "Укажите package_ids или campaign_id, но не оба поля." });
        }
      }).parse(args);
      return client.getReachForecast({
        ...(parsed.package_ids ? { packageIds: parsed.package_ids } : {}),
        ...(parsed.campaign_id ? { campaignId: parsed.campaign_id } : {}),
        targetings: parsed.targetings,
      });
    }
    case "vk_get_currencies":
      return { items: await client.listCurrencies() };
    case "vk_get_remarketing_counters": {
      return { items: await client.listRemarketingCounters() };
    }
    case "vk_get_remarketing_counter":
      return { item: publicCounterMetadata(await client.getRemarketingCounter(readId(args))) };
    case "vk_get_counter_goals": {
      const id = readId(args);
      await itemFromList(await client.listRemarketingCounters(), id, "Счётчик ремаркетинга");
      try {
        return { counter_id: id, available: true, items: await client.listRemarketingCounterGoals(id) };
      } catch (error) {
        if (error instanceof VkAdsApiError && (error.status === 403 || error.status === 404)) {
          return { counter_id: id, available: false, items: [], reason: "Текущий credential не имеет доступа к целям этого счётчика." };
        }
        throw error;
      }
    }
    case "vk_get_remarketing_lists": {
      const { offset, limit } = page();
      const result = await client.listRemarketingUserLists(offset, limit);
      return { ...normalizePaged(result), items: result.items.map(remarketingListMetadata) };
    }
    case "vk_get_remarketing_list":
      return { item: await remarketingListFromPages(client, readId(args)) };
    case "vk_get_inapp_events": {
      const { offset, limit } = page();
      return normalizePaged(await client.listInAppEvents(offset, limit));
    }
    case "vk_get_inapp_event_categories":
      return { items: await client.listInAppEventCategories() };
    case "vk_get_inapp_stats": {
      const { object_type, date_from, date_to, ids, attribution, conversion_type } = z.object(inAppStatisticsInputSchema).parse(args);
      const statistics = await client.getInAppStatistics({
        objectType: object_type,
        dateFrom: date_from,
        dateTo: date_to,
        ...(ids ? { ids } : {}),
        ...(attribution ? { attribution } : {}),
        ...(conversion_type ? { conversionType: conversion_type } : {}),
      });
      return { items: statistics.items, total: statistics.total };
    }
    case "vk_get_offline_conversions": {
      const { object_type, ids, date_from, date_to } = z.object(offlineConversionStatisticsInputSchema).parse(args);
      return client.getOfflineConversionStatistics({ objectType: object_type, ids, dateFrom: date_from, dateTo: date_to });
    }
    case "vk_get_realtime_stats": {
      const { object_type } = z.object({ object_type: z.enum(["ad_plans", "banners", "campaigns", "users"]).default("users") }).parse(args);
      return client.getFastStatistics(object_type);
    }
    case "vk_get_segments": {
      const { offset, limit } = page();
      return normalizePaged(await client.listSegments(offset, limit));
    }
    case "vk_get_segment":
      return client.getSegment(readId(args));
    case "vk_get_local_geos":
      return { items: await client.listLocalGeo() };
    case "vk_get_throttling":
      return client.getThrottling();
    case "vk_get_targetings_tree":
      return client.getTargetingsTree();
    case "vk_get_pads_tree":
      return { items: await client.listPadsTree() };
    case "vk_get_mobile_categories":
      return { items: await client.listMobileCategories() };
    case "vk_get_mobile_apps": {
      const parsed = z.discriminatedUnion("platform", [
        z.object({ platform: z.literal("ios"), app_id: z.number().int().positive() }),
        z.object({ platform: z.literal("android"), package_name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/) }),
      ]).parse(args);
      return parsed.platform === "ios"
        ? client.getMobileApp({ platform: "ios", appId: parsed.app_id })
        : client.getMobileApp({ platform: "android", packageName: parsed.package_name });
    }
    case "vk_get_mobile_app_users": {
      const { offset, limit } = page();
      const response = await client.listMobileAppUsers(offset, limit);
      return { ...normalizePaged(response), items: response.items.map(mobileAppUserMetadata) };
    }
    case "vk_get_mobile_os":
      return { items: await client.listMobileOs() };
    case "vk_get_mobile_operators":
      return { items: await client.listMobileOperators() };
    case "vk_get_mobile_types":
      return { items: await client.listMobileTypes() };
    case "vk_get_mobile_vendors":
      return { items: await client.listMobileVendors() };
    case "vk_get_regions": {
      const { offset, limit, query, ids, parent_ids, flags } = z.object({
        ...pagingSchema,
        query: z.string().min(1).max(120).optional(),
        ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
        parent_ids: z.array(z.number().int().refine((id) => id === -1 || id > 0, "parent_ids принимает -1 или положительные ID")).min(1).max(50).optional(),
        flags: z.array(z.enum(["geo_tree", "geo_tree_extended", "rb_active"])).min(1).max(3).optional(),
      }).parse(args);
      return normalizePaged(await client.listRegions(offset, limit, {
        ...(query !== undefined ? { query } : {}),
        ...(ids ? { ids } : {}),
        ...(parent_ids ? { parentIds: parent_ids } : {}),
        ...(flags ? { flags } : {}),
      }));
    }
    case "vk_get_goals":
      return client.getGoals();
    case "vk_get_agency_clients":
      return { items: (await client.listAgencyClients()).map(publicAgencyClientMetadata) };
    case "vk_get_manager_clients":
      return { items: (await client.listManagerClients()).map(publicAgencyClientMetadata) };
    case "vk_get_sharing_keys":
      return { items: (await client.listSharingKeys()).map(sharingKeyMetadata) };
    case "vk_select_client": {
      const { user_id } = z.object({ user_id: z.number().int().positive() }).parse(args);
      const campaigns = await client.listCampaigns(0, 1, user_id);
      return {
        user_id,
        read_scope_verified: true,
        campaigns_count: campaigns.count,
        limitation: "Credential и write-scope не переключаются; user_id применяется только к этому read-запросу.",
      };
    }
    case "vk_get_lead_forms": {
      const { offset, limit } = page();
      return normalizePaged(await client.listLeadForms(offset, limit));
    }
    case "vk_get_leads": {
      const parsed = z.object({
        ...pagingSchema,
        form_ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
        ad_plan_ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
        ad_group_ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
        banner_ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
        created_at_gte: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).optional(),
        created_at_lte: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).optional(),
      }).parse(args);
      const response = await client.listLeads(parsed.offset, parsed.limit, {
        ...(parsed.form_ids ? { formIds: parsed.form_ids } : {}),
        ...(parsed.ad_plan_ids ? { adPlanIds: parsed.ad_plan_ids } : {}),
        ...(parsed.ad_group_ids ? { adGroupIds: parsed.ad_group_ids } : {}),
        ...(parsed.banner_ids ? { bannerIds: parsed.banner_ids } : {}),
        ...(parsed.created_at_gte ? { createdAtGte: parsed.created_at_gte } : {}),
        ...(parsed.created_at_lte ? { createdAtLte: parsed.created_at_lte } : {}),
      });
      return { count: response.count, offset: response.offset, items: response.items.map(publicLeadMetadata) };
    }
    case "vk_export_csv": {
      const rows = exportRowsSchema.parse(args.rows) as ExportRow[];
      const exported = toCsv(rows);
      return { filename: "vk-ads-export.csv", content_type: "text/csv; charset=utf-8", columns: exported.columns, content: exported.content };
    }
    case "vk_export_xlsx": {
      const rows = exportRowsSchema.parse(args.rows) as ExportRow[];
      const exported = toXlsx(rows);
      return {
        filename: "vk-ads-export.xlsx",
        content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        columns: exported.columns,
        content_base64: exported.content,
        byte_length: exported.byteLength,
      };
    }
    case "analytics_compare_periods": {
      const { current, previous } = z.object({
        current: z.record(z.string(), z.number().finite()),
        previous: z.record(z.string(), z.number().finite()),
      }).parse(args);
      return { items: comparePeriods(current, previous) };
    }
    case "analytics_rank_campaigns": {
      const { rows, metric } = z.object({ rows: z.array(analyticsRowSchema).min(1), metric: z.enum(["ctr", "cpc", "cpa", "spent"]) }).parse(args);
      return { items: rankRows(rows, metric) };
    }
    case "analytics_find_inefficient_campaigns": {
      const { rows, thresholds } = z.object({ rows: z.array(analyticsRowSchema).min(1), thresholds: analyticsThresholdsSchema }).parse(args);
      return { items: findInefficientRows(rows, {
        ...(thresholds.min_spent !== undefined ? { minSpent: thresholds.min_spent } : {}),
        ...(thresholds.max_cpc !== undefined ? { maxCpc: thresholds.max_cpc } : {}),
        ...(thresholds.max_cpa !== undefined ? { maxCpa: thresholds.max_cpa } : {}),
        ...(thresholds.min_ctr !== undefined ? { minCtr: thresholds.min_ctr } : {}),
      }) };
    }
    case "analytics_recommendations": {
      const { rows, thresholds } = z.object({ rows: z.array(analyticsRowSchema).min(1), thresholds: analyticsThresholdsSchema }).parse(args);
      return { items: buildRecommendations(rows, {
        ...(thresholds.max_cpc !== undefined ? { maxCpc: thresholds.max_cpc } : {}),
        ...(thresholds.max_cpa !== undefined ? { maxCpa: thresholds.max_cpa } : {}),
        ...(thresholds.min_ctr !== undefined ? { minCtr: thresholds.min_ctr } : {}),
      }) };
    }
    case "analytics_anomalies": {
      const { points, threshold } = z.object({ points: z.array(analyticsTimeSeriesPointSchema).min(5).max(10_000), threshold: z.number().finite().min(1).max(20).default(3.5) }).parse(args);
      return { items: detectAnomalies(points, threshold) };
    }
    case "analytics_delivery_issues": {
      const { items } = z.object({ items: z.array(deliveryDiagnosticInputSchema).min(1).max(10_000) }).parse(args);
      return { items: diagnoseDelivery(items) };
    }
  }
}

export function createServer(client: VkAdsClient, mode: ServerMode, options: { uploadDir?: string; piiUploadDir?: string; allowPiiUploads?: boolean; allowAgencyWrites?: boolean; allowSharingKeyRevoke?: boolean; allowSkAdNetworkWrites?: boolean; skAdNetworkTestAppIds?: number[]; inAppEventTestAppIds?: number[]; allowInAppEventCategoryWrites?: boolean; allowRemarketingCounterWrites?: boolean; remarketingCounterTestIds?: number[]; connectionId?: string; profileName?: string } = {}): McpServer {
  const normalizeTestWritePayload = (operation: TestWriteOperation, payload: Record<string, unknown>, _legacyUploadDir?: string) => normalizeTestWritePayloadCore(
    operation,
    payload,
    options.uploadDir,
    options.piiUploadDir,
    options.allowPiiUploads,
    options.allowAgencyWrites,
  );
  const server = new McpServer({ name: "vk-ads-mcp", version: "0.1.0" });
  const writeGate = new WriteGate(mode === "write");
  const connectionId = options.connectionId ?? "default";
  const profileName = options.profileName ?? "default";
  /** Только content, загруженный этим MCP после локальной проверки размеров. */
  const uploadedImages = new Map<number, KnownStaticImage>();
  /** Secret хранится лишь до отзыва в памяти текущего процесса; handle не является ключом VK Ads. */
  const sessionSharingKeys = new Map<string, string>();

  server.registerTool(
    "get_provider_context",
    {
      title: "Контекст VK Ads подключения",
      description: "Read-only: возвращает безопасный контекст локального подключения и правила вызова инструментов.",
      outputSchema: {
        connection_id: z.string(),
        profile: z.string(),
        provider: z.literal("vk_ads"),
        mode: z.enum(["readonly", "write"]),
        api_base_url: z.literal("https://ads.vk.com/api/v2"),
        rate_limit: z.string(),
        catalog: z.object({ total: z.number().int(), executable: z.number().int() }),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => textAndData(
      {
        connection_id: connectionId,
        profile: profileName,
        provider: "vk_ads",
        mode,
        api_base_url: "https://ads.vk.com/api/v2" as const,
        rate_limit: "Один последовательный API-запрос в секунду на локальный credential.",
        catalog: { total: toolCatalog.length, executable: toolCatalog.filter((tool) => tool.implemented).length },
      },
      "Контекст VK Ads получен.",
    ),
  );

  server.registerTool(
    "account_profile_get",
    {
      title: "Активный профиль VK Ads",
      description: "Read-only: возвращает профиль, выбранный при запуске. Не раскрывает токен или client secret и не переключает подключение во время MCP-сеанса.",
      outputSchema: { profile: z.string(), connection_id: z.string(), selection: z.literal("startup_configuration") },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => textAndData({ profile: profileName, connection_id: connectionId, selection: "startup_configuration" as const }, "Активный профиль VK Ads получен."),
  );

  server.registerTool(
    "banner_fields_list",
    {
      title: "Поля объекта banner",
      description: "Read-only: возвращает поля banner, подтверждённые живым VK Ads API. Не делает запрос к кабинету.",
      outputSchema: { fields: z.array(z.string()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => textAndData({ fields: [...verifiedBannerFields] }, "Поля banner получены."),
  );

  const entityFieldsTool = (name: string, title: string, fields: readonly string[]) => server.registerTool(
    name,
    {
      title,
      description: "Read-only: возвращает поля, подтверждённые живым VK Ads API. Не делает запрос к кабинету.",
      outputSchema: { fields: z.array(z.string()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => textAndData({ fields: [...fields] }, "Список полей получен."),
  );
  entityFieldsTool("ad_plan_fields_list", "Поля объекта ad_plan", VERIFIED_AD_PLAN_FIELDS);
  entityFieldsTool("ad_group_fields_list", "Поля объекта ad_group", VERIFIED_AD_GROUP_FIELDS);

  server.registerTool(
    "creative_preflight",
    {
      title: "Проверить готовность креатива",
      description: "Read-only: проверяет существование package и безопасную форму ID контента. Не создаёт banner и явно показывает, если raw-контракт формата ещё не подтверждён.",
      inputSchema: {
        package_id: z.number().int().positive(),
        content_ids: z.record(z.string().min(1).max(80), z.number().int().positive()).default({}),
        textblocks: z.record(z.string().min(1).max(80), z.string().min(1).max(10_000)).default({}),
      },
      outputSchema: {
        package_found: z.boolean(),
        supplied_content_keys: z.array(z.string()),
        supplied_textblock_keys: z.array(z.string()),
        ready_for_banner_write: z.boolean(),
        blocking_reason: z.string(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ package_id, content_ids, textblocks }) => {
      const packageFound = (await client.listPackages()).some((item) => item.id === package_id);
      return textAndData({
        package_found: packageFound,
        supplied_content_keys: Object.keys(content_ids).sort(),
        supplied_textblock_keys: Object.keys(textblocks).sort(),
        ready_for_banner_write: false,
        blocking_reason: packageFound
          ? "Создание banner заблокировано: минимальный raw payload и pattern contract этого пакета ещё не подтверждены живым API."
          : "Package не найден в текущем кабинете.",
      }, "Creative preflight выполнен; запись не производилась.");
    },
  );

  const preflightOutputSchema = {
    ready: z.boolean(),
    checks: z.array(z.object({ code: z.string(), status: z.enum(["pass", "fail"]), message: z.string() })),
  };

  server.registerTool(
    "ad_plan_preflight",
    {
      title: "Проверить ad plan до создания",
      description: "Read-only: проверяет доступность package и совместимость objective по наблюдаемому packages.json. Не создаёт кампанию.",
      inputSchema: {
        package_id: z.number().int().positive(),
        objective: z.string().trim().min(1).max(80),
      },
      outputSchema: preflightOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (payload) => {
      const result = await preflightTestAdPlan(client, payload);
      return textAndData(result, result.ready
        ? "Ad plan готов к preview: package и objective подтверждены."
        : "Ad plan не готов: исправьте пункты со статусом fail; запись не выполнялась.");
    },
  );

  server.registerTool(
    "ad_group_preflight",
    {
      title: "Проверить ad group до создания",
      description: "Read-only: проверяет test-родителя, package и подтверждённую форму geo/age targetings. Не создаёт группу.",
      inputSchema: {
        ad_plan_id: z.number().int().positive(),
        package_id: z.number().int().positive(),
        targetings: confirmedTestGroupTargetingsSchema,
      },
      outputSchema: preflightOutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (payload) => {
      const result = await preflightTestAdGroup(client, payload);
      return textAndData(result, result.ready
        ? "Ad group готова к preview: родитель, package и targetings подтверждены."
        : "Ad group не готова: исправьте пункты со статусом fail; запись не выполнялась.");
    },
  );

  server.registerTool(
    "media_validate",
    {
      title: "Проверить файл для загрузки",
      description: "Read-only: проверяет файл из VK_ADS_UPLOAD_DIR по пути, сигнатуре, размеру и SHA-256. Не отправляет файл в VK Ads и не создаёт контент.",
      inputSchema: {
        file_path: z.string().min(1).max(1_024),
        kind: z.enum(["image", "video"]),
      },
      outputSchema: {
        filename: z.string(),
        mime_type: z.string(),
        size: z.number().int().positive(),
        sha256: z.string().length(64),
        width: z.number().int().positive().nullable(),
        height: z.number().int().positive().nullable(),
        upload_ready: z.literal(true),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ file_path, kind }) => {
      if (!options.uploadDir) throw new Error("Для проверки media задайте VK_ADS_UPLOAD_DIR с локальным безопасным каталогом.");
      const media = kind === "image"
        ? validateImageUpload(file_path, options.uploadDir)
        : validateVideoUpload(file_path, options.uploadDir);
      return textAndData({
        filename: media.filename,
        mime_type: media.mimeType,
        size: media.size,
        sha256: media.sha256,
        width: "width" in media ? media.width : null,
        height: "height" in media ? media.height : null,
        upload_ready: true as const,
      }, "Файл прошёл локальную проверку; upload в VK Ads не выполнялся.");
    },
  );

  server.registerTool(
    "banner_preflight",
    {
      title: "Проверить banner до создания",
      description: "Read-only: проверяет обязательные поля, существование URL и group, а также размеры изображений, загруженных этим MCP-сеансом. Поддержан только live-подтверждённый test-шаблон package_id=2860, pattern 284.",
      inputSchema: {
        ad_group_id: z.number().int().positive(),
        primary_url_id: z.number().int().positive(),
        landscape_image_id: z.number().int().positive(),
        icon_image_id: z.number().int().positive(),
        title: z.string().trim().min(1).max(40),
        text: z.string().trim().min(1).max(90),
      },
      outputSchema: {
        ready: z.boolean(),
        checks: z.array(z.object({ code: z.string(), status: z.enum(["pass", "fail"]), message: z.string() })),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (payload) => {
      const result = await preflightConfirmedTestBanner(client, payload, uploadedImages);
      return textAndData(result, result.ready
        ? "Banner готов к preview: обязательные локальные проверки пройдены."
        : "Banner не готов: исправьте пункты со статусом fail; запись в VK Ads не выполнялась.");
    },
  );

  server.registerTool(
    "export_csv",
    {
      title: "Экспортировать данные в CSV",
      description: "Read-only: собирает переданные строки в CSV в памяти. Не пишет файл на диск и экранирует формулы таблиц.",
      inputSchema: { rows: exportRowsSchema },
      outputSchema: { filename: z.string(), content_type: z.string(), columns: z.array(z.string()), content: z.string() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ rows }) => {
      const exported = toCsv(rows as ExportRow[]);
      return textAndData({ filename: "vk-ads-export.csv", content_type: "text/csv; charset=utf-8", columns: exported.columns, content: exported.content }, "CSV сформирован в памяти.");
    },
  );

  server.registerTool(
    "export_xlsx",
    {
      title: "Экспортировать данные в XLSX",
      description: "Read-only: собирает переданные строки в XLSX в памяти. Не пишет файл на диск, не отправляет данные наружу и не интерпретирует текст как формулы.",
      inputSchema: { rows: exportRowsSchema },
      outputSchema: {
        filename: z.string(),
        content_type: z.literal("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
        columns: z.array(z.string()),
        content_base64: z.string().min(1),
        byte_length: z.number().int().positive(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ rows }) => {
      const exported = toXlsx(rows as ExportRow[]);
      return textAndData({
        filename: "vk-ads-export.xlsx",
        content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const,
        columns: exported.columns,
        content_base64: exported.content,
        byte_length: exported.byteLength,
      }, "XLSX сформирован в памяти.");
    },
  );

  server.registerTool(
    "statistics_export",
    {
      title: "Экспортировать статистику VK Ads",
      description: "Read-only: получает статистику по фиксированному API-контракту и сразу формирует CSV или XLSX в памяти. Не пишет файл на диск и не изменяет кабинет.",
      inputSchema: {
        ...statisticsInputSchema,
        format: z.enum(["csv", "xlsx"]),
        include_total: z.boolean().default(true),
      },
      outputSchema: {
        filename: z.string(),
        content_type: z.string(),
        columns: z.array(z.string()),
        row_count: z.number().int().nonnegative(),
        content: z.string().optional(),
        content_base64: z.string().optional(),
        byte_length: z.number().int().positive().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ object_type, period, ids, date_from, date_to, metrics, format, include_total }) => {
      const statistics = await client.getStatistics({
        objectType: object_type,
        period,
        ...(ids ? { ids } : {}),
        ...(date_from ? { dateFrom: date_from } : {}),
        ...(date_to ? { dateTo: date_to } : {}),
        metrics,
      });
      const rows = statisticsToExportRows({ items: statistics.items, total: statistics.total, includeTotal: include_total });
      if (format === "csv") {
        const exported = toCsv(rows);
        return textAndData({
          filename: "vk-ads-statistics.csv",
          content_type: "text/csv; charset=utf-8",
          columns: exported.columns,
          row_count: rows.length,
          content: exported.content,
        }, "Статистика VK Ads получена и экспортирована в CSV в памяти.");
      }
      const exported = toXlsx(rows);
      return textAndData({
        filename: "vk-ads-statistics.xlsx",
        content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        columns: exported.columns,
        row_count: rows.length,
        content_base64: exported.content,
        byte_length: exported.byteLength,
      }, "Статистика VK Ads получена и экспортирована в XLSX в памяти.");
    },
  );

  const analyticsOutputSchema = {
    items: z.array(z.record(z.string(), z.unknown())),
  };
  const analyticsTool = (
    name: "analytics_compare_periods" | "analytics_rank_campaigns" | "analytics_find_inefficient_campaigns" | "analytics_recommendations" | "analytics_anomalies" | "analytics_delivery_issues",
    title: string,
    description: string,
    inputSchema: Record<string, z.ZodType>,
  ) => server.registerTool(
    name,
    { title, description, inputSchema, outputSchema: analyticsOutputSchema, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true } },
    async (args) => textAndData(await callReadTool(client, name, args), "Аналитический расчёт выполнен локально."),
  );

  analyticsTool(
    "analytics_compare_periods",
    "Сравнить периоды",
    "Read-only: локально рассчитывает изменение метрик между двумя периодами; статистику сначала получает statistics_get.",
    { current: z.record(z.string(), z.number().finite()), previous: z.record(z.string(), z.number().finite()) },
  );
  analyticsTool(
    "analytics_rank_campaigns",
    "Ранжировать кампании",
    "Read-only: ранжирует переданные строки статистики по CTR, CPC, CPA или расходу.",
    { rows: z.array(analyticsRowSchema).min(1), metric: z.enum(["ctr", "cpc", "cpa", "spent"]) },
  );
  analyticsTool(
    "analytics_find_inefficient_campaigns",
    "Найти неэффективные кампании",
    "Read-only: находит строки статистики, не проходящие заданные пороги.",
    { rows: z.array(analyticsRowSchema).min(1), thresholds: analyticsThresholdsSchema },
  );
  analyticsTool(
    "analytics_recommendations",
    "Рекомендации по оптимизации",
    "Read-only: формирует рекомендации по строкам статистики и порогам; не изменяет кампании.",
    { rows: z.array(analyticsRowSchema).min(1), thresholds: analyticsThresholdsSchema },
  );
  analyticsTool(
    "analytics_anomalies",
    "Найти аномалии во временном ряду",
    "Read-only: ищет выбросы median absolute deviation по дневным точкам. Серии короче пяти точек не интерпретируются.",
    { points: z.array(analyticsTimeSeriesPointSchema).min(5).max(10_000), threshold: z.number().finite().min(1).max(20).default(3.5) },
  );
  analyticsTool(
    "analytics_delivery_issues",
    "Диагностировать delivery и модерацию",
    "Read-only: объясняет status, delivery и moderation_status в переданных объектах. Ничего не меняет в VK Ads.",
    { items: z.array(deliveryDiagnosticInputSchema).min(1).max(10_000) },
  );

  server.registerTool(
    "search_tools",
    {
      title: "Найти возможности VK Ads",
      description: "Ищет инструменты по каталогу. По умолчанию показывает только уже исполняемые; planned можно запросить отдельно, они не вызываются.",
      inputSchema: {
        query: z.string().max(120).default(""),
        category: z.string().max(60).optional(),
        include_planned: z.boolean().default(false),
      },
      outputSchema: {
        total: z.number().int().nonnegative(),
        items: z.array(z.object({
          name: z.string(), title: z.string(), category: z.string(), access: z.enum(["read", "write"]), implemented: z.boolean(),
        })),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ query, category, include_planned }) => {
      const items = searchCatalog(query, category).filter((tool) => include_planned || tool.implemented);
      return textAndData({ total: items.length, items }, "Каталог VK Ads найден.");
    },
  );

  server.registerTool(
    "call_read_tool",
    {
      title: "Вызвать read-only возможность VK Ads",
      description: "Единая точка вызова проверенных read-only возможностей из search_tools. Операции записи через неё запрещены.",
      inputSchema: {
        tool_name: z.enum(callableReadTools),
        arguments: z.record(z.string(), z.unknown()).default({}),
      },
      outputSchema: {
        tool_name: z.enum(callableReadTools),
        data: z.record(z.string(), z.unknown()),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ tool_name, arguments: args }) => textAndData(
      { tool_name, data: await callReadTool(client, tool_name, args) },
      "Read-only возможность VK Ads выполнена.",
    ),
  );

  // Публичные имена инструментов, но весь разбор аргументов
  // остаётся в едином allowlist callReadTool: alias не получает raw path или query.
  for (const name of callableReadTools.filter((toolName) => toolName.startsWith("vk_"))) {
    const catalogTool = toolCatalog.find((tool) => tool.name === name);
    const title = catalogTool?.title ?? name;
    server.registerTool(
      name,
      {
        title,
        description: `Read-only: ${title}. Аргументы передаются в поле arguments и проверяются тем же allowlist, что и call_read_tool.`,
        inputSchema: { arguments: z.record(z.string(), z.unknown()).default({}) },
        outputSchema: { data: z.record(z.string(), z.unknown()) },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      },
      async ({ arguments: args }) => textAndData({ data: await callReadTool(client, name, args) }, "Read-only возможность VK Ads выполнена."),
    );
  }

  server.registerTool(
    "auth_check",
    {
      title: "Проверить доступ VK Ads",
      description: "Read-only: проверяет токен и возвращает безопасную сводку кабинета без email и токенов.",
      outputSchema: {
        authenticated: z.boolean(),
        account: z.object({
          id: z.union([z.string(), z.number()]).nullable(),
          username: z.string().nullable(),
          currency: z.string().nullable(),
          info_currency: z.string().nullable(),
          status: z.string().nullable(),
          timezone: z.string().nullable(),
        }),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      const account = publicAccount(await client.getUser());
      return textAndData({ authenticated: true, account }, "Доступ к VK Ads подтверждён.");
    },
  );

  const registerList = (
    name: string,
    title: string,
    description: string,
    list: (offset: number, limit: number) => Promise<VkPagedResponse>,
    maxLimit = 200,
  ) => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: maxLimit === 200 ? pagingSchema : {
          offset: z.number().int().min(0).default(0),
          limit: z.number().int().min(1).max(maxLimit).default(Math.min(100, maxLimit)),
        },
        outputSchema: {
          count: z.number().int().nonnegative(),
          offset: z.number().int().nonnegative(),
          items: z.array(z.record(z.string(), z.unknown())),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      },
      async ({ offset, limit }) => textAndData(normalizePaged(await list(offset, limit)), "Данные VK Ads получены."),
    );
  };

  registerList("ad_plans_list", "Список рекламных планов", "Read-only: GET /ad_plans.json.", client.listAdPlans.bind(client));
  registerList("ad_groups_list", "Список групп", "Read-only: GET /ad_groups.json.", client.listAdGroups.bind(client));
  registerList("campaigns_list", "Список кампаний API", "Read-only: GET /campaigns.json. Технический слой API.", client.listCampaigns.bind(client));
  registerList("banners_list", "Список объявлений", "Read-only: GET /banners.json.", client.listBanners.bind(client));
  registerList("regions_list", "Справочник регионов", "Read-only: GET /regions.json.", client.listRegions.bind(client));
  server.registerTool(
    "entity_get",
    {
      title: "Получить объект VK Ads по ID",
      description: "Read-only: читает проверенную детальную карточку ad plan, campaign, ad group или banner по ID.",
      inputSchema: { entity: z.enum(["ad_plan", "campaign", "ad_group", "banner"]), id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ entity, id }) => {
      const item = await ({
        ad_plan: () => client.getAdPlan(id),
        campaign: () => client.getCampaign(id),
        ad_group: () => client.getAdGroup(id),
        banner: () => client.getBanner(id),
      }[entity])();
      return textAndData({ item }, "Карточка объекта VK Ads получена.");
    },
  );

  server.registerTool(
    "url_get",
    {
      title: "Получить зарегистрированную ссылку",
      description: "Read-only: GET /urls/{id}.json. ID берётся из banner.urls.primary.id; URL не создаётся и не изменяется.",
      inputSchema: { id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => textAndData({ item: await client.getUrl(id) }, "Карточка зарегистрированной ссылки получена."),
  );

  server.registerTool(
    "url_resolve",
    {
      title: "Разобрать рекламную ссылку",
      description: "Локально разбирает HTTP(S) URL без сетевого запроса. Параметры token, secret, code и аналогичные редактируются в результате.",
      inputSchema: { url: z.string().min(1).max(2_048).url() },
      outputSchema: { result: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ url }) => textAndData({ result: resolveAdvertisingUrl(url) }, "Рекламная ссылка разобрана локально."),
  );

  server.registerTool(
    "urls_get_many",
    {
      title: "Получить несколько зарегистрированных ссылок",
      description: "Read-only: GET /urls/{id1,id2,...}.json. Читает только уже зарегистрированные URL и не создаёт новые.",
      inputSchema: { ids: z.array(z.number().int().positive()).min(2).max(50) },
      outputSchema: { items: z.array(z.record(z.string(), z.unknown())) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ ids }) => textAndData({ items: await client.getUrls(ids) }, "Зарегистрированные ссылки получены."),
  );

  const registerCatalog = (name: string, title: string, description: string, list: () => Promise<VkObject[]>) => {
    server.registerTool(
      name,
      {
        title,
        description,
        outputSchema: { items: z.array(z.record(z.string(), z.unknown())) },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      },
      async () => textAndData({ items: await list() }, "Справочник VK Ads получен."),
    );
  };

  const registerObject = (name: string, title: string, description: string, get: () => Promise<VkObject>) => {
    server.registerTool(
      name,
      {
        title,
        description,
        outputSchema: { item: z.record(z.string(), z.unknown()) },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      },
      async () => textAndData({ item: await get() }, "Справочник VK Ads получен."),
    );
  };

  registerCatalog("packages_list", "Список пакетов размещения", "Read-only: GET /packages.json.", client.listPackages.bind(client));
  server.registerTool(
    "package_get",
    {
      title: "Получить пакет размещения",
      description: "Read-only: находит пакет по ID в подтверждённом GET /packages.json. Не обращается к неподтверждённому /packages/{id}.json.",
      inputSchema: { id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => textAndData({ item: packageFromList(await client.listPackages(), id) }, "Пакет размещения получен из списка доступных пакетов."),
  );
  server.registerTool(
    "package_fields_list",
    {
      title: "Поля пакетов размещения",
      description: "Read-only: объединяет ключи из пакетов, доступных текущему кабинету. Это наблюдаемые поля list-ответа, а не неподтверждённая schema detail-endpoint.",
      outputSchema: { fields: z.array(z.string()), observed_items: z.number().int().nonnegative() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => {
      const items = await client.listPackages();
      return textAndData({ fields: observedFields(items), observed_items: items.length }, "Наблюдаемые поля пакетов получены.");
    },
  );
  server.registerTool(
    "reach_forecast_get",
    {
      title: "Прогноз охвата VK Ads",
      description: "POST v3 /projection.json. Не создаёт и не меняет кампании, но расходует квоту API. Принимает только allowlist таргетингов и package_ids либо campaign_id.",
      inputSchema: reachForecastInputSchema,
      outputSchema: { result: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input) => textAndData({ result: await client.getReachForecast({
      ...(input.package_ids ? { packageIds: input.package_ids } : {}),
      ...(input.campaign_id ? { campaignId: input.campaign_id } : {}),
      targetings: input.targetings,
    }) }, "Прогноз охвата VK Ads получен; кампании не изменялись."),
  );
  server.registerTool(
    "audit_pixel_check",
    {
      title: "Проверить audit-пиксель",
      description: "POST v3 /audit_pixel.json. Проверяет HTTPS audit pixel внутри VK Ads и возвращает разрешённые производные роли; не меняет кабинет и не делает сетевой запрос к пикселю со стороны MCP.",
      inputSchema: { audit_pixel: z.string().min(1).max(2_048).url() },
      outputSchema: { result: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ audit_pixel }) => textAndData({ result: await client.checkAuditPixel(audit_pixel) }, "Проверка audit-пикселя завершена."),
  );
  registerCatalog("package_pads_list", "Площадки пакетов", "Read-only: GET /packages_pads.json.", client.listPackagePads.bind(client));
  registerCatalog("currencies_list", "Список валют", "Read-only: GET /currencies.json.", client.listCurrencies.bind(client));
  registerCatalog("banner_patterns_list", "Шаблоны объявлений", "Read-only: GET /banner_patterns.json. Полные схемы pattern для выбора полей banner.", client.listBannerPatterns.bind(client));
  registerCatalog("banner_formats_list", "Форматы объявлений", "Read-only: GET /banner_formats.json. Legacy и migration-схемы форматов.", client.listBannerFormats.bind(client));
  registerList("banner_field_definitions_list", "Схема полей объявлений", "Read-only: GET /banner_fields.json. Официальные описания полей с пагинацией.", client.listBannerFieldDefinitions.bind(client));
  registerCatalog("remarketing_counters_list", "Счётчики ремаркетинга", "Read-only: GET /remarketing/counters.json.", client.listRemarketingCounters.bind(client));
  server.registerTool(
    "remarketing_counter_get",
    {
      title: "Получить счётчик ремаркетинга",
      description: "Read-only: документированный GET /remarketing/counters/{id}.json; чувствительные поля исключаются из ответа.",
      inputSchema: { id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => textAndData({ item: publicCounterMetadata(await client.getRemarketingCounter(id)) }, "Счётчик ремаркетинга получен по документированному detail-пути."),
  );
  server.registerTool(
    "remarketing_list_get",
    {
      title: "Получить metadata списка ремаркетинга",
      description: "Read-only: находит users list по ID в v3 metadata-списке. Контакты, хеши, файлы и история намеренно не запрашиваются.",
      inputSchema: { id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => textAndData({ item: await remarketingListFromPages(client, id) }, "Metadata списка ремаркетинга получены."),
  );
  registerCatalog("offline_goals_list", "Цели офлайн-конверсий", "Read-only: GET /remarketing/offline_goals.json. Только metadata целей.", client.listOfflineGoals.bind(client));
  server.registerTool(
    "offline_goal_get",
    {
      title: "Получить цель офлайн-конверсий",
      description: "Read-only: находит цель по ID в подтверждённом GET /remarketing/offline_goals.json. Исходные события и контакты не запрашиваются.",
      inputSchema: { id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => textAndData({ item: itemFromList(await client.listOfflineGoals(), id, "Цель офлайн-конверсий") }, "Цель офлайн-конверсий получена."),
  );
  registerList("pricelists_list", "Прайс-листы ремаркетинга", "Read-only: GET /remarketing/pricelists.json; VK Ads ограничивает страницу 50 объектами.", client.listPricelists.bind(client), 50);
  server.registerTool(
    "pricelist_get",
    {
      title: "Получить прайс-лист ремаркетинга",
      description: "Read-only: находит прайс-лист по ID в подтверждённых metadata-страницах GET /remarketing/pricelists.json. Содержимое фида и операции записи не выполняются.",
      inputSchema: { id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => textAndData({ item: await pricelistFromPages(client, id) }, "Прайс-лист ремаркетинга получен."),
  );
  registerCatalog("local_geo_list", "Локальные гео", "Read-only: GET /remarketing/local_geo.json.", client.listLocalGeo.bind(client));
  registerCatalog("inapp_event_categories_list", "Категории in-app событий", "Read-only: GET v1 /inapp_event_categories.json.", client.listInAppEventCategories.bind(client));
  registerList("lead_forms_list", "Лид-формы", "Read-only: GET v1 /lead_ads/lead_forms.json. Ответы и контакты лидов не запрашиваются.", client.listLeadForms.bind(client));
  server.registerTool(
    "lead_form_get",
    {
      title: "Получить metadata лид-формы",
      description: "Read-only: ищет лид-форму по ID в metadata-страницах. Ответы, контакты и экспорт лидов не запрашиваются.",
      inputSchema: { id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => textAndData({ item: await leadFormFromPages(client, id) }, "Metadata лид-формы получены."),
  );
  server.registerTool(
    "lead_form_details_get",
    {
      title: "Получить безопасную конфигурацию лид-формы",
      description: "Read-only: GET v1 /lead_ads/lead_forms/{id}.json. Из ответа исключаются ответы, контакты, получатели уведомлений и секреты.",
      inputSchema: { id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => textAndData({ item: publicFormConfiguration(await client.getLeadFormDetail(id)) }, "Безопасная конфигурация лид-формы получена."),
  );
  server.registerTool(
    "survey_form_get",
    {
      title: "Получить metadata опросной формы",
      description: "Read-only: ищет опросную форму по ID в metadata-страницах. Ответы респондентов и контакты не запрашиваются.",
      inputSchema: { id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => textAndData({ item: await surveyFormFromPages(client, id) }, "Metadata опросной формы получены."),
  );
  server.registerTool(
    "survey_form_details_get",
    {
      title: "Получить безопасную конфигурацию опросной формы",
      description: "Read-only: GET v1 /lead_ads/survey_forms/{id}.json. Ответы, контакты, получатели уведомлений и секреты исключаются.",
      inputSchema: { id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => textAndData({ item: publicFormConfiguration(await client.getSurveyFormDetail(id)) }, "Безопасная конфигурация опросной формы получена."),
  );
  registerList("survey_forms_list", "Опросные формы", "Read-only: GET v1 /lead_ads/survey_forms.json. Ответы респондентов и контакты не запрашиваются.", client.listSurveyForms.bind(client));
  server.registerTool(
    "respondents_list",
    {
      title: "Список респондентов опросов",
      description: "Read-only: GET v1 /lead_ads/respondents.json с allowlist-фильтрами. Ответы, контакты и произвольные поля респондентов исключаются.",
      inputSchema: {
        ...pagingSchema,
        form_ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
        ad_plan_ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
        ad_group_ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
        banner_ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
        created_at_gte: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).optional(),
        created_at_lte: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).optional(),
      },
      outputSchema: { count: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), items: z.array(z.record(z.string(), z.unknown())) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input) => {
      const response = await client.listRespondents(input.offset, input.limit, {
        ...(input.form_ids ? { formIds: input.form_ids } : {}),
        ...(input.ad_plan_ids ? { adPlanIds: input.ad_plan_ids } : {}),
        ...(input.ad_group_ids ? { adGroupIds: input.ad_group_ids } : {}),
        ...(input.banner_ids ? { bannerIds: input.banner_ids } : {}),
        ...(input.created_at_gte ? { createdAtGte: input.created_at_gte } : {}),
        ...(input.created_at_lte ? { createdAtLte: input.created_at_lte } : {}),
      });
      return textAndData({ count: response.count, offset: response.offset, items: response.items.map(publicRespondentMetadata) }, "Metadata респондентов получены без PII.");
    },
  );
  const registerCapabilityTool = (name: string, title: string, description: string, inputSchema: Record<string, z.ZodType>, read: (input: Record<string, unknown>) => Promise<unknown>) => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema,
        outputSchema: { available: z.boolean(), http_status: z.number().int().optional(), reason: z.string().optional(), data: z.unknown().optional() },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      },
      async (input) => textAndData(await capabilityRead(() => read(input)), "Проверка capability VK Ads завершена без записи в кабинет."),
    );
  };
  registerCapabilityTool("user_geo_search", "Поиск пользовательских гео", "Read-only capability: GET /user_geo.json. При 403/404/405 возвращает состояние доступности, не подменяя его пустым списком.", pagingSchema, (input) => client.listUserGeo(input.offset as number, input.limit as number));
  registerCapabilityTool("ord_user_status_get", "Статус ОРД пользователя", "Read-only capability: GET /ord_user.json. ФИО, телефон, ИНН, платёжные и иные персональные данные удаляются.", {}, () => client.getOrdUser());
  registerCapabilityTool("ord_partner_pads_list", "Площадки ОРД партнёра", "Read-only capability: GET v1 /ord/partner/pads.json. Роль партнёра не обходится.", {}, () => client.listOrdPartnerPads());
  registerCapabilityTool("ord_partner_pad_get", "Площадка ОРД партнёра", "Read-only capability: GET v1 /ord/partner/pads/{id}.json; чувствительные реквизиты удаляются.", { id: z.number().int().positive() }, (input) => client.getOrdPartnerPad(input.id as number));
  registerCapabilityTool("ord_partner_subagents_list", "Субагенты ОРД партнёра", "Read-only capability: GET v1 /ord/partner/subagents.json; персональные и договорные данные удаляются.", pagingSchema, (input) => client.listOrdPartnerSubagents(input.offset as number, input.limit as number));
  registerCapabilityTool("ord_partner_subagent_get", "Субагент ОРД партнёра", "Read-only capability: GET v1 /ord/partner/subagents/{id}.json; персональные и договорные данные удаляются.", { id: z.number().int().positive() }, (input) => client.getOrdPartnerSubagent(input.id as number));
  registerCapabilityTool("ord_partner_acts_list", "Акты ОРД партнёра", "Read-only capability: GET v1 /ord/partner/acts/{month_start}.json, где month_start имеет вид YYYY-MM-01. Возвращаются только безопасные metadata.", { month_start: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/) }, (input) => client.listOrdPartnerActs(input.month_start as string));
  registerCapabilityTool("ord_partner_act_stat_get", "Статистика акта ОРД партнёра по площадке", "Read-only capability: GET v1 /ord/partner/acts/{month_start}/{ord_pad_id}.json. Реквизиты, договоры, акты и файлы удаляются.", { month_start: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/), ord_pad_id: z.number().int().positive() }, (input) => client.getOrdPartnerActStatByPad(input.month_start as string, input.ord_pad_id as number));
  registerCapabilityTool("ord_agency_acts_list", "Акты ОРД агентства", "Read-only capability: GET /ord/agency/acts.json с обязательным month_start=YYYY-MM-01. Реквизиты, договоры и файлы удаляются.", { ...pagingSchema, month_start: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/) }, (input) => client.listOrdAgencyActs(input.month_start as string, input.offset as number, input.limit as number));
  registerCapabilityTool("ord_agency_client_acts_list", "Акты клиента ОРД агентства", "Read-only capability: GET /ord/agency/{client_id}/acts.json с обязательным month_start=YYYY-MM-01. Реквизиты, договоры и файлы удаляются.", { ...pagingSchema, client_id: z.number().int().positive(), month_start: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/) }, (input) => client.getOrdAgencyClientActs(input.client_id as number, input.month_start as string, input.offset as number, input.limit as number));
  registerCapabilityTool("ord_agency_report_list", "Отчёты ОРД агентства", "Read-only capability: GET /ord/agency/report.json с обязательным month_start=YYYY-MM-01. Реквизиты, договоры и файлы удаляются.", { ...pagingSchema, month_start: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/) }, (input) => client.listOrdAgencyReports(input.month_start as string, input.offset as number, input.limit as number));
  registerCapabilityTool("ord_agency_status_get", "Статус передачи ОРД агентства", "Read-only capability: GET /ord/agency/status.json с обязательным month_start=YYYY-MM-01. Права агентства не обходятся.", { offset: z.number().int().nonnegative().default(0), limit: z.number().int().min(1).max(50).default(50), month_start: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-01$/) }, (input) => client.listOrdAgencyStatus(input.month_start as string, input.offset as number, input.limit as number));
  server.registerTool(
    "agency_client_get",
    {
      title: "Получить безопасную metadata клиента агентства",
      description: "Read-only fallback: находит клиента в GET /agency/clients.json. Документация не подтверждает GET detail; персональные данные и название клиента не возвращаются.",
      inputSchema: { client_id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ client_id }) => textAndData({ item: findAgencyClient(await client.listAgencyClients(), client_id) }, "Безопасная metadata клиента агентства получена из списка."),
  );
  server.registerTool(
    "agency_manager_client_get",
    {
      title: "Получить безопасную metadata связи менеджера и клиента",
      description: "Read-only fallback: ищет связь в GET v3 /manager/clients.json. Direct GET в публичном контракте отсутствует; права и связи не меняются.",
      inputSchema: { manager_id: z.number().int().positive(), client_id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ manager_id, client_id }) => textAndData({ item: findAgencyClient(await client.listManagerClients(), client_id, manager_id) }, "Безопасная metadata связи менеджера и клиента получена из списка."),
  );
  server.registerTool(
    "subscription_details_get",
    {
      title: "Получить metadata подписки",
      description: "Read-only fallback: находит подписку в GET v3 /subscription.json. Detail endpoint документирован только для DELETE, поэтому MCP не выполняет неподтверждённый GET.",
      inputSchema: { id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => textAndData({ item: await subscriptionFromPages(client, id) }, "Metadata подписки получены из списка."),
  );
  server.registerTool(
    "inapp_event_get",
    {
      title: "Получить metadata in-app события",
      description: "Read-only fallback: ищет событие в GET /remarketing/inapp_events.json. Direct endpoint документирован только для POST категории, поэтому MCP не выполняет неподтверждённый GET.",
      inputSchema: { app_id: z.number().int().positive(), tracker_id: z.number().int().positive(), event_id: z.number().int().positive() },
      outputSchema: { available: z.boolean(), item: z.record(z.string(), z.unknown()).optional(), reason: z.string().optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ app_id, tracker_id, event_id }) => {
      const page = await client.listInAppEvents(0, 200);
      const item = page.items.find((candidate) => Number(candidate.id) === event_id && Number(candidate.rb_mobile_app_id ?? candidate.app_id) === app_id && Number(candidate.tracker_id) === tracker_id);
      if (!item) return textAndData({ available: false, reason: "Событие не найдено в доступном list-ответе; прямой GET для него не документирован." }, "Проверка metadata in-app события завершена.");
      return textAndData({ available: true, item: publicSensitiveMetadata(item) as VkObject }, "Metadata in-app события получены из списка.");
    },
  );
  server.registerTool(
    "offer_batch_task_get",
    {
      title: "Получить batch-задачу тестового прайс-листа",
      description: "Read-only: GET /remarketing/pricelists/{id}/batch.json. API возвращает список задач, а не detail по task ID; читаются только задачи test-прайс-листа.",
      inputSchema: { pricelist_id: z.number().int().positive(), task_id: z.number().int().positive().optional() },
      outputSchema: { items: z.array(z.record(z.string(), z.unknown())) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ pricelist_id, task_id }) => {
      const items = await client.listTestPricelistBatchTasks(pricelist_id);
      const selected = task_id === undefined ? items : items.filter((item) => Number(item.id) === task_id);
      return textAndData({ items: selected.map((item) => publicSensitiveMetadata(item) as VkObject) }, "Batch-задачи тестового прайс-листа получены.");
    },
  );
  registerCatalog("search_phrases_list", "Списки поисковых фраз", "Read-only: GET v3 /search_phrases.json.", client.listSearchPhrases.bind(client));
  server.registerTool(
    "search_phrase_get",
    {
      title: "Получить список поисковых фраз",
      description: "Read-only: находит список поисковых фраз по ID в подтверждённом GET v3 /search_phrases.json. Не создаёт и не изменяет фразы.",
      inputSchema: { id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => textAndData({ item: await searchPhraseFromList(client, id) }, "Список поисковых фраз получен."),
  );
  registerList("subscriptions_list", "Подписки", "Read-only: GET v3 /subscription.json.", client.listSubscriptions.bind(client));
  server.registerTool(
    "subscription_get",
    {
      title: "Получить подписку",
      description: "Read-only: находит подписку по ID в подтверждённых metadata-страницах GET v3 /subscription.json. Не создаёт, не изменяет и не удаляет подписки.",
      inputSchema: { id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => textAndData({ item: await subscriptionFromPages(client, id) }, "Metadata подписки получены."),
  );
  registerList("transaction_groups_list", "Группы транзакций", "Read-only: GET /billing/transaction_groups.json.", client.listTransactionGroups.bind(client));
  server.registerTool(
    "transaction_group_get",
    {
      title: "Получить группу транзакций",
      description: "Read-only: находит группу транзакций по ID в подтверждённых страницах GET /billing/transaction_groups.json. Не читает транзакции, баланс и не выполняет денежных операций.",
      inputSchema: { id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => textAndData({ item: await transactionGroupFromPages(client, id) }, "Группа транзакций получена."),
  );
  server.registerTool(
    "segment_relations_list",
    {
      title: "Связи сегмента",
      description: "Read-only: GET /remarketing/segments/{id}/relations.json.",
      inputSchema: { segment_id: z.number().int().positive() },
      outputSchema: { items: z.array(z.record(z.string(), z.unknown())) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ segment_id }) => textAndData({ items: await client.listSegmentRelations(segment_id) }, "Связи сегмента получены."),
  );
  registerCatalog("pads_tree_list", "Дерево рекламных площадок", "Read-only: GET /pads_trees.json.", client.listPadsTree.bind(client));
  registerCatalog("mobile_categories_list", "Категории мобильных приложений", "Read-only: GET /mobile_categories.json.", client.listMobileCategories.bind(client));
  server.registerTool(
    "mobile_app_get",
    {
      title: "Карточка мобильного приложения",
      description: "Read-only: GET /apple_apps/{id}.json или /google_apps/{package}.json. Получает публичные metadata приложения, не меняя кампании.",
      inputSchema: { platform: z.enum(["ios", "android"]), app_id: z.number().int().positive().optional(), package_name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/).optional() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input) => {
      if (input.platform === "ios") {
        if (!input.app_id) throw new Error("Для iOS укажите app_id.");
        return textAndData({ item: await client.getMobileApp({ platform: "ios", appId: input.app_id }) }, "Карточка iOS-приложения получена.");
      }
      if (!input.package_name) throw new Error("Для Android укажите package_name.");
      return textAndData({ item: await client.getMobileApp({ platform: "android", packageName: input.package_name }) }, "Карточка Android-приложения получена.");
    },
  );
  registerCatalog("mobile_operators_list", "Мобильные операторы", "Read-only: GET /mobile_operators.json.", client.listMobileOperators.bind(client));
  registerCatalog("mobile_types_list", "Типы мобильных устройств", "Read-only: GET /mobile_types.json.", client.listMobileTypes.bind(client));
  registerCatalog("mobile_os_list", "Мобильные ОС", "Read-only: GET /mobile_os.json.", client.listMobileOs.bind(client));
  registerCatalog("mobile_vendors_list", "Производители устройств", "Read-only: GET /mobile_vendors.json.", client.listMobileVendors.bind(client));
  registerCatalog("agency_clients_list", "Клиенты агентства", "Read-only: GET /agency/clients.json; текущему credential может требоваться agency role.", client.listAgencyClients.bind(client));
  registerCatalog("manager_clients_list", "Клиенты менеджера", "Read-only: GET v3 /manager/clients.json; текущему credential может требоваться manager role.", client.listManagerClients.bind(client));
  server.registerTool(
    "client_scope_check",
    {
      title: "Проверить read-scope кабинета",
      description: "Read-only: проверяет user_id одним списком campaigns. Не переключает credential, не сохраняет выбор и не даёт write-доступ к другому кабинету.",
      inputSchema: { user_id: z.number().int().positive() },
      outputSchema: {
        connection_id: z.string(),
        user_id: z.number().int().positive(),
        read_scope_verified: z.literal(true),
        campaigns_count: z.number().int().nonnegative(),
        limitation: z.string(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ user_id }) => {
      const campaigns = await client.listCampaigns(0, 1, user_id);
      return textAndData({
        connection_id: connectionId,
        user_id,
        read_scope_verified: true as const,
        campaigns_count: campaigns.count,
        limitation: "Credential и write-scope не переключаются; user_id применяется только к этому read-запросу.",
      }, "Read-scope кабинета подтверждён текущим credential.");
    },
  );
  registerObject("targetings_tree_get", "Дерево таргетингов", "Read-only: GET /targetings_tree.json.", client.getTargetingsTree.bind(client));
  registerObject("throttling_get", "Лимиты VK Ads API", "Read-only: GET /throttling.json.", client.getThrottling.bind(client));
  registerObject("conversion_goals_get", "Цели конверсии", "Read-only: GET /goals.json.", client.getGoals.bind(client));

  server.registerTool(
    "statistics_get",
    {
      title: "Получить статистику VK Ads",
      description: "Read-only: статистика v2 по планам, группам или объявлениям. Метрики возвращаются в items[].total.base и total.base.",
      inputSchema: statisticsInputSchema,
      outputSchema: {
        items: z.array(z.record(z.string(), z.unknown())),
        total: z.record(z.string(), z.unknown()),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ object_type, period, ids, date_from, date_to, metrics }) => {
      const statistics = await client.getStatistics({
        objectType: object_type,
        period,
        ...(ids ? { ids } : {}),
        ...(date_from ? { dateFrom: date_from } : {}),
        ...(date_to ? { dateTo: date_to } : {}),
        metrics,
      });
      return textAndData({ items: statistics.items, total: statistics.total }, "Статистика VK Ads получена.");
    },
  );
  server.registerTool(
    "vk_get_video_report",
    {
      title: "Видеоотчёт VK Ads",
      description: "Read-only: получает рекламные видеометрики `video` и `uniques_video` через подтверждённый statistics v2. Не читает видеозаписи VK и не меняет кампании.",
      inputSchema: {
        object_type: z.enum(["ad_plans", "campaigns", "ad_groups", "banners", "users"]),
        period: z.enum(["summary", "day"]),
        ids: z.array(z.number().int().positive()).min(1).max(50).optional(),
        date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      },
      outputSchema: { items: z.array(z.record(z.string(), z.unknown())), total: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ object_type, period, ids, date_from, date_to }) => {
      const statistics = await client.getStatistics({
        objectType: object_type,
        period,
        ...(ids ? { ids } : {}),
        ...(date_from ? { dateFrom: date_from } : {}),
        ...(date_to ? { dateTo: date_to } : {}),
        metrics: "video,uniques_video",
      });
      return textAndData({ items: statistics.items, total: statistics.total }, "Видеоотчёт VK Ads получен.");
    },
  );
  server.registerTool(
    "vk_get_async_report",
    {
      title: "Получить серверный отчёт VK Ads",
      description: "Read-only: GET /api/v3/reports.json либо /reports/{id}.json. Не создаёт, не меняет и не удаляет отчёты.",
      inputSchema: { report_id: z.number().int().positive().optional() },
      outputSchema: { item: z.record(z.string(), z.unknown()).optional(), items: z.array(z.record(z.string(), z.unknown())).optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ report_id }) => report_id
      ? textAndData({ item: await client.getCustomReport(report_id) }, "Серверный отчёт VK Ads получен.")
      : textAndData({ items: await client.listCustomReports() }, "Список серверных отчётов VK Ads получен."),
  );
  server.registerTool(
    "goal_statistics_get",
    {
      title: "Статистика конверсионных целей",
      description: "Read-only: GET /statistics/goals/{ad_plans|ad_groups|banners|users}/day.json. Требует ID и диапазон дат; возвращает агрегированные показатели целей.",
      inputSchema: goalStatisticsInputSchema,
      outputSchema: { items: z.array(z.record(z.string(), z.unknown())), total: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ object_type, ids, date_from, date_to }) => {
      const statistics = await client.getGoalStatistics({ objectType: object_type, ids, dateFrom: date_from, dateTo: date_to });
      return textAndData({ items: statistics.items, total: statistics.total }, "Статистика конверсионных целей получена.");
    },
  );

  server.registerTool(
    "inapp_statistics_get",
    {
      title: "Получить in-app статистику",
      description: "Read-only: дневная статистика событий мобильных приложений по users, планам, группам или баннерам.",
      inputSchema: inAppStatisticsInputSchema,
      outputSchema: { items: z.array(z.record(z.string(), z.unknown())), total: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ object_type, date_from, date_to, ids, attribution, conversion_type }) => {
      const statistics = await client.getInAppStatistics({
        objectType: object_type,
        dateFrom: date_from,
        dateTo: date_to,
        ...(ids ? { ids } : {}),
        ...(attribution ? { attribution } : {}),
        ...(conversion_type ? { conversionType: conversion_type } : {}),
      });
      return textAndData({ items: statistics.items, total: statistics.total }, "In-app статистика VK Ads получена.");
    },
  );

  server.registerTool(
    "offline_conversion_statistics_get",
    {
      title: "Получить статистику офлайн-конверсий",
      description: "Read-only: дневная агрегированная статистика офлайн-конверсий без исходных персональных данных.",
      inputSchema: offlineConversionStatisticsInputSchema,
      outputSchema: { items: z.array(z.record(z.string(), z.unknown())) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ object_type, ids, date_from, date_to }) => textAndData(
      await client.getOfflineConversionStatistics({ objectType: object_type, ids, dateFrom: date_from, dateTo: date_to }),
      "Статистика офлайн-конверсий VK Ads получена.",
    ),
  );

  server.registerTool(
    "fast_statistics_get",
    {
      title: "Получить быструю статистику",
      description: "Read-only: v3 faststat по users, планам, campaigns или banners.",
      inputSchema: { object_type: z.enum(["ad_plans", "banners", "campaigns", "users"]).default("users") },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ object_type }) => textAndData({ item: await client.getFastStatistics(object_type) }, "Быстрая статистика VK Ads получена."),
  );

  server.registerResource(
    "vk-ads-objects",
    "vk-ads://objects",
    { title: "Модель объектов VK Ads", mimeType: "application/json" },
    async () => ({
      contents: [{
        uri: "vk-ads://objects",
        mimeType: "application/json",
        text: JSON.stringify({
          public_model: ["ad_plans", "ad_groups", "banners"],
          verified_raw_relationships: ["campaign/ad_group.package_id", "banner.campaign_id", "banner.ad_group_id"],
          note: "Публичная и raw-модель разделены до окончания capability verification.",
        }),
      }],
    }),
  );

  server.registerTool(
    "write_capabilities",
    {
      title: "Статус операций записи",
      description: "Показывает, почему write-инструменты пока недоступны или требуют отдельной проверки payload.",
      outputSchema: {
        mode: z.enum(["readonly", "write"]),
        writes_registered: z.boolean(),
        reason: z.string(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => textAndData(
      {
        mode,
        writes_registered: mode === "write",
        reason: mode === "write"
          ? "Доступны регистрация HTTPS URL, изолированные test ad plan/group/banner операции, загрузка static image, HTML5 ZIP или MP4-видео и чувствительные экспорты через preview и одноразовое подтверждение. Test-счётчики ремаркетинга дополнительно требуют allowlist и отдельный opt-in."
          : "Сервер запущен в readonly: write-инструменты не зарегистрированы.",
      },
      "Статус write-возможностей получен.",
    ),
  );

  if (mode === "write") {
    const previewOutputSchema = {
      id: z.string().uuid(),
      operation: testWriteOperationSchema,
      connection_id: z.string(),
      payload: z.record(z.string(), z.unknown()),
      payload_hash: z.string().length(64),
      expires_at: z.string().datetime(),
      confirmation_statement: z.string(),
      preflight: z.object({
        before: z.record(z.string(), z.unknown()).nullable(),
        risk: z.enum(["low", "medium", "high"]),
        expected_change: z.string(),
      }),
    };
    const prepareWritePreview = async (operation: TestWriteOperation, payload: Record<string, unknown>) => {
      const normalized = normalizeTestWritePayload(operation, payload, options.uploadDir);
      if ((operation === "share_test_skadnetwork_ids" || operation === "withdraw_test_skadnetwork_ids") && !options.allowSkAdNetworkWrites) {
        throw new Error("SKAdNetwork-запись отключена. Нужен отдельный VK_ADS_ALLOW_SKADNETWORK_WRITES=1 при запуске.");
      }
      if (operation === "update_test_inapp_event_category" && !options.allowInAppEventCategoryWrites) {
        throw new Error("Изменение категории in-app события отключено. Нужен отдельный VK_ADS_ALLOW_INAPP_EVENT_CATEGORY_WRITES=1 при запуске.");
      }
      if ((operation === "rename_test_remarketing_counter" || operation === "delete_test_remarketing_counter" || operation === "update_test_counter_goal") && !options.allowRemarketingCounterWrites) {
        throw new Error("Изменение test-счётчика ремаркетинга отключено. Нужен отдельный VK_ADS_ALLOW_REMARKETING_COUNTER_WRITES=1 при запуске.");
      }
      if (operation === "rename_test_remarketing_counter" || operation === "delete_test_remarketing_counter" || operation === "update_test_counter_goal") {
        const counterId = normalized.counter_id as number;
        if (!(options.remarketingCounterTestIds ?? []).includes(counterId)) {
          throw new Error("Счётчик не входит в VK_ADS_TEST_COUNTER_IDS; запись заблокирована.");
        }
      }
      const before = await captureWriteBefore(client, operation, normalized);
      let preflight: WritePreflightResult | { ready: boolean; checks: Array<{ code: string; status: "pass" | "fail"; message: string }> } | undefined;
      if (operation === "create_test_ad_plan") {
        preflight = await preflightTestAdPlan(client, normalized);
      } else if (operation === "create_test_campaign") {
        preflight = await preflightTestAdGroup(client, normalized, before);
      } else if (operation === "create_test_ad_group") {
        preflight = await preflightTestAdGroup(client, normalized, before);
      } else if (operation === "create_test_banner") {
        preflight = await preflightConfirmedTestBanner(client, normalized, uploadedImages, before);
      } else if (operation === "share_test_skadnetwork_ids" || operation === "withdraw_test_skadnetwork_ids") {
        preflight = await preflightSkAdNetwork(client, operation, normalized, options.skAdNetworkTestAppIds ?? []);
      } else if (operation === "update_test_inapp_event_category") {
        preflight = await preflightInAppEventCategory(client, normalized, options.inAppEventTestAppIds ?? []);
      } else if (operation === "revoke_created_sharing_key" && !options.allowSharingKeyRevoke) {
        throw new Error("Отзыв ключа шаринга отключён. Он может остановить кампании получателя; нужен VK_ADS_ALLOW_SHARING_KEY_REVOKE=1 при запуске.");
      } else if (operation === "revoke_created_sharing_key" && !sessionSharingKeys.has(normalized.key_handle as string)) {
        throw new Error("Отзывать можно только ключ, созданный текущим MCP-сеансом.");
      }
      if (preflight && !preflight.ready) {
        const failures = preflight.checks.filter((check) => check.status === "fail").map((check) => check.message);
        throw new Error(`Операция не прошла локальный preflight: ${failures.join(" ")}`);
      }
      return textAndData(
        {
          ...writeGate.prepare(operation, normalized, connectionId),
          preflight: { before, ...writeImpact(operation) },
        },
        "Preview подготовлен. Выполнение возможно только после явной передачи указанной фразы подтверждения.",
      );
    };
    const registerWritePreviewAlias = (
      name: string,
      title: string,
      description: string,
      operation: TestWriteOperation,
      inputSchema: Record<string, z.ZodTypeAny>,
    ) => server.registerTool(
      name,
      {
        title,
        description: `${description} Инструмент только готовит preview; запись выполняет write_execute после одноразового подтверждения.`,
        inputSchema,
        outputSchema: previewOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      },
      async (payload) => prepareWritePreview(operation, payload as Record<string, unknown>),
    );

    server.registerTool(
      "write_preview",
      {
        title: "Подготовить подтверждение тестовой записи",
        description: "Готовит одноразовый preview с hash payload для HTTPS URL, изолированных test-сущностей, static image или MP4-видео из VK_ADS_UPLOAD_DIR.",
        inputSchema: {
          operation: testWriteOperationSchema,
          payload: z.record(z.string(), z.unknown()),
        },
      outputSchema: previewOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      },
      async ({ operation, payload }) => prepareWritePreview(operation, payload),
    );

    registerWritePreviewAlias(
      "vk_create_url", "Подготовить регистрацию URL", "Только HTTPS URL без логина и пароля.", "create_url",
      { url: z.string().min(1).max(2_048).url() },
    );
    registerWritePreviewAlias(
      "vk_create_ad_plan", "Подготовить создание test ad plan", "Создаётся только остановленный `__MCP_TEST__` ad plan с одной остановленной campaign.", "create_test_ad_plan",
      { name: z.string().min(14).max(120).startsWith("__MCP_TEST__"), objective: z.string().min(1).max(80), package_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "vk_create_campaign", "Подготовить создание test campaign", "Подтверждён только blocked appinstalls package 2860 внутри `__MCP_TEST__` ad plan.", "create_test_campaign",
      { ad_plan_id: z.number().int().positive(), package_id: z.literal(2860), objective: z.literal("appinstalls"), name: z.string().min(14).max(120).startsWith("__MCP_TEST__") },
    );
    registerWritePreviewAlias(
      "lead_form_copy", "Подготовить копирование test-лид-формы", "Исходная форма и имя копии обязаны иметь префикс `__MCP_TEST__`. Контакты и ответы не читаются.", "copy_test_lead_form",
      { form_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__") },
    );
    registerWritePreviewAlias(
      "vk_update_lead_form", "Подготовить переименование test-лид-формы", "Изменяет только имя существующей `__MCP_TEST__` лид-формы. Контактные поля, страницы, согласия и уведомления не передаются в API и не изменяются.", "rename_test_lead_form",
      { form_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__") },
    );
    registerWritePreviewAlias(
      "vk_update_inapp_event_category", "Подготовить изменение категории test in-app события", "Допускается только для app_id из `VK_ADS_TEST_MOBILE_APP_IDS`, после проверки доступности события и category_id. Нужен отдельный opt-in при запуске.", "update_test_inapp_event_category",
      { app_id: z.number().int().positive(), tracker_id: z.number().int().positive(), event_id: z.number().int().positive(), category_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "lead_form_test_lead_send", "Подготовить отправку test-лида", "Отправляет только служебный тестовый лид в существующую `__MCP_TEST__` форму. Контактные данные и ответы не принимаются.", "send_test_lead",
      { form_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "sharing_key_create", "Подготовить создание ключа шаринга", "Источник — только существующий `__MCP_TEST__` сегмент. Ключ отправляется указанному получателю средствами VK Ads и не попадает в MCP-ответ или audit.", "create_test_sharing_key",
      { segment_id: z.number().int().positive(), recipient: z.string().trim().min(3).max(254) },
    );
    registerWritePreviewAlias(
      "sharing_key_revoke", "Подготовить отзыв ключа шаринга", "Отзывает только ключ, созданный текущим MCP-сеансом. Нужен отдельный opt-in при запуске: отзыв способен остановить кампании получателя.", "revoke_created_sharing_key",
      { key_handle: z.string().uuid() },
    );
    registerWritePreviewAlias(
      "skadnetwork_ids_share", "Подготовить передачу SKAdNetwork IDs", "Только iOS app ID из локального allowlist тестов и только свободные IDs. Нужен отдельный opt-in при запуске.", "share_test_skadnetwork_ids",
      { app_id: z.number().int().positive(), recipient: z.string().trim().min(3).max(254), count: z.number().int().min(1).max(10_000) },
    );
    registerWritePreviewAlias(
      "skadnetwork_ids_withdraw", "Подготовить возврат SKAdNetwork IDs", "Только тестовое iOS-приложение без связанных кампаний и только IDs, которые API показывает свободными у получателя. Нужен отдельный opt-in при запуске.", "withdraw_test_skadnetwork_ids",
      { app_id: z.number().int().positive(), recipient: z.string().trim().min(3).max(254), count: z.number().int().min(1).max(10_000) },
    );
    registerWritePreviewAlias(
      "survey_form_copy", "Подготовить копирование test-опроса", "Исходный опрос и имя копии обязаны иметь префикс `__MCP_TEST__`. Ответы респондентов не читаются.", "copy_test_survey_form",
      { form_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__") },
    );
    server.registerTool(
      "lead_forms_archive_manage",
      {
        title: "Подготовить archive/unarchive test-лид-форм",
        description: "Разрешает archive или unarchive от 1 до 50 форм только с префиксом `__MCP_TEST__`; выполнение — через одноразовое подтверждение.",
        inputSchema: { action: z.enum(["archive", "unarchive"]), form_ids: z.array(z.number().int().positive()).min(1).max(50) },
        outputSchema: previewOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      },
      async ({ action, form_ids }) => prepareWritePreview("manage_test_lead_forms_archive", { action, form_ids }),
    );
    server.registerTool(
      "survey_forms_archive_manage",
      {
        title: "Подготовить archive/unarchive test-опросов",
        description: "Разрешает archive или unarchive от 1 до 50 форм только с префиксом `__MCP_TEST__`; выполнение — через одноразовое подтверждение.",
        inputSchema: { action: z.enum(["archive", "unarchive"]), form_ids: z.array(z.number().int().positive()).min(1).max(50) },
        outputSchema: previewOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      },
      async ({ action, form_ids }) => prepareWritePreview("manage_test_survey_forms_archive", { action, form_ids }),
    );
    registerWritePreviewAlias(
      "vk_update_ad_plan", "Подготовить переименование test ad plan", "Подтверждён только rename существующего `__MCP_TEST__` ad plan; бюджеты и статусы не изменяются.", "rename_test_ad_plan",
      { ad_plan_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__") },
    );
    registerWritePreviewAlias(
      "vk_update_campaign", "Подготовить переименование test campaign", "Подтверждён только rename существующей `__MCP_TEST__` campaign; статусы, бюджеты и существующие объекты без test-префикса заблокированы.", "rename_test_campaign",
      { campaign_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__") },
    );
    registerWritePreviewAlias(
      "vk_delete_ad_plan", "Подготовить удаление test ad plan", "Только `__MCP_TEST__` ad plan; VK получает status=deleted.", "delete_test_ad_plan",
      { ad_plan_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "vk_manage_campaigns", "Подготовить остановку test ad plans", "Подтверждён только массовый перевод `__MCP_TEST__` ad plan в blocked.", "block_test_ad_plans",
      { ad_plan_ids: z.array(z.number().int().positive()).min(1).max(200) },
    );
    registerWritePreviewAlias(
      "vk_create_ad_group", "Подготовить создание test ad group", "Создаётся только остановленная `__MCP_TEST__` group внутри test ad plan.", "create_test_ad_group",
      { ad_plan_id: z.number().int().positive(), package_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__"), targetings: confirmedTestGroupTargetingsSchema },
    );
    registerWritePreviewAlias(
      "vk_update_ad_group", "Подготовить переименование test ad group", "Подтверждён только rename существующей `__MCP_TEST__` group; ставки, бюджет и таргетинги не изменяются.", "rename_test_ad_group",
      { ad_group_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__") },
    );
    registerWritePreviewAlias(
      "vk_update_banner", "Подготовить переименование test banner", "Подтверждён только rename существующего `__MCP_TEST__` banner; content, URLs, статусы и обычные объекты заблокированы.", "rename_test_banner",
      { banner_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__") },
    );
    registerWritePreviewAlias(
      "vk_update_remarketing_counter", "Подготовить переименование test-счётчика", "Только счётчик из VK_ADS_TEST_COUNTER_IDS с именем `__MCP_TEST__`; URL, учётные данные и flags не передаются.", "rename_test_remarketing_counter",
      { counter_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__") },
    );
    registerWritePreviewAlias(
      "vk_delete_remarketing_counter", "Подготовить удаление test-счётчика", "Только счётчик из VK_ADS_TEST_COUNTER_IDS с именем `__MCP_TEST__`; операция необратима.", "delete_test_remarketing_counter",
      { counter_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "vk_update_counter_goal", "Подготовить изменение test-цели счётчика", "Только существующая `__MCP_TEST__` цель счётчика из VK_ADS_TEST_COUNTER_IDS; доступны документированные name, value и goal_type.", "update_test_counter_goal",
      { counter_id: z.number().int().positive(), goal_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__"), value: z.number().int().min(-2_147_483_647).max(2_147_483_647), goal_type: z.enum(["content", "search", "basket", "wishlist", "checkout", "payment_info", "purchase", "lead", "registration", "custom"]) },
    );
    registerWritePreviewAlias(
      "vk_delete_ad_group", "Подготовить удаление test ad group", "Только `__MCP_TEST__` ad group; VK получает status=deleted.", "delete_test_ad_group",
      { ad_group_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "vk_manage_ad_groups", "Подготовить остановку test ad groups", "Подтверждён только массовый перевод `__MCP_TEST__` group в blocked.", "block_test_ad_groups",
      { ad_group_ids: z.array(z.number().int().positive()).min(1).max(200) },
    );
    registerWritePreviewAlias(
      "vk_manage_banners", "Подготовить остановку test banners", "Документированный batch contract допускает только перевод `__MCP_TEST__` banner в blocked до отдельной live-проверки.", "block_test_banners",
      { banner_ids: z.array(z.number().int().positive()).min(1).max(200) },
    );
    registerWritePreviewAlias(
      "vk_remoderate_banners", "Подготовить повторную модерацию test banners", "Перед отправкой VK Ads обязан вернуть для каждого `__MCP_TEST__` banner user_can_request_remoderation=true. Иначе write-запрос не уйдёт.", "remoderate_test_banners",
      { banner_ids: z.array(z.number().int().positive()).min(1).max(200) },
    );
    registerWritePreviewAlias(
      "vk_create_banner", "Подготовить создание test banner", "До preview проверяются group, URL, тексты и размеры локально загруженных изображений. Подтверждён только blocked banner в `__MCP_TEST__` group package_id=2860 по pattern 284.", "create_test_banner",
      { ad_group_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__"), primary_url_id: z.number().int().positive(), landscape_image_id: z.number().int().positive(), icon_image_id: z.number().int().positive(), title: z.string().trim().min(1).max(40), text: z.string().trim().min(1).max(90), cta: z.literal("install") },
    );
    registerWritePreviewAlias(
      "vk_create_segment", "Подготовить создание test-сегмента", "Создаётся только `__MCP_TEST__` сегмент. Указанный счётчик используется только как источник: сам он не изменяется.", "create_test_segment",
      { name: z.string().min(14).max(120).startsWith("__MCP_TEST__"), counter_source_id: z.number().int().positive(), left_days: z.number().int().min(1).max(365).default(365), goal_id: z.string().max(120).default("") },
    );
    registerWritePreviewAlias(
      "vk_update_segment", "Подготовить переименование test-сегмента", "Разрешено только переименование существующего `__MCP_TEST__` сегмента.", "rename_test_segment",
      { segment_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__") },
    );
    registerWritePreviewAlias(
      "vk_delete_segment", "Подготовить удаление test-сегмента", "Разрешено удалить только `__MCP_TEST__` сегмент, не привязанный к кампаниям.", "delete_test_segment",
      { segment_id: z.number().int().positive() },
    );
    server.registerTool(
      "vk_manage_segment_relations",
      {
        title: "Подготовить изменение связи test-сегментов",
        description: "Разрешено только добавить или удалить связь в `__MCP_TEST__` сегменте; запись выполняется после одноразового подтверждения.",
        inputSchema: {
          action: z.enum(["add", "delete"]),
          segment_id: z.number().int().positive(),
          nested_segment_id: z.number().int().positive().optional(),
          relation_id: z.number().int().positive().optional(),
        },
        outputSchema: previewOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      },
      async (payload) => {
        if (payload.action === "add") {
          if (!payload.nested_segment_id) throw new Error("Для добавления связи укажите nested_segment_id.");
          return prepareWritePreview("add_test_segment_relation", { segment_id: payload.segment_id, nested_segment_id: payload.nested_segment_id });
        }
        if (!payload.relation_id) throw new Error("Для удаления связи укажите relation_id.");
        return prepareWritePreview("delete_test_segment_relation", { segment_id: payload.segment_id, relation_id: payload.relation_id });
      },
    );
    registerWritePreviewAlias(
      "vk_upload_image", "Подготовить загрузку изображения", "Файл должен находиться в `VK_ADS_UPLOAD_DIR` и пройти локальную проверку сигнатуры и размера.", "upload_static_image",
      { file_path: z.string().min(1).max(1_024) },
    );
    registerWritePreviewAlias(
      "vk_upload_html5", "Подготовить загрузку HTML5-креатива", "ZIP из `VK_ADS_UPLOAD_DIR` проходит проверку путей, лимитов распаковки, единственного HTML-файла и meta ad.size.", "upload_html5",
      { file_path: z.string().min(1).max(1_024) },
    );
    registerWritePreviewAlias(
      "vk_upload_video", "Подготовить загрузку MP4-видео", "Файл должен находиться в `VK_ADS_UPLOAD_DIR` и пройти локальную проверку сигнатуры, hash и размера.", "upload_test_video",
      { file_path: z.string().min(1).max(1_024), width: z.number().int().min(1).max(16_384), height: z.number().int().min(1).max(16_384) },
    );
    registerWritePreviewAlias(
      "lead_form_image_upload", "Подготовить загрузку logo лид-формы", "Разрешён только PNG/JPEG до 5 MiB из `VK_ADS_UPLOAD_DIR`; роль зафиксирована как `logo` по публичной документации.", "upload_lead_form_logo",
      { file_path: z.string().min(1).max(1_024) },
    );
    registerWritePreviewAlias(
      "offer_batch_task_create", "Подготовить batch-задачу synthetic offer", "Только один offer в существующем `__MCP_TEST__` прайс-листе; URL и цена проходят строгую локальную проверку.", "create_test_offer_batch",
      { pricelist_id: z.number().int().positive(), offer_id: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/), product_type: z.string().regex(/^[A-Za-z0-9._ -]{1,100}$/), title: z.string().trim().min(1).max(150), link: z.string().url(), image_link: z.string().url(), price: z.string().regex(/^\d+(?:\.\d{1,2})? [A-Z]{3}$/) },
    );
    registerWritePreviewAlias(
      "vk_create_remarketing_list", "Подготовить загрузку test-списка ремаркетинга", "Принимается только новый `__MCP_TEST__` список из отдельного VK_ADS_PII_UPLOAD_DIR при VK_ADS_ALLOW_PII_UPLOADS=1. Содержимое контактов не читается и не логируется.", "upload_test_remarketing_user_list",
      { file_path: z.string().min(1).max(1_024), name: z.string().min(14).max(120).startsWith("__MCP_TEST__"), type: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/) },
    );
    registerWritePreviewAlias(
      "vk_update_remarketing_list", "Подготовить переименование test-списка ремаркетинга", "Разрешено только переименовать существующий `__MCP_TEST__` список; состав аудитории не меняется.", "rename_test_remarketing_user_list",
      { list_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__") },
    );
    registerWritePreviewAlias(
      "vk_delete_remarketing_list", "Подготовить удаление test-списка ремаркетинга", "Разрешено удалить только неиспользуемый `__MCP_TEST__` список. VK Ads отклонит список, связанный с аудиторией или lookalike.", "delete_test_remarketing_user_list",
      { list_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "vk_update_feed", "Подготовить изменение test-каталога", "Подтверждённый API прайс-листа. Разрешает изменить только существующий каталог `__MCP_TEST__`; URL источника проверяется как публичный HTTPS.", "update_test_pricelist",
      { pricelist_id: z.number().int().positive(), name: z.string().min(14).max(120).startsWith("__MCP_TEST__"), status: z.enum(["active", "blocked"]), remove_utm_tags: z.boolean(), export_url: z.string().min(1).max(2_048).url().optional() },
    );
    registerWritePreviewAlias(
      "vk_create_async_report", "Подготовить создание test-отчёта", "Создаётся только серверный `__MCP_TEST__` отчёт с фиксированным v3 contract. Он не меняет кампании, ставки или бюджет.", "create_test_async_report",
      { title: z.string().min(14).max(120).startsWith("__MCP_TEST__"), advertisers: z.array(z.number().int().positive()).min(1).max(50), date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), metrics: z.array(z.enum(["acs", "cart_count", "clicks", "conversions", "cpa", "cpc", "cr", "cr_cart", "cr_purchase", "ctr", "inapp_count", "money", "purchase_count", "romi", "shows", "top_goal_count", "value", "video_100cost", "video_100pct", "video_10sec", "video_10sec_cost", "video_10sec_rate", "video_25pct", "video_50pct", "video_75pct", "video_avg_depth", "video_started", "video_view_rate"])).min(1).max(30), slices: z.array(z.enum(["ad_plan_id", "advertiser_id", "age", "banner_id", "campaign_id", "day", "feed_id", "geo", "hour", "inapp_id", "interests", "month", "offer_id", "search_phrase", "sex", "shop_id", "top_goal_id", "week", "year"])).min(1).max(16) },
    );
    registerWritePreviewAlias(
      "vk_delete_async_report", "Подготовить удаление test-отчёта", "Удаляет только ранее созданный серверный отчёт с префиксом `__MCP_TEST__`.", "delete_test_async_report",
      { report_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "vk_connect_client", "Подготовить подключение существующего клиента агентства", "Доступно только агентскому credential при VK_ADS_ALLOW_AGENCY_WRITES=1. Операция не создаёт credential и не принимает PII клиента.", "connect_agency_client",
      { user_id: z.number().int().positive(), access_type: z.literal("full_access") },
    );
    server.registerTool(
      "vk_manage_local_geo",
      {
        title: "Подготовить изменение test local geo",
        description: "Создаёт, изменяет или удаляет только `__MCP_TEST__` список локального гео. Запись выполняет write_execute после одноразового подтверждения.",
        inputSchema: {
          action: z.enum(["create", "update", "delete"]),
          local_geo_id: z.number().int().positive().optional(),
          name: z.string().min(14).max(120).startsWith("__MCP_TEST__").optional(),
          regions: z.array(z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180), radius: z.number().int().min(1).max(100_000), label: z.string().trim().min(1).max(200), address: z.string().trim().min(1).max(500).optional() }).strict()).min(1).max(200).optional(),
        },
        outputSchema: previewOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      },
      async (payload) => {
        if (payload.action === "delete") {
          if (!payload.local_geo_id) throw new Error("Для удаления укажите local_geo_id.");
          return prepareWritePreview("delete_test_local_geo", { local_geo_id: payload.local_geo_id });
        }
        if (!payload.name || !payload.regions) throw new Error("Для create/update укажите name и regions.");
        if (payload.action === "create") return prepareWritePreview("create_test_local_geo", { name: payload.name, regions: payload.regions });
        if (!payload.local_geo_id) throw new Error("Для изменения укажите local_geo_id.");
        return prepareWritePreview("update_test_local_geo", { local_geo_id: payload.local_geo_id, name: payload.name, regions: payload.regions });
      },
    );
    registerWritePreviewAlias(
      "vk_export_leads", "Подготовить чувствительный экспорт лидов", "Экспорт может содержать PII. Доступен только через preview и одноразовое подтверждение; данные не сохраняются в audit.", "export_leads",
      { form_id: z.number().int().positive(), format: z.enum(["csv", "xlsx"]), ad_plan_ids: z.array(z.number().int().positive()).min(1).max(50).optional(), ad_group_ids: z.array(z.number().int().positive()).min(1).max(50).optional(), banner_ids: z.array(z.number().int().positive()).min(1).max(50).optional(), created_at_gte: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).optional(), created_at_lte: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).optional() },
    );
    registerWritePreviewAlias(
      "survey_respondents_export", "Подготовить чувствительный экспорт ответов опроса", "Экспорт XLSX может содержать PII. Доступен только через preview и одноразовое подтверждение; данные не сохраняются в audit.", "export_survey_respondents",
      { form_id: z.number().int().positive() },
    );

    server.registerTool(
      "write_execute",
      {
        title: "Выполнить подтверждённую тестовую запись",
        description: "Выполняет ровно один свежий preview. Не принимает произвольный endpoint, ID существующих кампаний или свободный payload.",
        inputSchema: { preview_id: z.string().uuid(), confirmation_statement: z.string().min(1).max(100) },
        outputSchema: {
          operation: testWriteOperationSchema,
          result: z.record(z.string(), z.unknown()),
          after: z.record(z.string(), z.unknown()),
          audit: z.object({
            id: z.string().uuid(), operation: testWriteOperationSchema, connection_id: z.string(),
            status: z.literal("succeeded"), prepared_at: z.string().datetime(), completed_at: z.string().datetime(), result_hash: z.string().length(64),
          }),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      },
      async ({ preview_id, confirmation_statement }) => {
        const preview = writeGate.consume(preview_id, confirmation_statement, connectionId);
        let result: VkObject;
        try {
          switch (preview.operation) {
          case "create_url": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.createUrl(payload.url as string);
            break;
          }
          case "create_test_ad_plan": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.createTestAdPlan({
              name: payload.name as string,
              objective: payload.objective as string,
              packageId: payload.package_id as number,
            });
            break;
          }
          case "create_test_campaign": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.createTestCampaign({
              adPlanId: payload.ad_plan_id as number,
              packageId: payload.package_id as 2860,
              objective: payload.objective as "appinstalls",
              name: payload.name as string,
            });
            break;
          }
          case "create_test_ad_group": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.createTestAdGroup({
              adPlanId: payload.ad_plan_id as number,
              packageId: payload.package_id as number,
              name: payload.name as string,
              targetings: payload.targetings as VkObject,
            });
            break;
          }
          case "create_test_banner": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.createTestBanner({
              adGroupId: payload.ad_group_id as number,
              name: payload.name as string,
              primaryUrlId: payload.primary_url_id as number,
              landscapeImageId: payload.landscape_image_id as number,
              iconImageId: payload.icon_image_id as number,
              title: payload.title as string,
              text: payload.text as string,
              cta: payload.cta as "install",
            });
            break;
          }
          case "create_test_segment": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.createTestSegment({
              name: payload.name as string,
              counterSourceId: payload.counter_source_id as number,
              leftDays: payload.left_days as number,
              goalId: payload.goal_id as string,
            });
            break;
          }
          case "copy_test_lead_form": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = publicFormConfiguration(await client.copyTestLeadForm(payload.form_id as number, payload.name as string));
            break;
          }
          case "rename_test_lead_form": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = publicFormConfiguration(await client.renameTestLeadForm(payload.form_id as number, payload.name as string));
            break;
          }
          case "update_test_inapp_event_category": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            await client.updateInAppEventCategory({ appId: payload.app_id as number, trackerId: payload.tracker_id as number, eventId: payload.event_id as number, categoryId: payload.category_id as number });
            result = { app_id: payload.app_id as number, tracker_id: payload.tracker_id as number, event_id: payload.event_id as number, category_id: payload.category_id as number, updated: true };
            break;
          }
          case "send_test_lead": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            await client.sendTestLead(payload.form_id as number);
            result = { form_id: payload.form_id as number, test_lead_sent: true };
            break;
          }
          case "create_test_sharing_key": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const created = await client.createTestSharingKey({ segmentId: payload.segment_id as number, recipient: payload.recipient as string });
            const key = typeof created.sharing_key === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(created.sharing_key) ? created.sharing_key : null;
            if (!key) throw new Error("VK Ads не вернул безопасно распознаваемый ключ шаринга; ключ не будет выдан пользователю.");
            const keyHandle = randomUUID();
            sessionSharingKeys.set(keyHandle, key);
            result = { source_segment_id: payload.segment_id as number, recipients_count: 1, key_handle: keyHandle, delivery: "VK Ads отправляет ключ получателю самостоятельно." };
            break;
          }
          case "revoke_created_sharing_key": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const keyHandle = payload.key_handle as string;
            const key = sessionSharingKeys.get(keyHandle);
            if (!key) throw new Error("Ключ не принадлежит текущему MCP-сеансу или уже отозван.");
            await client.revokeSharingKey(key);
            sessionSharingKeys.delete(keyHandle);
            result = { key_handle: keyHandle, revoked: true };
            break;
          }
          case "share_test_skadnetwork_ids": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            await client.shareSkAdNetworkIds({ appId: payload.app_id as number, count: payload.count as number, recipient: payload.recipient as string });
            result = { app_id: payload.app_id as number, count: payload.count as number, shared: true };
            break;
          }
          case "withdraw_test_skadnetwork_ids": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            await client.withdrawSkAdNetworkIds({ appId: payload.app_id as number, count: payload.count as number, recipient: payload.recipient as string });
            result = { app_id: payload.app_id as number, count: payload.count as number, withdrawn: true };
            break;
          }
          case "copy_test_survey_form": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = publicFormConfiguration(await client.copyTestSurveyForm(payload.form_id as number, payload.name as string));
            break;
          }
          case "manage_test_lead_forms_archive": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = { items: (await client.archiveTestLeadForms(payload.form_ids as number[], payload.action as "archive" | "unarchive")).map(publicFormConfiguration) };
            break;
          }
          case "manage_test_survey_forms_archive": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = { items: (await client.archiveTestSurveyForms(payload.form_ids as number[], payload.action as "archive" | "unarchive")).map(publicFormConfiguration) };
            break;
          }
          case "rename_test_ad_plan": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.renameTestAdPlan(payload.ad_plan_id as number, payload.name as string);
            break;
          }
          case "rename_test_remarketing_counter": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.renameTestRemarketingCounter(payload.counter_id as number, payload.name as string);
            break;
          }
          case "update_test_counter_goal": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.updateTestCounterGoal({ counterId: payload.counter_id as number, goalId: payload.goal_id as number, name: payload.name as string, value: payload.value as number, goalType: payload.goal_type as "content" | "search" | "basket" | "wishlist" | "checkout" | "payment_info" | "purchase" | "lead" | "registration" | "custom" });
            break;
          }
          case "rename_test_campaign": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.renameTestCampaign(payload.campaign_id as number, payload.name as string);
            break;
          }
          case "rename_test_ad_group": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.renameTestAdGroup(payload.ad_group_id as number, payload.name as string);
            break;
          }
          case "rename_test_banner": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.renameTestBanner(payload.banner_id as number, payload.name as string);
            break;
          }
          case "rename_test_segment": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.renameTestSegment(payload.segment_id as number, payload.name as string);
            break;
          }
          case "block_test_ad_plans": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.blockTestAdPlans(payload.ad_plan_ids as number[]);
            break;
          }
          case "block_test_ad_groups": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.blockTestAdGroups(payload.ad_group_ids as number[]);
            break;
          }
          case "block_test_banners": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.blockTestBanners(payload.banner_ids as number[]);
            break;
          }
          case "remoderate_test_banners": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.remoderateTestBanners(payload.banner_ids as number[]);
            break;
          }
          case "delete_test_ad_plan": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteTestAdPlan(payload.ad_plan_id as number);
            break;
          }
          case "delete_test_remarketing_counter": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteTestRemarketingCounter(payload.counter_id as number);
            break;
          }
          case "delete_test_ad_group": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteTestAdGroup(payload.ad_group_id as number);
            break;
          }
          case "delete_test_segment": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteTestSegment(payload.segment_id as number);
            break;
          }
          case "add_test_segment_relation": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.addTestSegmentRelation({ segmentId: payload.segment_id as number, nestedSegmentId: payload.nested_segment_id as number });
            break;
          }
          case "delete_test_segment_relation": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteTestSegmentRelation({ segmentId: payload.segment_id as number, relationId: payload.relation_id as number });
            break;
          }
          case "upload_static_image": {
            if (!options.uploadDir) throw new Error("Для upload задайте VK_ADS_UPLOAD_DIR с локальным безопасным каталогом.");
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const image = validateImageUpload(payload.file_path as string, options.uploadDir);
            if (image.sha256 !== payload.sha256 || image.size !== payload.size || image.mimeType !== payload.mime_type) {
              throw new Error("Файл изменился после preview; подготовьте новое подтверждение.");
            }
            result = await client.uploadStaticImage(image);
            const contentId = Number(result.id);
            if (Number.isInteger(contentId) && contentId > 0) {
              uploadedImages.set(contentId, {
                id: contentId,
                width: image.width,
                height: image.height,
                mimeType: image.mimeType,
                sha256: image.sha256,
              });
            }
            break;
          }
          case "upload_html5": {
            if (!options.uploadDir) throw new Error("Для upload задайте VK_ADS_UPLOAD_DIR с локальным безопасным каталогом.");
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const creative = validateHtml5Upload(payload.file_path as string, options.uploadDir);
            if (creative.sha256 !== payload.sha256 || creative.size !== payload.size || creative.htmlFile !== payload.html_file) {
              throw new Error("HTML5-креатив изменился после preview; подготовьте новое подтверждение.");
            }
            result = await client.uploadHtml5({ filename: creative.filename, bytes: creative.bytes });
            break;
          }
          case "upload_test_video": {
            if (!options.uploadDir) throw new Error("Для upload задайте VK_ADS_UPLOAD_DIR с локальным безопасным каталогом.");
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const video = validateVideoUpload(payload.file_path as string, options.uploadDir);
            if (video.sha256 !== payload.sha256 || video.size !== payload.size || video.mimeType !== payload.mime_type) {
              throw new Error("Файл изменился после preview; подготовьте новое подтверждение.");
            }
            result = await client.uploadVideo({
              ...video,
              width: payload.width as number,
              height: payload.height as number,
            });
            break;
          }
          case "upload_lead_form_logo": {
            if (!options.uploadDir) throw new Error("Для upload задайте VK_ADS_UPLOAD_DIR с локальным безопасным каталогом.");
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const image = validateLeadFormImageUpload(payload.file_path as string, options.uploadDir);
            if (image.sha256 !== payload.sha256 || image.size !== payload.size || image.mimeType !== payload.mime_type) throw new Error("Файл изменился после preview; подготовьте новое подтверждение.");
            result = await client.uploadLeadFormLogo({ ...image, mimeType: image.mimeType as "image/png" | "image/jpeg" });
            break;
          }
          case "create_test_offer_batch": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const tasks = await client.createTestPricelistBatchTask({ pricelistId: payload.pricelist_id as number, offerId: payload.offer_id as string, productType: payload.product_type as string, title: payload.title as string, link: payload.link as string, imageLink: payload.image_link as string, price: payload.price as string });
            result = { tasks: tasks.map((task) => publicSensitiveMetadata(task) as VkObject) };
            break;
          }
          case "upload_test_remarketing_user_list": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const piiRoot = options.piiUploadDir;
            if (!piiRoot || !options.allowPiiUploads) {
              throw new Error("Загрузка списка ремаркетинга с PII отключена до явного opt-in при запуске.");
            }
            const list = validateRemarketingUserListUpload(payload.file_path as string, piiRoot);
            if (list.sha256 !== payload.sha256 || list.size !== payload.size || list.lineCount !== payload.line_count) {
              throw new Error("Файл списка изменился после preview; подготовьте новое подтверждение.");
            }
            result = await client.createTestRemarketingUserList({
              name: payload.name as string,
              type: payload.type as string,
              filename: list.filename,
              mimeType: list.mimeType,
              bytes: list.bytes,
            });
            break;
          }
          case "rename_test_remarketing_user_list": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.renameTestRemarketingUserList(payload.list_id as number, payload.name as string);
            break;
          }
          case "delete_test_remarketing_user_list": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteTestRemarketingUserList(payload.list_id as number);
            break;
          }
          case "connect_agency_client": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.connectExistingAgencyClient({ userId: payload.user_id as number, accessType: payload.access_type as "full_access" });
            break;
          }
          case "create_test_local_geo": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.createTestLocalGeo({ name: payload.name as string, regions: payload.regions as Array<{ lat: number; lng: number; radius: number; label: string; address?: string }> });
            break;
          }
          case "update_test_local_geo": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.updateTestLocalGeo({ id: payload.local_geo_id as number, name: payload.name as string, regions: payload.regions as Array<{ lat: number; lng: number; radius: number; label: string; address?: string }> });
            break;
          }
          case "delete_test_local_geo": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteTestLocalGeo(payload.local_geo_id as number);
            break;
          }
          case "update_test_pricelist": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.updateTestPricelist({
              id: payload.pricelist_id as number,
              name: payload.name as string,
              status: payload.status as "active" | "blocked",
              removeUtmTags: payload.remove_utm_tags as boolean,
              ...(payload.export_url ? { exportUrl: payload.export_url as string } : {}),
            });
            break;
          }
          case "create_test_async_report": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.createTestCustomReport({
              title: payload.title as string,
              advertisers: payload.advertisers as number[],
              dateFrom: payload.date_from as string,
              dateTo: payload.date_to as string,
              metrics: payload.metrics as string[],
              slices: payload.slices as string[],
            });
            break;
          }
          case "delete_test_async_report": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteTestCustomReport(payload.report_id as number);
            break;
          }
          case "export_leads": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const exported = await client.exportLeadFormLeads({
              formId: payload.form_id as number,
              format: payload.format as "csv" | "xlsx",
              ...(payload.ad_plan_ids ? { adPlanIds: payload.ad_plan_ids as number[] } : {}),
              ...(payload.ad_group_ids ? { adGroupIds: payload.ad_group_ids as number[] } : {}),
              ...(payload.banner_ids ? { bannerIds: payload.banner_ids as number[] } : {}),
              ...(payload.created_at_gte ? { createdAtGte: payload.created_at_gte as string } : {}),
              ...(payload.created_at_lte ? { createdAtLte: payload.created_at_lte as string } : {}),
            });
            result = {
              form_id: payload.form_id as number,
              format: payload.format as string,
              content_type: exported.contentType,
              byte_length: exported.bytes.length,
              content_base64: Buffer.from(exported.bytes).toString("base64"),
            };
            break;
          }
          case "export_survey_respondents": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const exported = await client.exportSurveyFormRespondents(payload.form_id as number);
            result = {
              form_id: payload.form_id as number,
              format: "xlsx",
              content_type: exported.contentType,
              byte_length: exported.bytes.length,
              content_base64: Buffer.from(exported.bytes).toString("base64"),
            };
            break;
          }
          }
          const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
          const after = await captureWriteAfter(client, preview.operation, payload, result);
          const audit = writeGate.complete(preview, "succeeded", (preview.operation === "export_leads" || preview.operation === "export_survey_respondents")
            ? { form_id: result.form_id, format: result.format, byte_length: result.byte_length }
            : { result, after });
          return textAndData({ operation: preview.operation, result, after, audit }, "Подтверждённая тестовая операция VK Ads выполнена и повторно проверена, если API поддерживает чтение объекта.");
        } catch (error) {
          writeGate.complete(preview, "failed");
          throw error;
        }
      },
    );

    server.registerTool(
      "write_audit_list",
      {
        title: "Журнал тестовых записей",
        description: "Read-only: возвращает метаданные preview и выполнения текущего процесса без токенов, payload и тел API-ответов.",
        inputSchema: { limit: z.number().int().min(1).max(100).default(50) },
        outputSchema: { items: z.array(z.object({
          id: z.string().uuid(), operation: testWriteOperationSchema, connection_id: z.string(), status: z.enum(["prepared", "succeeded", "failed"]),
          prepared_at: z.string().datetime(), completed_at: z.string().datetime().nullable(), result_hash: z.string().length(64).nullable(),
        })) },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      },
      async ({ limit }) => textAndData({ items: writeGate.listAudit(limit) }, "Журнал тестовых записей получен."),
    );
  }

  return server;
}
