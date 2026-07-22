import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";

import { accountAuditInputSchema, analyticsRowSchema, analyticsThresholdsSchema, analyticsTimeSeriesPointSchema, analyticsToolNames, buildAccountAudit, deliveryDiagnosticInputSchema, runAnalyticsTool } from "./analytics-tools.js";
import type { ServerMode } from "./config.js";
import { statisticsToExportRows, toCsv, toXlsx, type ExportRow } from "./export.js";
import { isExecutableTool, searchCatalog, toolCatalog } from "./tool-catalog.js";
import { VERIFIED_AD_GROUP_FIELDS, VERIFIED_AD_PLAN_FIELDS, VERIFIED_BANNER_FIELDS, VkAdsApiError, VkAdsClient, type VkObject, type VkPagedResponse } from "./vk-client.js";
import { WriteGate, type TestWriteOperation, type WriteOperation } from "./write-gate.js";
import { validateHtml5Upload, validateImageUpload, validateLeadFormImageUpload, validateRemarketingUserListUpload, validateVideoUpload } from "./upload-policy.js";
import { validateConfirmedTestBannerDraft, type KnownStaticImage } from "./banner-preflight.js";
import { validateTestAdGroupParent, validateTestAdPlanDraft, type WritePreflightResult } from "./write-preflight.js";
import { validateAdvertisingDestination } from "./destination-policy.js";
import { analyze, candidate, includeCandidate, score, type Candidate } from "./community-analysis.js";
import { VkCommunityClient, type CommunityType } from "./vk-community-client.js";

const pagingSchema = {
  offset: z.number().int().nonnegative().default(0).describe("Смещение в списке."),
  limit: z.number().int().min(1).max(200).default(100).describe("Размер страницы, не более 200."),
};

const statisticsInputSchema = {
  api_version: z.enum(["v2", "v3"]).default("v2"),
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

export const callableReadTools = [
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

const exportRowsSchema = z.array(z.record(z.string().min(1).max(120), z.union([z.string().max(10_000), z.number().finite(), z.boolean(), z.null()]))).min(1).max(1_000);

const testWriteOperationSchema = z.enum(["recover_token_limit", "create_url", "create_test_ad_plan", "create_test_campaign", "create_test_ad_group", "create_test_banner", "create_test_segment", "create_test_pricelist", "rename_test_ad_plan", "rename_test_campaign", "update_campaign_budget_limit_day", "rename_test_ad_group", "rename_test_banner", "rename_test_segment", "rename_test_lead_form", "rename_test_remarketing_counter", "delete_test_remarketing_counter", "delete_test_remarketing_counter_v2", "create_test_counter_goal", "update_test_counter_goal", "update_test_inapp_event_category", "update_test_pricelist", "create_test_async_report", "delete_test_async_report", "block_test_ad_plans", "block_test_ad_groups", "block_test_banners", "remoderate_test_banners", "delete_test_ad_plan", "delete_test_ad_group", "delete_test_segment", "add_test_segment_relation", "update_test_segment_relation", "delete_test_segment_relation", "upload_static_image", "upload_html5", "upload_test_video", "upload_lead_form_logo", "create_test_offer_batch", "export_leads", "export_survey_respondents", "upload_test_remarketing_user_list", "upload_test_offline_goal", "update_test_offline_goal", "rename_test_remarketing_user_list", "delete_test_remarketing_user_list", "delete_test_remarketing_user_list_v3", "connect_agency_client", "update_agency_client", "delete_agency_client", "update_manager_client", "delete_manager_client", "connect_existing_remarketing_counter", "update_ord_partner_acts", "update_ord_partner_pad", "create_ord_partner_subagent", "update_ord_partner_subagent", "transfer_to_client", "create_test_local_geo", "update_test_local_geo", "delete_test_local_geo", "copy_test_lead_form", "copy_test_survey_form", "manage_test_lead_forms_archive", "manage_test_survey_forms_archive", "send_test_lead", "create_test_sharing_key", "revoke_created_sharing_key", "share_test_skadnetwork_ids", "withdraw_test_skadnetwork_ids", "create_ad_plan", "update_ad_plan", "delete_ad_plan", "manage_ad_plans", "create_campaign", "update_campaign", "delete_campaign", "create_ad_group", "update_ad_group", "delete_ad_group", "manage_ad_groups", "create_banner", "update_banner", "delete_banner", "manage_banners", "delete_subscription", "refresh_apple_app_metadata", "refresh_google_app_metadata", "create_subscription", "delete_test_offline_goal"]);
const writeOperationSchema = z.union([testWriteOperationSchema.exclude(["update_test_pricelist"]), z.literal("activate_configured_sharing_key"), z.literal("update_user_profile"), z.literal("delete_test_campaign")]);

/**
 * Эти legacy-пути есть в старом коде, но отсутствуют в текущем официальном
 * индексе контрактов. До публикации первичного контракта они не получают
 * preview и не могут быть ошибочно выданы за поддерживаемый VK Ads API.
 */
const unindexedWriteOperations = new Set<WriteOperation>([
  "create_test_campaign", "rename_test_campaign", "update_campaign_budget_limit_day", "delete_test_campaign",
  "create_campaign", "update_campaign", "delete_campaign",
  "create_test_async_report", "delete_test_async_report", "create_test_offer_batch",
]);

const confirmedTestGroupTargetingsSchema = z.object({
  geo: z.object({
    regions: z.array(z.number().int().positive()).min(1).max(200),
  }).strict(),
  age: z.object({
    age_list: z.array(z.number().int().min(18).max(80)).min(1).max(63),
    expand: z.boolean(),
  }).strict(),
}).strict();

const productionStatusSchema = z.enum(["active", "blocked", "deleted"]);
const productionDateSchema = z.string().datetime({ offset: true });
const productionMoneySchema = z.union([z.number().finite(), z.string().regex(/^\d+(?:\.\d+)?$/)]);
const productionTargetingsSchema = z.object({
  geo: z.object({ regions: z.array(z.number().int().positive()).max(200).optional(), local_geo: z.array(z.number().int().positive()).max(200).optional() }).strict().optional(),
  age: z.object({ age_list: z.array(z.number().int().min(0).max(100)).max(101).optional(), expand: z.boolean().optional() }).strict().optional(),
  sex: z.array(z.enum(["male", "female"])).max(2).optional(),
  pads: z.array(z.number().int().positive()).max(500).optional(),
  fulltime: z.array(z.number().int().min(0).max(167)).max(168).optional(),
  interests: z.array(z.number().int()).max(500).optional(),
  interests_soc_dem: z.array(z.number().int()).max(500).optional(),
  interests_stable: z.array(z.number().int()).max(500).optional(),
  mobile_operation_systems: z.array(z.number().int()).max(100).optional(),
  mobile_operators: z.array(z.number().int()).max(100).optional(),
  mobile_types: z.array(z.string().min(1).max(80)).max(50).optional(),
  mobile_vendors: z.array(z.number().int()).max(100).optional(),
  segments: z.array(z.number().int().positive()).max(500).optional(),
}).strict();
const productionAdPlanFieldsSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: productionStatusSchema.optional(),
  date_start: productionDateSchema.optional(),
  date_end: productionDateSchema.optional(),
  autobidding_mode: z.string().min(1).max(80).optional(),
  budget_limit_day: productionMoneySchema.optional(),
  budget_limit: productionMoneySchema.optional(),
  enable_utm: z.boolean().optional(),
  enable_offline_goals: z.boolean().optional(),
  objective: z.string().min(1).max(80).optional(),
  ad_groups: z.array(z.object({
    name: z.string().min(1).max(120),
    status: productionStatusSchema.optional(),
    package_id: z.number().int().positive(),
    objective: z.string().min(1).max(80),
    date_start: productionDateSchema.optional(),
    date_end: productionDateSchema.optional(),
    budget_limit_day: productionMoneySchema.optional(),
    budget_limit: productionMoneySchema.optional(),
    autobidding_mode: z.string().min(1).max(80).optional(),
    targetings: productionTargetingsSchema.optional(),
  }).strict()).max(200).optional(),
}).strict();
const productionCampaignFieldsSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: productionStatusSchema.optional(),
  ad_plan_id: z.number().int().positive().optional(),
  package_id: z.number().int().positive().optional(),
  objective: z.string().min(1).max(80).optional(),
  date_start: productionDateSchema.optional(),
  date_end: productionDateSchema.optional(),
  budget_limit_day: productionMoneySchema.optional(),
  budget_limit: productionMoneySchema.optional(),
  autobidding_mode: z.string().min(1).max(80).optional(),
}).strict();
const productionAdGroupFieldsSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: productionStatusSchema.optional(),
  ad_plan_id: z.number().int().positive().optional(),
  package_id: z.number().int().positive().optional(),
  objective: z.string().min(1).max(80).optional(),
  date_start: productionDateSchema.optional(),
  date_end: productionDateSchema.optional(),
  autobidding_mode: z.string().min(1).max(80).optional(),
  budget_limit_day: productionMoneySchema.optional(),
  budget_limit: productionMoneySchema.optional(),
  mixing: z.string().min(1).max(80).optional(),
  price: productionMoneySchema.optional(),
  max_price: productionMoneySchema.optional(),
  age_restrictions: z.string().max(80).optional(),
  banner_uniq_shows_limit: z.number().int().nonnegative().optional(),
  uniq_shows_period: z.string().min(1).max(80).optional(),
  uniq_shows_limit: z.number().int().nonnegative().optional(),
  audit_viewability: z.string().max(80).optional(),
  enable_utm: z.boolean().optional(),
  enable_offline_goals: z.boolean().optional(),
  targetings: productionTargetingsSchema.optional(),
}).strict();
const productionCreativeRefSchema = z.object({ id: z.number().int().positive() }).strict();
const productionBannerFieldsSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  status: productionStatusSchema.optional(),
  content: z.object({
    image_1080x607: productionCreativeRefSchema.optional(),
    icon_256x256_app: productionCreativeRefSchema.optional(),
    image_1080x1200: productionCreativeRefSchema.optional(),
    video: productionCreativeRefSchema.optional(),
    html5: productionCreativeRefSchema.optional(),
  }).strict().optional(),
  textblocks: z.object({
    title_25: z.object({ text: z.string().min(1).max(25) }).strict().optional(),
    title_40_vkads: z.object({ text: z.string().min(1).max(40) }).strict().optional(),
    text_90: z.object({ text: z.string().min(1).max(90) }).strict().optional(),
    cta_apps_full: z.object({ text: z.string().min(1).max(80) }).strict().optional(),
  }).strict().optional(),
  urls: z.object({ primary: productionCreativeRefSchema.optional(), additional: z.array(productionCreativeRefSchema).max(20).optional() }).strict().optional(),
  ad_group_id: z.number().int().positive().optional(),
}).strict();
const productionAdPlanMassItemSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(["active", "blocked", "deleted"]).optional(),
  budget_limit_day: productionMoneySchema.optional(),
  date_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  date_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  max_price: productionMoneySchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 1, "Укажите хотя бы одно изменяемое поле mass-action.");
const productionAdGroupMassItemSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(["active", "blocked"]).optional(),
  max_price: productionMoneySchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 1, "Укажите хотя бы одно изменяемое поле mass-action.");
const productionBannerMassItemSchema = z.object({
  id: z.number().int().positive(),
  status: z.enum(["active", "blocked"]).optional(),
}).strict().refine((value) => Object.keys(value).length > 1, "Укажите status для banner mass-action.");
const ordDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ordMoneySchema = z.string().regex(/^\d+(?:\.\d{1,3})?$/);
const ordSubagentFieldsSchema = z.object({
  user_type: z.enum(["physical", "juridical", "ip", "foreign_physical", "foreign_juridical"]),
  role: z.array(z.enum(["publisher", "ors"])).min(1).max(2),
  name: z.string().min(1).max(255),
  inn: z.string().regex(/^\d{10,12}$/).optional(),
  site: z.string().url().max(2_048).optional(),
  phone: z.string().min(3).max(32).optional(),
  foreign_epayment_method: z.string().max(255).nullable().optional(),
  foreign_oksm_country_code: z.string().regex(/^\d{3}$/).nullable().optional(),
  foreign_registration_number: z.string().max(255).nullable().optional(),
}).strict();
const ordActItemSchema = z.object({ contract_id: z.number().int().positive(), act_date: ordDateSchema, amount: ordMoneySchema, has_vat: z.boolean() }).strict();
const ordContractUpdateSchema = z.object({
  id: z.number().int().positive(),
  contract_number: z.string().max(255).optional(),
  contract_date: ordDateSchema.optional(),
  contract_subject: z.string().max(255).optional(),
  vat: z.boolean().optional(),
  subagent: ordSubagentFieldsSchema.partial().strict().optional(),
}).strict();
const userProfileBaseSchema = z.object({
  info_currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  language: z.enum(["ru", "en"]).optional(),
  status: z.enum(["active", "blocked"]).optional(),
  additional_emails: z.array(z.string().email().max(254)).min(1).max(10).optional(),
  additional_info: z.object({ name: z.string().trim().min(1).max(255).optional(), phone: z.string().trim().min(3).max(32).optional() }).strict().optional(),
}).strict();
const userProfileV2Schema = userProfileBaseSchema.extend({
  mailing: z.array(z.enum(["finance", "moderation"])).min(1).max(2).optional(),
}).strict();
const userProfileV3Schema = userProfileBaseSchema.extend({
  mailings: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), z.object({ email: z.array(z.string().email().max(254)).max(10) }).strict()).refine((value) => { const size = Object.keys(value).length; return size >= 1 && size <= 50; }, "Укажите от 1 до 50 типов рассылки.").optional(),
  email_settings: z.array(z.object({ type: z.enum(["USER", "PARENT", "ADDITIONAL"]), email: z.string().email().max(254) }).strict()).min(1).max(10).optional(),
}).strict();

function requireAtLeastOneField(schema: { parse: (value: unknown) => Record<string, unknown> }, payload: Record<string, unknown>): Record<string, unknown> {
  const parsed = schema.parse(payload);
  if (Object.keys(parsed).length === 0) throw new Error("Укажите хотя бы одно изменяемое поле.");
  return parsed;
}

function normalizeTestWritePayloadCore(
  operation: WriteOperation,
  payload: Record<string, unknown>,
  uploadDir?: string,
  piiUploadDir = process.env.VK_ADS_PII_UPLOAD_DIR,
  allowPiiUploads = process.env.VK_ADS_ALLOW_PII_UPLOADS === "1",
  allowAgencyWrites = process.env.VK_ADS_ALLOW_AGENCY_WRITES === "1",
): Record<string, unknown> {
  switch (operation) {
    case "recover_token_limit":
      return z.object({}).strict().parse(payload);
    case "activate_configured_sharing_key":
      return z.object({}).strict().parse(payload);
    case "create_url": {
      const parsed = z.object({
        url: z.string().min(1).max(2_048).url(),
      }).parse(payload);
      return { url: validateAdvertisingDestination(parsed.url).url };
    }
    case "create_ad_plan": {
      const parsed = productionAdPlanFieldsSchema.extend({
        name: z.string().min(1).max(120),
        objective: z.string().min(1).max(80),
        status: productionStatusSchema.default("blocked"),
      }).parse(payload);
      return parsed;
    }
    case "update_ad_plan": {
      const id = z.object({ ad_plan_id: z.number().int().positive() }).parse(payload).ad_plan_id;
      return { ad_plan_id: id, ...requireAtLeastOneField(productionAdPlanFieldsSchema, payload) };
    }
    case "delete_ad_plan":
      return z.object({ ad_plan_id: z.number().int().positive() }).strict().parse(payload);
    case "manage_ad_plans":
      return z.object({ items: z.array(productionAdPlanMassItemSchema).min(1).max(200) }).strict().parse(payload);
    case "create_campaign": {
      const parsed = productionCampaignFieldsSchema.extend({
        name: z.string().min(1).max(120),
        ad_plan_id: z.number().int().positive(),
        package_id: z.number().int().positive(),
        objective: z.string().min(1).max(80),
        status: productionStatusSchema.default("blocked"),
      }).parse(payload);
      return parsed;
    }
    case "update_campaign": {
      const id = z.object({ campaign_id: z.number().int().positive() }).parse(payload).campaign_id;
      return { campaign_id: id, ...requireAtLeastOneField(productionCampaignFieldsSchema, payload) };
    }
    case "delete_campaign":
      return z.object({ campaign_id: z.number().int().positive() }).strict().parse(payload);
    case "create_ad_group": {
      const parsed = productionAdGroupFieldsSchema.extend({
        name: z.string().min(1).max(120),
        ad_plan_id: z.number().int().positive(),
        package_id: z.number().int().positive(),
        targetings: productionTargetingsSchema,
        status: productionStatusSchema.default("blocked"),
      }).parse(payload);
      return parsed;
    }
    case "update_ad_group": {
      const id = z.object({ ad_group_id: z.number().int().positive() }).parse(payload).ad_group_id;
      return { ad_group_id: id, ...requireAtLeastOneField(productionAdGroupFieldsSchema, payload) };
    }
    case "delete_ad_group":
      return z.object({ ad_group_id: z.number().int().positive() }).strict().parse(payload);
    case "manage_ad_groups":
      return z.object({ items: z.array(productionAdGroupMassItemSchema).min(1).max(200) }).strict().parse(payload);
    case "create_banner": {
      const parsed = productionBannerFieldsSchema.extend({
        ad_group_id: z.number().int().positive(),
        name: z.string().min(1).max(120),
        content: productionBannerFieldsSchema.shape.content.unwrap(),
        textblocks: productionBannerFieldsSchema.shape.textblocks.unwrap(),
        urls: productionBannerFieldsSchema.shape.urls.unwrap(),
        status: productionStatusSchema.default("blocked"),
      }).parse(payload);
      return parsed;
    }
    case "update_banner": {
      const id = z.object({ banner_id: z.number().int().positive() }).parse(payload).banner_id;
      return { banner_id: id, ...requireAtLeastOneField(productionBannerFieldsSchema.omit({ ad_group_id: true }), payload) };
    }
    case "delete_banner":
      return z.object({ banner_id: z.number().int().positive() }).strict().parse(payload);
    case "manage_banners":
      return z.object({ items: z.array(productionBannerMassItemSchema).min(1).max(200) }).strict().parse(payload);
    case "delete_subscription":
      return z.object({ subscription_id: z.number().int().positive() }).strict().parse(payload);
    case "create_subscription": {
      const parsed = z.object({
        resource: z.enum(["BANNER", "CAMPAIGN", "OKLEADAD"]),
        callback_url: z.string().min(1).max(2_048).url(),
      }).strict().parse(payload);
      return { resource: parsed.resource, callback_url: validateAdvertisingDestination(parsed.callback_url).url };
    }
    case "refresh_apple_app_metadata":
      return z.object({ app_id: z.number().int().positive() }).strict().parse(payload);
    case "refresh_google_app_metadata":
      return z.object({ package_name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/) }).strict().parse(payload);
    case "update_manager_client":
      return z.object({ manager_id: z.number().int().positive(), client_id: z.number().int().positive(), access_type: z.enum(["full_access", "readonly", "fin_readonly", "ads_readonly"]) }).strict().parse(payload);
    case "delete_manager_client":
      return z.object({ manager_id: z.number().int().positive(), client_id: z.number().int().positive() }).strict().parse(payload);
    case "update_ord_partner_acts":
      return z.object({ month: z.string().regex(/^\d{4}-\d{2}-01$/), ord_pad_id: z.number().int().positive(), acts: z.array(ordActItemSchema).min(1).max(200) }).strict().parse(payload);
    case "update_ord_partner_pad":
      return z.object({ ord_pad_id: z.number().int().positive(), name: z.string().min(1).max(255).optional(), contracts: z.array(ordContractUpdateSchema).min(1).max(200).optional() }).strict().refine((value) => value.name !== undefined || value.contracts !== undefined, "Укажите name или contracts.").parse(payload);
    case "create_ord_partner_subagent":
      return ordSubagentFieldsSchema.parse(payload);
    case "update_ord_partner_subagent":
      return z.object({ id: z.number().int().positive() }).merge(ordSubagentFieldsSchema.partial()).strict().refine((value) => Object.keys(value).length > 1, "Укажите изменяемые поля контрагента.").parse(payload);
    case "transfer_to_client":
      return z.object({ client_id: z.number().int().positive(), amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/) }).strict().parse(payload);
    case "create_test_ad_plan": {
      const parsed = z.object({
        name: z.string().min(1).max(120),
        objective: z.string().min(1).max(80),
        package_id: z.number().int().positive(),
      }).parse(payload);
      return parsed;
    }
    case "create_test_ad_group": {
      const parsed = z.object({
        ad_plan_id: z.number().int().positive(),
        package_id: z.number().int().positive(),
        name: z.string().min(1).max(120),
        targetings: confirmedTestGroupTargetingsSchema,
      }).parse(payload);
      return parsed;
    }
    case "create_test_campaign": {
      const parsed = z.object({
        ad_plan_id: z.number().int().positive(),
        package_id: z.literal(2860),
        objective: z.literal("appinstalls"),
        name: z.string().min(1).max(120),
      }).parse(payload);
      return parsed;
    }
    case "create_test_banner": {
      const parsed = z.object({
        ad_group_id: z.number().int().positive(),
        name: z.string().min(1).max(120),
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
        name: z.string().min(1).max(120),
        counter_id: z.number().int().positive(),
        left_days: z.number().int().min(1).max(365).default(365),
        goal_id: z.string().min(1).max(120),
      }).parse(payload);
      return parsed;
    }
    case "create_test_pricelist":
      return z.object({ name: z.string().min(1).max(120) }).parse(payload);
    case "copy_test_lead_form":
    case "copy_test_survey_form":
      return z.object({ form_id: z.number().int().positive(), name: z.string().min(1).max(120) }).parse(payload);
    case "rename_test_lead_form":
      return z.object({ form_id: z.number().int().positive(), name: z.string().min(1).max(120) }).parse(payload);
    case "rename_test_remarketing_counter":
      return z.object({ counter_id: z.number().int().positive(), name: z.string().min(1).max(120) }).parse(payload);
    case "delete_test_remarketing_counter":
    case "delete_test_remarketing_counter_v2":
      return z.object({ counter_id: z.number().int().positive() }).parse(payload);
    case "delete_test_offline_goal":
      return z.object({ offline_goal_id: z.number().int().positive() }).strict().parse(payload);
    case "update_test_offline_goal": {
      const parsed = z.object({
        offline_goal_id: z.number().int().positive(),
        name: z.string().min(1).max(120),
        file_path: z.string().min(1).max(1_024).optional(),
      }).strict().parse(payload);
      if (!parsed.file_path) return parsed;
      if (!allowPiiUploads || !piiUploadDir) {
        throw new Error("Дозагрузка офлайн-конверсий с PII отключена. Нужны VK_ADS_ALLOW_PII_UPLOADS=1 и отдельный VK_ADS_PII_UPLOAD_DIR.");
      }
      const list = validateRemarketingUserListUpload(parsed.file_path, piiUploadDir);
      return { offline_goal_id: parsed.offline_goal_id, name: parsed.name, file_path: list.filePath, filename: list.filename, mime_type: list.mimeType, size: list.size, sha256: list.sha256, line_count: list.lineCount };
    }
    case "create_test_counter_goal":
      return z.object({ counter_id: z.number().int().positive(), name: z.string().trim().min(1).max(120), substr: z.string().trim().min(1).max(2_000), condition: z.enum(["uss", "rss", "jse", "hd", "ts"]), goal_type: z.enum(["content", "search", "basket", "wishlist", "checkout", "payment_info", "purchase", "lead", "registration", "custom"]), value: z.number().int().min(-2_147_483_647).max(2_147_483_647).nullable().optional() }).parse(payload);
    case "delete_test_remarketing_user_list_v3":
      return z.object({ list_id: z.number().int().positive() }).parse(payload);
    case "update_test_counter_goal":
      return z.object({ counter_id: z.number().int().positive(), goal_id: z.number().int().positive(), name: z.string().trim().min(1).max(120), value: z.number().int().min(-2_147_483_647).max(2_147_483_647), goal_type: z.enum(["content", "search", "basket", "wishlist", "checkout", "payment_info", "purchase", "lead", "registration", "custom"]) }).parse(payload);
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
        name: z.string().min(1).max(120),
      }).parse(payload);
      return parsed;
    }
    case "rename_test_campaign": {
      const parsed = z.object({
        campaign_id: z.number().int().positive(),
        name: z.string().min(1).max(120),
      }).parse(payload);
      return parsed;
    }
    case "update_campaign_budget_limit_day":
      return z.object({ campaign_id: z.number().int().positive(), budget_limit_day: z.number().finite().positive() }).parse(payload);
    case "rename_test_ad_group": {
      const parsed = z.object({
        ad_group_id: z.number().int().positive(),
        name: z.string().min(1).max(120),
      }).parse(payload);
      return parsed;
    }
    case "rename_test_banner": {
      const parsed = z.object({
        banner_id: z.number().int().positive(),
        name: z.string().min(1).max(120),
      }).parse(payload);
      return parsed;
    }
    case "rename_test_segment":
      return z.object({ segment_id: z.number().int().positive(), name: z.string().min(1).max(120) }).parse(payload);
    case "create_test_async_report":
      return z.object({
        title: z.string().min(1).max(120),
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
    case "delete_test_campaign":
      return z.object({ campaign_id: z.number().int().positive() }).parse(payload);
    case "delete_test_ad_group":
      return z.object({ ad_group_id: z.number().int().positive() }).parse(payload);
    case "delete_test_segment":
      return z.object({ segment_id: z.number().int().positive() }).parse(payload);
    case "add_test_segment_relation":
      return z.object({ segment_id: z.number().int().positive(), nested_segment_id: z.number().int().positive() }).parse(payload);
    case "update_test_segment_relation":
      return z.object({ segment_id: z.number().int().positive(), relation_id: z.number().int().positive(), left: z.number().int().min(1).max(365), right: z.number().int().min(0).max(364), type: z.enum(["positive", "negative"]) }).refine((value) => value.left > value.right, "left должен быть больше right.").parse(payload);
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
      const { file_path, name, type, api_version } = z.object({
        file_path: z.string().min(1).max(1_024),
        name: z.string().min(1).max(120),
        type: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/),
        api_version: z.enum(["v2", "v3"]).default("v2"),
      }).parse(payload);
      const list = validateRemarketingUserListUpload(file_path, piiUploadDir);
      return { file_path: list.filePath, filename: list.filename, mime_type: list.mimeType, size: list.size, sha256: list.sha256, line_count: list.lineCount, name, type, api_version };
    }
    case "upload_test_offline_goal": {
      if (!allowPiiUploads || !piiUploadDir) {
        throw new Error("Загрузка офлайн-конверсий с PII отключена. Нужны VK_ADS_ALLOW_PII_UPLOADS=1 и отдельный VK_ADS_PII_UPLOAD_DIR.");
      }
      const { file_path, name, attribution_period, type } = z.object({
        file_path: z.string().min(1).max(1_024),
        name: z.string().min(1).max(120),
        attribution_period: z.number().int().min(1).max(365),
        type: z.enum(["email", "hash_email", "phone", "hash_phone"]),
      }).parse(payload);
      const list = validateRemarketingUserListUpload(file_path, piiUploadDir);
      return { file_path: list.filePath, filename: list.filename, mime_type: list.mimeType, size: list.size, sha256: list.sha256, line_count: list.lineCount, name, attribution_period, type };
    }
    case "rename_test_remarketing_user_list":
      return z.object({ list_id: z.number().int().positive(), name: z.string().min(1).max(120), api_version: z.enum(["v2", "v3"]).default("v2") }).parse(payload);
    case "delete_test_remarketing_user_list":
      return z.object({ list_id: z.number().int().positive() }).parse(payload);
    case "connect_agency_client": {
      if (!allowAgencyWrites) throw new Error("Агентское подключение отключено. Для него нужен отдельный VK_ADS_ALLOW_AGENCY_WRITES=1 при запуске.");
      return z.object({ user_id: z.number().int().positive(), access_type: z.literal("full_access") }).parse(payload);
    }
    case "update_agency_client": {
      const parsed = z.object({
        client_id: z.number().int().positive(),
        is_vkads: z.boolean().optional(),
        access_type: z.literal("full_access").optional(),
        additional_emails: z.array(z.string().email().max(254)).min(1).max(10).optional(),
        additional_info: z.object({
          client_name: z.string().trim().min(1).max(255).optional(),
          client_info: z.string().trim().min(1).max(1_000).optional(),
        }).strict().optional(),
      }).strict().parse(payload);
      if (parsed.is_vkads === undefined && parsed.access_type === undefined && parsed.additional_emails === undefined && parsed.additional_info === undefined) {
        throw new Error("Укажите хотя бы одно изменяемое поле клиента агентства.");
      }
      if (parsed.additional_info && parsed.additional_info.client_name === undefined && parsed.additional_info.client_info === undefined) {
        throw new Error("additional_info должен содержать client_name или client_info.");
      }
      return parsed;
    }
    case "delete_agency_client":
      return z.object({ client_id: z.number().int().positive() }).strict().parse(payload);
    case "update_user_profile": {
      const header = z.object({ api_version: z.enum(["v2", "v3"]) }).parse(payload);
      const parsed = (header.api_version === "v3" ? userProfileV3Schema : userProfileV2Schema).extend({ api_version: z.literal(header.api_version) }).parse(payload);
      const { api_version: _apiVersion, ...body } = parsed as Record<string, unknown>;
      if (Object.keys(body).length === 0) throw new Error("Укажите хотя бы одно изменяемое поле профиля.");
      return { api_version: header.api_version, ...body };
    }
    case "connect_existing_remarketing_counter":
      return z.object({ counter_id: z.number().int().positive(), name: z.string().trim().min(1).max(120), flags: z.array(z.literal("cookie_sync")).max(1).default(["cookie_sync"]) }).strict().parse(payload);
    case "create_test_local_geo": {
      const parsed = z.object({
        name: z.string().min(1).max(120),
        regions: z.array(z.object({
          lat: z.number().finite().min(-90).max(90),
          lng: z.number().finite().min(-180).max(180),
          radius: z.number().int().min(500).max(10_000),
          label: z.string().trim().min(1).max(200),
          address: z.string().trim().min(1).max(500).optional(),
        }).strict()).min(1).max(200),
      }).parse(payload);
      return parsed;
    }
    case "update_test_local_geo": {
      const parsed = z.object({
        local_geo_id: z.number().int().positive(),
        name: z.string().min(1).max(120),
        regions: z.array(z.object({
          lat: z.number().finite().min(-90).max(90),
          lng: z.number().finite().min(-180).max(180),
          radius: z.number().int().min(500).max(10_000),
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

/** v1 URL-lookup может вернуть trackers и служебные ссылки; наружу только безопасная metadata. */
function publicUrlMetadata(item: VkObject): VkObject {
  const allowed = ["id", "url_types", "url_object_id", "has_bad_landing", "has_nonhttps_redirects", "has_mobile_app", "mobile_app_type", "has_goals", "has_postback_trackers"];
  return Object.fromEntries(allowed.flatMap((key) => Object.hasOwn(item, key) ? [[key, item[key]]] : []));
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
): Promise<{ ready: boolean; checks: Array<{ code: string; status: "pass" | "fail"; message: string }> }> {
  const appId = payload.app_id as number;
  const count = payload.count as number;
  const recipient = payload.recipient as string;
  const checks: Array<{ code: string; status: "pass" | "fail"; message: string }> = [];
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
): Promise<{ ready: boolean; checks: Array<{ code: string; status: "pass" | "fail"; message: string }> }> {
  const appId = payload.app_id as number;
  const checks: Array<{ code: string; status: "pass" | "fail"; message: string }> = [];

  const categories = await client.listInAppEventCategories();
  const categoryFound = categories.some((category) => Number(category.id) === Number(payload.category_id));
  checks.push({ code: "category_exists", status: categoryFound ? "pass" : "fail", message: categoryFound ? "Категория подтверждена справочником VK Ads." : "category_id отсутствует в справочнике VK Ads." });

  try {
    await inAppEventFromPages(client, { appId, trackerId: payload.tracker_id as number, eventId: payload.event_id as number });
    checks.push({ code: "event_access", status: "pass", message: "Событие доступно текущему кабинету." });
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
  return remarketingListMetadata(await client.getRemarketingUserListV3(id));
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

function writeImpact(operation: WriteOperation): { risk: "low" | "medium" | "high"; expected_change: string } {
  switch (operation) {
    case "recover_token_limit": return { risk: "high", expected_change: "Удалить все токены текущей связки VK Ads clientId--user, затем выпустить ровно один новый токен и сохранить его refresh_token локально. Кампании, группы, баннеры, бюджеты и аудитории не изменяются." };
    case "activate_configured_sharing_key": return { risk: "high", expected_change: "Активировать внешний ключ шаринга и добавить все связанные с ним источники в текущий кабинет. Кампании, бюджеты и существующие сущности не изменяются, но новые источники станут доступны." };
    case "create_url": return { risk: "low", expected_change: "Зарегистрировать HTTPS landing URL в VK Ads; показы, banner и расход не создаются." };
    case "create_ad_plan": return { risk: "medium", expected_change: "Создать production ad plan с переданными документированными параметрами; по умолчанию он будет blocked и не начнёт показы." };
    case "update_ad_plan": return { risk: "medium", expected_change: "Изменить указанные поля существующего production ad plan; остальные поля и дочерние объекты не изменяются." };
    case "delete_ad_plan": return { risk: "high", expected_change: "Перевести существующий production ad plan в status=deleted; операция затрагивает его дочернюю иерархию." };
    case "manage_ad_plans": return { risk: "high", expected_change: "Массово установить указанный статус для перечисленных production ad plans." };
    case "create_campaign": return { risk: "medium", expected_change: "Создать production campaign в указанном ad plan; по умолчанию campaign будет blocked." };
    case "update_campaign": return { risk: "medium", expected_change: "Изменить указанные поля существующей production campaign." };
    case "delete_campaign": return { risk: "high", expected_change: "Перевести существующую production campaign в status=deleted." };
    case "create_ad_group": return { risk: "medium", expected_change: "Создать production ad group в указанном ad plan; по умолчанию group будет blocked." };
    case "update_ad_group": return { risk: "medium", expected_change: "Изменить указанные поля существующей production ad group, включая budget, bid и targeting." };
    case "delete_ad_group": return { risk: "high", expected_change: "Перевести существующую production ad group в status=deleted." };
    case "manage_ad_groups": return { risk: "high", expected_change: "Массово установить указанный статус для перечисленных production ad groups." };
    case "create_banner": return { risk: "medium", expected_change: "Создать production banner в указанной ad group; по умолчанию banner будет blocked." };
    case "update_banner": return { risk: "medium", expected_change: "Изменить указанные поля существующего production banner." };
    case "delete_banner": return { risk: "high", expected_change: "Перевести существующий production banner в status=deleted." };
    case "manage_banners": return { risk: "high", expected_change: "Массово установить указанный статус для перечисленных production banners." };
    case "delete_subscription": return { risk: "high", expected_change: "Удалить одну подписку VK Ads через официальный HTTP DELETE; уведомления по ней прекратятся." };
    case "create_subscription": return { risk: "medium", expected_change: "Создать одну новую подписку на уведомления указанного ресурса; кампании, группы, объявления, бюджеты и аудитории не изменяются." };
    case "refresh_apple_app_metadata": return { risk: "low", expected_change: "Обновить только справочные metadata указанного iOS-приложения из App Store; кампании, группы, объявления, бюджеты и аудитории не изменяются." };
    case "refresh_google_app_metadata": return { risk: "low", expected_change: "Обновить только справочные metadata указанного Android-приложения из Google Play; кампании, группы, объявления, бюджеты и аудитории не изменяются." };
    case "update_manager_client": return { risk: "high", expected_change: "Изменить уровень доступа клиента у менеджера агентства." };
    case "delete_manager_client": return { risk: "high", expected_change: "Вывести клиента из ведения указанного менеджера; кабинет клиента не удаляется." };
    case "update_agency_client": return { risk: "high", expected_change: "Изменить документированные параметры связи уже привязанного клиента агентства; рекламные кампании и бюджеты клиента не меняются." };
    case "delete_agency_client": return { risk: "high", expected_change: "Удалить только связь указанного клиента с агентством; рекламный кабинет и его объекты не удаляются." };
    case "update_user_profile": return { risk: "high", expected_change: "Изменить только документированные настройки профиля и уведомлений текущего кабинета; кампании, бюджеты и аудитории не затрагиваются." };
    case "connect_existing_remarketing_counter": return { risk: "high", expected_change: "Подключить указанный существующий счётчик Top.Mail.ru к текущему кабинету без передачи пароля; кампании, бюджеты и уже подключённые счётчики не меняются." };
    case "update_ord_partner_acts": return { risk: "high", expected_change: "Изменить цепочку актов ОРД для одной площадки и месяца." };
    case "update_ord_partner_pad": return { risk: "high", expected_change: "Изменить отчётную площадку и/или договорную цепочку ОРД." };
    case "create_ord_partner_subagent": return { risk: "high", expected_change: "Создать контрагента ОРД; запрос может содержать юридические и контактные данные." };
    case "update_ord_partner_subagent": return { risk: "high", expected_change: "Изменить данные контрагента ОРД." };
    case "transfer_to_client": return { risk: "high", expected_change: "Перевести указанную сумму с агентского баланса клиенту; это финансовая операция." };
    case "create_test_ad_plan": return { risk: "low", expected_change: "Создать остановленный изолированный test ad plan; показы и расход не запускаются." };
    case "create_test_campaign": return { risk: "low", expected_change: "Создать остановленную test campaign package 2860 внутри test ad plan; показы и расход не запускаются." };
    case "create_test_ad_group": return { risk: "low", expected_change: "Создать остановленную test ad group внутри test ad plan; показы и расход не запускаются." };
    case "create_test_banner": return { risk: "low", expected_change: "Создать остановленный banner в выбранной группе package_id=2860; расход не запускается." };
    case "create_test_segment": return { risk: "low", expected_change: "Создать сегмент с указанным источником; существующие объекты не изменяются." };
    case "create_test_pricelist": return { risk: "low", expected_change: "Создать пустой blocked-каталог без внешнего URL, credentials, кампаний или товаров." };
    case "copy_test_lead_form": return { risk: "low", expected_change: "Создать копию существующей лид-формы; контактные поля и ответы не читаются." };
    case "rename_test_lead_form": return { risk: "low", expected_change: "Переименовать существующую лид-форму; контактные поля, страницы и уведомления не изменяются." };
    case "update_test_inapp_event_category": return { risk: "medium", expected_change: "Изменить категорию одного события указанного мобильного приложения; настройки кампаний и объявления не изменяются." };
    case "copy_test_survey_form": return { risk: "low", expected_change: "Создать копию существующего опроса; ответы респондентов не читаются." };
    case "manage_test_lead_forms_archive": return { risk: "medium", expected_change: "Архивировать или вернуть из архива указанные лид-формы." };
    case "manage_test_survey_forms_archive": return { risk: "medium", expected_change: "Архивировать или вернуть из архива указанные опросы." };
    case "send_test_lead": return { risk: "medium", expected_change: "Отправить один служебный тестовый лид в указанную форму; контактные данные и ответы не передаются." };
    case "create_test_sharing_key": return { risk: "medium", expected_change: "Создать ключ для указанного сегмента и передать его получателю через VK Ads; сам ключ не будет показан или записан в audit." };
    case "revoke_created_sharing_key": return { risk: "high", expected_change: "Отозвать только ключ, созданный текущим MCP-сеансом. Отзыв может остановить кампании получателя, поэтому требует отдельного opt-in при запуске." };
    case "share_test_skadnetwork_ids": return { risk: "high", expected_change: "Передать свободные SKAdNetwork IDs только из allowlist тестового iOS-приложения. Кампании не должны быть затронуты." };
    case "withdraw_test_skadnetwork_ids": return { risk: "high", expected_change: "Вернуть только свободные SKAdNetwork IDs из allowlist тестового iOS-приложения. Если есть связанные кампании или недостаточно свободных IDs, операция блокируется." };
    case "rename_test_ad_plan": return { risk: "low", expected_change: "Переименовать выбранный ad plan." };
    case "rename_test_remarketing_counter": return { risk: "low", expected_change: "Переименовать только allowlist test-счётчик ремаркетинга." };
    case "delete_test_remarketing_counter": return { risk: "high", expected_change: "Удалить только allowlist test-счётчик ремаркетинга; операция необратима." };
    case "delete_test_remarketing_counter_v2": return { risk: "high", expected_change: "Удалить только allowlist test-счётчик ремаркетинга через документированный v2 DELETE; операция необратима." };
    case "delete_test_offline_goal": return { risk: "high", expected_change: "Удалить указанный список офлайн-конверсий; исходные записи и PII не читаются." };
    case "update_test_offline_goal": return { risk: "medium", expected_change: "Переименовать и/или дозагрузить указанный список офлайн-конверсий; PII остаётся в multipart body и не попадает в audit." };
    case "create_test_counter_goal": return { risk: "medium", expected_change: "Создать новую цель в указанном доступном счётчике ремаркетинга." };
    case "delete_test_remarketing_user_list_v3": return { risk: "high", expected_change: "Удалить указанный список ремаркетинга через документированный v3 DELETE; операция необратима." };
    case "update_test_counter_goal": return { risk: "medium", expected_change: "Изменить указанную существующую цель в доступном счётчике ремаркетинга." };
    case "rename_test_campaign": return { risk: "low", expected_change: "Переименовать выбранную campaign." };
    case "update_campaign_budget_limit_day": return { risk: "medium", expected_change: "Изменить дневной лимит выбранной кампании; показы и статус не меняются." };
    case "rename_test_ad_group": return { risk: "low", expected_change: "Переименовать выбранную ad group." };
    case "rename_test_banner": return { risk: "low", expected_change: "Переименовать выбранный banner." };
    case "rename_test_segment": return { risk: "low", expected_change: "Переименовать выбранный сегмент." };
    case "create_test_async_report": return { risk: "low", expected_change: "Создать серверный отчёт; кампании и расход не меняются." };
    case "delete_test_async_report": return { risk: "medium", expected_change: "Удалить указанный серверный отчёт." };
    case "block_test_ad_plans": return { risk: "low", expected_change: "Массово перевести указанные ad plan в статус blocked; показы и расход не запускаются." };
    case "block_test_ad_groups": return { risk: "low", expected_change: "Массово перевести указанные ad group в статус blocked; показы и расход не запускаются." };
    case "block_test_banners": return { risk: "low", expected_change: "Массово перевести указанные banner в статус blocked; показы и расход не запускаются." };
    case "remoderate_test_banners": return { risk: "low", expected_change: "Запросить повторную модерацию указанных banner, если VK Ads явно разрешает её; бюджет и статус не меняются." };
    case "delete_test_ad_plan": return { risk: "medium", expected_change: "Пометить test ad plan как deleted; операция необратима в интерфейсе сервера." };
    case "delete_test_campaign": return { risk: "medium", expected_change: "Пометить выбранную campaign как deleted; операция необратима в интерфейсе сервера." };
    case "delete_test_ad_group": return { risk: "medium", expected_change: "Пометить test ad group как deleted; операция необратима в интерфейсе сервера." };
    case "delete_test_segment": return { risk: "medium", expected_change: "Удалить выбранный сегмент; операция необратима." };
    case "add_test_segment_relation": return { risk: "low", expected_change: "Добавить связь только между двумя test-сегментами." };
    case "update_test_segment_relation": return { risk: "low", expected_change: "Изменить только params существующей связи между двумя test-сегментами." };
    case "delete_test_segment_relation": return { risk: "medium", expected_change: "Удалить связь только из test-сегмента." };
    case "upload_static_image": return { risk: "low", expected_change: "Загрузить статичное изображение в контент VK Ads; banner и показы не создаются." };
    case "upload_html5": return { risk: "low", expected_change: "Загрузить проверенный HTML5 ZIP-креатив в контент VK Ads; banner и показы не создаются." };
    case "upload_test_video": return { risk: "low", expected_change: "Загрузить MP4-видео в контент VK Ads; banner, показы и расход не создаются." };
    case "upload_lead_form_logo": return { risk: "low", expected_change: "Загрузить PNG/JPEG logo для лид-формы; сама форма, объявления, показы и расход не меняются." };
    case "create_test_offer_batch": return { risk: "low", expected_change: "Создать одну batch-задачу с synthetic offer в указанном прайс-листе; кампании и расход не меняются." };
    case "export_leads": return { risk: "medium", expected_change: "Получить экспорт лидов с персональными данными в памяти текущего MCP-сеанса; данные не попадут в audit." };
    case "export_survey_respondents": return { risk: "medium", expected_change: "Получить экспорт ответов опроса с персональными данными в памяти текущего MCP-сеанса; данные не попадут в audit." };
    case "upload_test_remarketing_user_list": return { risk: "medium", expected_change: "Загрузить новый список ремаркетинга из отдельно разрешённого PII-файла; содержимое не попадёт в ответ или audit." };
    case "upload_test_offline_goal": return { risk: "medium", expected_change: "Загрузить новый список офлайн-конверсий из отдельно разрешённого PII-файла; содержимое не попадёт в ответ или audit." };
    case "rename_test_remarketing_user_list": return { risk: "low", expected_change: "Переименовать существующий список ремаркетинга." };
    case "delete_test_remarketing_user_list": return { risk: "medium", expected_change: "Удалить неиспользуемый список ремаркетинга; операция необратима." };
    case "connect_agency_client": return { risk: "medium", expected_change: "Привязать существующий рекламный кабинет к агентству с полным доступом; операция меняет отношения кабинетов." };
    case "create_test_local_geo": return { risk: "low", expected_change: "Создать список локального гео." };
    case "update_test_local_geo": return { risk: "low", expected_change: "Изменить существующий список локального гео." };
    case "delete_test_local_geo": return { risk: "medium", expected_change: "Удалить неиспользуемый список локального гео; операция необратима." };
  }
}

async function captureWriteBefore(client: VkAdsClient, operation: WriteOperation, payload: Record<string, unknown>): Promise<VkObject | null> {
  switch (operation) {
    case "activate_configured_sharing_key": return { external_key_configured: true, activation_scope: "all_sources" };
    case "update_ad_plan":
    case "delete_ad_plan": return client.getAdPlan(payload.ad_plan_id as number);
    case "manage_ad_plans": return { items: await Promise.all((payload.items as VkObject[]).map((item) => client.getAdPlan(Number(item.id))) ) };
    case "create_campaign": return client.getAdPlan(payload.ad_plan_id as number);
    case "update_campaign":
    case "delete_campaign": return client.getCampaign(payload.campaign_id as number);
    case "create_ad_group": return client.getAdPlan(payload.ad_plan_id as number);
    case "update_ad_group":
    case "delete_ad_group": return client.getAdGroup(payload.ad_group_id as number);
    case "manage_ad_groups": return { items: await Promise.all((payload.items as VkObject[]).map((item) => client.getAdGroup(Number(item.id))) ) };
    case "create_banner": return client.getAdGroup(payload.ad_group_id as number);
    case "update_banner":
    case "delete_banner": return client.getBanner(payload.banner_id as number);
    case "manage_banners": return { items: await Promise.all((payload.items as VkObject[]).map((item) => client.getBanner(Number(item.id))) ) };
    case "delete_subscription": return subscriptionFromPages(client, payload.subscription_id as number);
    case "create_subscription": return { existing_subscriptions: (await client.listSubscriptions(0, 50)).count };
    case "refresh_apple_app_metadata": return publicMobileAppMetadata(await client.getAppleApp(payload.app_id as number));
    case "refresh_google_app_metadata": return publicMobileAppMetadata(await client.getGoogleApp(payload.package_name as string));
    case "update_manager_client":
    case "delete_manager_client": return findAgencyClient(await client.listManagerClients(), payload.client_id as number, payload.manager_id as number);
    case "update_agency_client":
    case "delete_agency_client": return findAgencyClient(await client.listAgencyClients(), payload.client_id as number);
    case "update_user_profile": return publicAccount(payload.api_version === "v3" ? await client.getUserV3() : await client.getUser());
    case "connect_existing_remarketing_counter": {
      const existing = await client.listRemarketingCounters();
      return { counter_already_connected: existing.some((item) => Number(item.id) === Number(payload.counter_id)) };
    }
    case "update_ord_partner_acts": return publicSensitiveMetadata(await client.getOrdPartnerActStatByPad(payload.month as string, payload.ord_pad_id as number)) as VkObject;
    case "update_ord_partner_pad": return publicSensitiveMetadata(await client.getOrdPartnerPad(payload.ord_pad_id as number)) as VkObject;
    case "update_ord_partner_subagent": return publicSensitiveMetadata(await client.getOrdPartnerSubagent(payload.id as number)) as VkObject;
    case "transfer_to_client": return publicAgencyClientMetadata(findAgencyClient(await client.listAgencyClients(), payload.client_id as number));
    case "create_test_ad_group": return client.getAdPlan(payload.ad_plan_id as number);
    case "create_test_campaign": return client.getAdPlan(payload.ad_plan_id as number);
    case "create_test_banner": return client.getAdGroup(payload.ad_group_id as number);
    case "create_test_pricelist": return { existing_pricelists: (await client.listPricelists(0, 50)).items.map(publicSensitiveMetadata) };
    case "copy_test_lead_form": return publicFormConfiguration(await client.getLeadFormDetail(payload.form_id as number));
    case "rename_test_lead_form": return publicFormConfiguration(await client.getLeadFormDetail(payload.form_id as number));
    case "rename_test_remarketing_counter":
    case "delete_test_remarketing_counter":
    case "delete_test_remarketing_counter_v2":
    case "create_test_counter_goal":
    case "update_test_counter_goal": return publicCounterMetadata(itemFromList(await client.listRemarketingCounters(), payload.counter_id as number, "Счётчик ремаркетинга"));
    case "delete_test_remarketing_user_list_v3": return publicSensitiveMetadata(await remarketingListFromPages(client, payload.list_id as number)) as VkObject;
    case "delete_test_offline_goal": return publicSensitiveMetadata((await client.listOfflineGoals()).find((item) => Number(item.id) === Number(payload.offline_goal_id))) as VkObject;
    case "update_test_offline_goal": return publicSensitiveMetadata((await client.listOfflineGoals()).find((item) => Number(item.id) === Number(payload.offline_goal_id))) as VkObject;
    case "upload_test_offline_goal": return { existing_offline_goals: (await client.listOfflineGoals()).map(publicSensitiveMetadata) };
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
    case "update_test_segment_relation":
    case "delete_test_segment_relation": return client.getSegment(payload.segment_id as number);
    case "rename_test_ad_plan":
    case "delete_test_ad_plan": return client.getAdPlan(payload.ad_plan_id as number);
    case "rename_test_campaign":
    case "delete_test_campaign":
    case "update_campaign_budget_limit_day": return client.getCampaign(payload.campaign_id as number);
    case "block_test_ad_plans": return { items: await Promise.all((payload.ad_plan_ids as number[]).map((id) => client.getAdPlan(id))) };
    case "block_test_ad_groups": return { items: await Promise.all((payload.ad_group_ids as number[]).map((id) => client.getAdGroup(id))) };
    case "block_test_banners": return { items: await Promise.all((payload.banner_ids as number[]).map((id) => client.getBanner(id))) };
    case "remoderate_test_banners": return { items: await Promise.all((payload.banner_ids as number[]).map((id) => client.getBanner(id))) };
    case "rename_test_ad_group":
    case "delete_test_ad_group": return client.getAdGroup(payload.ad_group_id as number);
    case "rename_test_banner": return client.getBanner(payload.banner_id as number);
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
  const groupReady = Number(group.package_id) === 2860;
  checks.push(groupReady
    ? { code: "ad_group", status: "pass", message: "Test ad group package_id=2860 подтверждена." }
    : { code: "ad_group", status: "fail", message: "Нужна существующая group с package_id=2860." });

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

/** Сегмент принимает именно Top.Mail.ru counter_id, а не внутренний ID источника VK Ads. */
async function preflightTestSegment(
  client: VkAdsClient,
  payload: Record<string, unknown>,
): Promise<{ ready: boolean; checks: Array<{ code: string; status: "pass" | "fail"; message: string }> }> {
  const counterId = payload.counter_id as number;
  const counter = (await client.listRemarketingCounters()).find((item) => Number(item.counter_id) === counterId);
  const found = counter !== undefined;
  const status = found ? String(counter.system_status ?? counter.status ?? "") : "";
  const active = found && (status === "" || status === "active");
  const goals = await client.getGoals();
  const topMailGoals = Array.isArray(goals.topmailru) ? goals.topmailru : [];
  const goalFound = topMailGoals.some((goal) => Number(goal.counter_id) === counterId && goal.goal === payload.goal_id);
  const checks = [
    { code: "counter_source_exists", status: found ? "pass" as const : "fail" as const, message: found ? "Счётчик найден среди источников, доступных текущему кабинету." : "counter_id не найден среди доступных источников ремаркетинга." },
    { code: "counter_source_active", status: active ? "pass" as const : "fail" as const, message: active ? "Счётчик активен для использования в сегменте." : "Счётчик недоступен или не активен для использования в сегменте." },
    { code: "counter_goal_exists", status: goalFound ? "pass" as const : "fail" as const, message: goalFound ? "goal_id подтверждён среди целей указанного счётчика." : "goal_id не найден среди доступных целей указанного счётчика." },
  ];
  return { ready: checks.every((check) => check.status === "pass"), checks };
}

async function captureWriteAfter(client: VkAdsClient, operation: WriteOperation, payload: Record<string, unknown>, result: VkObject): Promise<VkObject> {
  try {
    switch (operation) {
      case "recover_token_limit": return { reread: false, token_reissued: result.token_reissued === true, refresh_token_saved: result.refresh_token_saved === true, ...(typeof result.expires_at === "string" ? { expires_at: result.expires_at } : {}) };
      case "activate_configured_sharing_key": return { reread: false, activated: result.activated === true, reason: "Перечитывание не выполняется: список ключей содержит bearer-secret, а ответ активации может содержать внешние metadata." };
      case "create_url": return { reread: true, item: await client.getUrl(result.id as number) };
      case "create_ad_plan": return { reread: true, item: await client.getAdPlan(result.id as number) };
      case "update_ad_plan":
      case "delete_ad_plan": return { reread: true, item: await client.getAdPlan(payload.ad_plan_id as number) };
      case "manage_ad_plans": return { reread: true, items: await Promise.all((payload.items as VkObject[]).map((item) => client.getAdPlan(Number(item.id))) ) };
      case "create_campaign": return { reread: true, item: await client.getCampaign(result.id as number) };
      case "update_campaign":
      case "delete_campaign": return { reread: true, item: await client.getCampaign(payload.campaign_id as number) };
      case "create_ad_group": return { reread: true, item: await client.getAdGroup(result.id as number) };
      case "update_ad_group":
      case "delete_ad_group": return { reread: true, item: await client.getAdGroup(payload.ad_group_id as number) };
      case "manage_ad_groups": return { reread: true, items: await Promise.all((payload.items as VkObject[]).map((item) => client.getAdGroup(Number(item.id))) ) };
      case "create_banner": {
        const banners = await client.listBanners(0, 200, { adGroupId: payload.ad_group_id as number, fields: ["id", "name", "status", "ad_group_id", "content", "textblocks", "urls"] });
        const item = banners.items.find((banner) => Number(banner.id) === Number(result.id));
        return item ? { reread: true, item } : { reread: false, reason: "Созданный banner не найден при повторном чтении группы." };
      }
      case "update_banner":
      case "delete_banner": return { reread: true, item: await client.getBanner(payload.banner_id as number) };
      case "manage_banners": return { reread: true, items: await Promise.all((payload.items as VkObject[]).map((item) => client.getBanner(Number(item.id))) ) };
      case "delete_subscription": {
        try {
          await subscriptionFromPages(client, payload.subscription_id as number);
          return { reread: true, deleted: false, reason: "Подписка всё ещё найдена после DELETE." };
        } catch {
          return { reread: true, deleted: true };
        }
      }
      case "create_subscription": return { reread: true, item: subscriptionMetadata(await subscriptionFromPages(client, Number(result.id))) };
      case "refresh_apple_app_metadata": return { reread: true, item: publicMobileAppMetadata(await client.getAppleApp(payload.app_id as number)) };
      case "refresh_google_app_metadata": return { reread: true, item: publicMobileAppMetadata(await client.getGoogleApp(payload.package_name as string)) };
      case "update_manager_client": return { reread: true, item: findAgencyClient(await client.listManagerClients(), payload.client_id as number, payload.manager_id as number) };
      case "delete_manager_client": {
        const items = await client.listManagerClients();
        const found = items.some((item) => Number(item.client_id ?? item.user_id ?? item.id) === Number(payload.client_id) && Number(item.manager_id ?? (item.manager && typeof item.manager === "object" ? (item.manager as VkObject).id : undefined)) === Number(payload.manager_id));
        return { reread: true, deleted: !found };
      }
      case "update_agency_client": return { reread: true, item: findAgencyClient(await client.listAgencyClients(), payload.client_id as number) };
      case "update_user_profile": return { reread: true, item: publicAccount(payload.api_version === "v3" ? await client.getUserV3() : await client.getUser()) };
      case "delete_agency_client": {
        const found = (await client.listAgencyClients()).some((item) => Number(item.client_id ?? item.user_id ?? item.id) === Number(payload.client_id));
        return { reread: true, deleted: !found };
      }
      case "connect_existing_remarketing_counter": {
        const item = (await client.listRemarketingCounters()).find((counter) => Number(counter.id) === Number(payload.counter_id));
        return item ? { reread: true, item: publicCounterMetadata(item) } : { reread: false, reason: "Счётчик не найден при повторном чтении после подключения." };
      }
      case "update_ord_partner_acts": return { reread: true, item: publicSensitiveMetadata(await client.getOrdPartnerActStatByPad(payload.month as string, payload.ord_pad_id as number)) as VkObject };
      case "update_ord_partner_pad": return { reread: true, item: publicSensitiveMetadata(await client.getOrdPartnerPad(payload.ord_pad_id as number)) as VkObject };
      case "create_ord_partner_subagent": return { reread: true, item: publicSensitiveMetadata(await client.getOrdPartnerSubagent(result.id as number)) as VkObject };
      case "update_ord_partner_subagent": return { reread: true, item: publicSensitiveMetadata(await client.getOrdPartnerSubagent(payload.id as number)) as VkObject };
      case "transfer_to_client": return { reread: false, reason: "Финансовый ответ не перечитывается и не сохраняется в audit; возвращены только безопасные metadata операции." };
      case "create_test_ad_plan": return { reread: true, item: await client.getAdPlan(result.id as number) };
      case "create_test_campaign": return { reread: true, item: await client.getCampaign(result.id as number) };
      case "create_test_ad_group": return { reread: true, item: await client.getAdGroup(result.id as number) };
      case "create_test_banner": {
        const banners = await client.listBanners(0, 20, { adGroupId: payload.ad_group_id as number, fields: ["id", "name", "status", "ad_group_id", "content", "textblocks", "urls"] });
        const item = banners.items.find((banner) => Number(banner.id) === Number(result.id));
        return item ? { reread: true, item } : { reread: false, reason: "Созданный banner не найден при повторном чтении группы." };
      }
      case "create_test_segment": return { reread: true, item: await client.getSegment(result.id as number) };
      case "create_test_pricelist": return { reread: true, item: await pricelistFromPages(client, result.id as number) };
      case "copy_test_lead_form": return { reread: true, item: publicFormConfiguration(await client.getLeadFormDetail(result.id as number)) };
      case "rename_test_lead_form": return { reread: true, item: publicFormConfiguration(await client.getLeadFormDetail(payload.form_id as number)) };
      case "rename_test_remarketing_counter": return { reread: true, item: publicCounterMetadata(await client.getRemarketingCounter(payload.counter_id as number)) };
    case "delete_test_remarketing_counter": return { reread: false, reason: "Test-счётчик удалён; detail-чтение после удаления не выполняется." };
    case "delete_test_remarketing_counter_v2": return { reread: false, reason: "Test-счётчик удалён через v2; detail-чтение после удаления не выполняется." };
    case "create_test_counter_goal": return { reread: true, items: (await client.listRemarketingCounterGoals(payload.counter_id as number)).filter((item) => item.name === payload.name && item.substr === payload.substr).map(publicCounterMetadata) };
    case "delete_test_remarketing_user_list_v3": return { reread: false, reason: "Test-список удалён через v3; detail-чтение после удаления не выполняется." };
    case "delete_test_offline_goal": return { reread: false, reason: "Test-список офлайн-конверсий удалён; исходные записи не перечитываются." };
    case "update_test_offline_goal": return { reread: true, items: (await client.listOfflineGoals()).filter((item) => Number(item.id) === Number(payload.offline_goal_id)).map(publicSensitiveMetadata) };
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
      case "rename_test_campaign":
      case "delete_test_campaign":
      case "update_campaign_budget_limit_day": return { reread: true, item: await client.getCampaign(payload.campaign_id as number) };
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
      case "update_test_segment_relation":
      case "delete_test_segment_relation": return { reread: true, item: await client.getSegment(payload.segment_id as number) };
      case "create_test_async_report": return { reread: true, item: await client.getCustomReport(result.id as number) };
      case "delete_test_async_report": return { reread: false, reason: "Временный отчёт удалён; detail-чтение после удаления не выполняется." };
      case "upload_static_image": return { reread: false, reason: "Для static content не подтверждён безопасный GET endpoint; возвращён ответ upload.", content_id: result.id ?? null };
      case "upload_html5": return { reread: false, reason: "Для HTML5 content не подтверждён безопасный GET endpoint; возвращён ответ upload.", content_id: result.id ?? null };
      case "upload_test_video": return { reread: false, reason: "Для video content не подтверждён безопасный GET endpoint; возвращён ответ upload.", content_id: result.id ?? null };
      case "upload_lead_form_logo": return { reread: false, reason: "VK API не документирует безопасное чтение загруженного файла; возвращён только metadata upload.", image_id: result.id ?? null };
      case "create_test_offer_batch": return { reread: false, reason: "Batch API возвращает task metadata; detail-чтение доступно отдельным инструментом только для test-прайс-листа." };
      case "export_leads": return { reread: false, reason: "Экспорт лидов не сохраняется сервером и не попадает в audit." };
      case "export_survey_respondents": return { reread: false, reason: "Экспорт ответов опроса не сохраняется сервером и не попадает в audit." };
    case "upload_test_remarketing_user_list": {
      if (payload.api_version === "v3") {
        const id = Number(result.id);
        return { reread: true, items: (await client.listRemarketingUserLists(0, 50)).items.filter((item) => Number(item.id) === id).map(publicSensitiveMetadata) };
      }
      return { reread: false, reason: "Содержимое списка и его история не читаются после загрузки; возвращён ответ VK Ads без исходных записей." };
    }
    case "upload_test_offline_goal": return { reread: true, items: (await client.listOfflineGoals()).filter((item) => item.name === payload.name).map(publicSensitiveMetadata) };
      case "rename_test_remarketing_user_list": {
        if (payload.api_version === "v3") return { reread: true, items: (await client.listRemarketingUserLists(0, 50)).items.filter((item) => Number(item.id) === Number(payload.list_id)).map(remarketingListMetadata) };
        return { reread: true, item: remarketingListMetadata(await client.getRemarketingUserList(payload.list_id as number)) };
      }
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

/** App Store/Google Play могут вернуть текст и URL; для preview и reread оставляем лишь технические признаки приложения. */
function publicMobileAppMetadata(value: VkObject): VkObject {
  const allowed = ["id", "type", "category_id", "content_rating", "age_restrictions", "updated"];
  return Object.fromEntries(allowed.flatMap((key) => Object.hasOwn(value, key) ? [[key, value[key]]] : []));
}

/** Callback URL может быть закрытым адресом; в preview и reread подписки не возвращаем его. */
function subscriptionMetadata(value: VkObject): VkObject {
  const allowed = ["id", "resource", "created", "updated", "status"];
  return Object.fromEntries(allowed.flatMap((key) => Object.hasOwn(value, key) ? [[key, value[key]]] : []));
}

/** Финансовые списки могут содержать receipt, description и client metadata. Они не входят в MCP-выход. */
function publicTransactionGroup(value: VkObject): VkObject {
  const allowed = ["id", "name", "amount", "tax_amount", "payments_total", "is_commercial", "type", "first_at", "last_at", "object_id", "object_type", "is_autopayment"];
  return Object.fromEntries(allowed.flatMap((key) => Object.hasOwn(value, key) ? [[key, value[key]]] : []));
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
    case "vk_get_user": {
      const { api_version } = z.object({ api_version: z.enum(["v2", "v3"]).default("v2") }).parse(args);
      return { account: publicAccount(api_version === "v3" ? await client.getUserV3() : await client.getUser()), api_version };
    }
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
      const { api_version, object_type, period, ids, date_from, date_to, metrics } = z.object(statisticsInputSchema).parse(args);
      const statistics = await client.getStatistics({
        apiVersion: api_version,
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
      const { offset, limit, api_version } = z.object({ ...pagingSchema, api_version: z.enum(["v2", "v3"]).default("v3") }).parse(args);
      const result = api_version === "v2"
        ? await client.listRemarketingUserListsV2(offset, limit)
        : await client.listRemarketingUserLists(offset, limit);
      return { ...normalizePaged(result), api_version, items: result.items.map(remarketingListMetadata) };
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
    case "analytics_compare_periods":
    case "analytics_rank_campaigns":
    case "analytics_find_inefficient_campaigns":
    case "analytics_recommendations":
    case "analytics_anomalies":
    case "analytics_delivery_issues":
      return runAnalyticsTool(toolName, args);
  }
}

export function createServer(client: VkAdsClient, mode: ServerMode, options: { communityClient?: VkCommunityClient; uploadDir?: string; piiUploadDir?: string; allowPiiUploads?: boolean; allowAgencyWrites?: boolean; allowProfileWrites?: boolean; allowSharingKeyRevoke?: boolean; externalSharingKey?: string; allowSkAdNetworkWrites?: boolean; allowInAppEventCategoryWrites?: boolean; allowRemarketingCounterWrites?: boolean; tokenRecovery?: { recover: () => Promise<{ token_reissued: true; refresh_token_saved: true; expires_at?: string }> }; connectionId?: string; profileName?: string; auditFile?: string; previewTtlMs?: number; requireWriteConfirmation?: boolean } = {}): McpServer {
  const normalizeTestWritePayload = (operation: WriteOperation, payload: Record<string, unknown>, _legacyUploadDir?: string) => normalizeTestWritePayloadCore(
    operation,
    payload,
    options.uploadDir,
    options.piiUploadDir,
    options.allowPiiUploads,
    options.allowAgencyWrites,
  );
  const server = new McpServer({ name: "vk-ads-mcp", version: "1.2.0" });
  const writeGate = new WriteGate(mode === "write", Date.now, randomUUID, options.auditFile, options.previewTtlMs, options.requireWriteConfirmation ?? true);
  const connectionId = options.connectionId ?? "default";
  const profileName = options.profileName ?? "default";
  /** Только content, загруженный этим MCP после локальной проверки размеров. */
  const uploadedImages = new Map<number, KnownStaticImage>();
  /** Secret хранится лишь до отзыва в памяти текущего процесса; handle не является ключом VK Ads. */
  const sessionSharingKeys = new Map<string, string>();

  const communityClient = options.communityClient ?? new VkCommunityClient({ tokenProvider: () => "", timeoutMs: 30_000 });
  const communityTypes = z.enum(["group", "page", "event"]);
  const communityCandidateSchema = z.object({ id: z.number().int().positive(), url: z.string().url(), name: z.string(), description: z.string(), type: z.string().nullable(), members_count: z.number().int().nonnegative().nullable(), verified: z.boolean(), retrieved_at: z.string(), risk_flags: z.array(z.string()), activity: z.object({ last_post_at: z.string().nullable(), posts_per_week: z.number().nullable(), posts_analyzed: z.number().int().nonnegative(), thematic_posts: z.number().int().nonnegative(), thematic_post_share: z.number().min(0).max(1).nullable(), term_matches: z.array(z.string()), risk_flags: z.array(z.string()) }).optional() });
  const scoringRulesSchema = z.object({
    terms: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    exclude_terms: z.array(z.string().trim().min(1).max(120)).max(50).default([]),
    weights: z.object({ name_term: z.number().finite().nonnegative().optional(), description_term: z.number().finite().nonnegative().optional(), post_term: z.number().finite().nonnegative().optional(), activity_fresh: z.number().finite().nonnegative().optional(), activity_low_penalty: z.number().finite().nonnegative().optional(), thematic_post_share: z.number().finite().nonnegative().optional(), members_range: z.number().finite().nonnegative().optional(), exclude_term_penalty: z.number().finite().nonnegative().optional() }).strict().refine((weights) => Object.values(weights).some((weight) => typeof weight === "number" && weight > 0), "Укажите хотя бы один положительный вес."),
    term_weights: z.record(z.string().trim().min(1).max(120), z.number().finite().positive()).default({}),
    per_match_weights: z.object({ name_term: z.number().finite().positive().optional(), description_term: z.number().finite().positive().optional(), post_term: z.number().finite().positive().optional() }).strict().default({}),
    activity_fresh_days: z.number().int().positive().max(3_650).default(30),
    min_posts_per_week: z.number().nonnegative().max(10_000).default(0),
    min_thematic_post_share: z.number().min(0).max(1).default(0),
    members_range: z.object({ min: z.number().int().nonnegative().optional(), max: z.number().int().nonnegative().optional() }).strict().optional(),
    min_score: z.number().finite().min(0).max(100).default(0),
  }).strict().superRefine((rules, context) => {
    if ((rules.weights.name_term || rules.weights.description_term || rules.weights.post_term) && !rules.terms.length) context.addIssue({ code: "custom", path: ["terms"], message: "Для весов совпадения укажите хотя бы один terms." });
    if (rules.members_range?.min !== undefined && rules.members_range.max !== undefined && rules.members_range.min > rules.members_range.max) context.addIssue({ code: "custom", path: ["members_range"], message: "min не может быть больше max." });
  });
  const clusterSchema = z.object({ name: z.string().trim().min(1).max(120), include_terms: z.array(z.string().trim().min(1).max(120)).max(50).default([]), exclude_terms: z.array(z.string().trim().min(1).max(120)).max(50).default([]), min_score: z.number().finite().min(0).max(100).default(0) }).strict();
  server.registerTool("vk_discover_communities", {
    title: "Найти публичные сообщества VK", description: "Только чтение: ищет через groups.search, дополняет metadata, удаляет дубли по ID и не запрашивает списки участников.",
    inputSchema: { keywords: z.array(z.string().trim().min(1).max(120)).min(1).max(20), include_terms: z.array(z.string().trim().min(1).max(120)).max(50).default([]), exclude_terms: z.array(z.string().trim().min(1).max(120)).max(50).default([]), country_id: z.number().int().positive().optional(), city_id: z.number().int().positive().optional(), community_types: z.array(communityTypes).max(3).optional(), min_members: z.number().int().nonnegative().optional(), max_members: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(500).default(100) },
    outputSchema: { items: z.array(communityCandidateSchema) }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async (input) => {
    if (input.min_members !== undefined && input.max_members !== undefined && input.min_members > input.max_members) throw new Error("min_members не может быть больше max_members.");
    const ids = new Set<number>();
    for (const keyword of input.keywords) for (const type of input.community_types?.length ? input.community_types : [undefined]) {
      for (const item of await communityClient.search(keyword, 0, Math.min(input.limit, 200), input.country_id, input.city_id, type as CommunityType | undefined)) ids.add(item.id);
    }
    const items = (await communityClient.getByIds([...ids])).map((item) => candidate(item)).filter((item) => includeCandidate(item, input.include_terms, input.exclude_terms, input.community_types, input.min_members, input.max_members)).slice(0, input.limit);
    return textAndData({ items }, "Публичные сообщества найдены; данные участников не запрашивались.");
  });
  server.registerTool("vk_analyze_communities", {
    title: "Проанализировать сообщества VK", description: "Только чтение: анализирует metadata и последние публичные записи; полные тексты публикаций не возвращаются и не сохраняются.",
    inputSchema: { community_ids: z.array(z.number().int().positive()).min(1).max(500), posts_limit: z.number().int().min(1).max(100).default(30), analysis_terms: z.array(z.string().trim().min(1).max(120)).max(50).default([]), exclude_terms: z.array(z.string().trim().min(1).max(120)).max(50).default([]) }, outputSchema: { items: z.array(communityCandidateSchema) }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async (input) => {
    const metadata = await communityClient.getByIds([...new Set(input.community_ids)]); const items: Candidate[] = [];
    for (const item of metadata) { const result = candidate(item); if (!result.risk_flags.length) { try { result.activity = analyze(await communityClient.wall(item.id, input.posts_limit), input.analysis_terms, input.exclude_terms); result.risk_flags.push(...result.activity.risk_flags); } catch { result.risk_flags.push("posts_unavailable"); } } items.push(result); }
    return textAndData({ items }, "Сообщества проанализированы без сохранения текстов публикаций.");
  });
  server.registerTool("vk_score_communities", {
    title: "Оценить сообщества VK", description: "Только чтение: прозрачный локальный скоринг от 0 до 100 по пользовательским весам и кластерам.",
    inputSchema: { community_ids: z.array(z.number().int().positive()).min(1).max(500), scoring_rules: scoringRulesSchema, clusters: z.array(clusterSchema).max(50).default([]) }, outputSchema: { items: z.array(z.record(z.string(), z.unknown())) }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async ({ community_ids, scoring_rules, clusters }) => {
    const terms = Array.isArray(scoring_rules.terms) ? scoring_rules.terms.filter((term): term is string => typeof term === "string") : [];
    const excludes = Array.isArray(scoring_rules.exclude_terms) ? scoring_rules.exclude_terms.filter((term): term is string => typeof term === "string") : [];
    const communities: Candidate[] = [];
    for (const item of await communityClient.getByIds([...new Set(community_ids)])) {
      const result = candidate(item);
      if (!result.risk_flags.length) { try { result.activity = analyze(await communityClient.wall(item.id, 30), terms, excludes); result.risk_flags.push(...result.activity.risk_flags); } catch { result.risk_flags.push("posts_unavailable"); } }
      communities.push(result);
    }
    return textAndData({ items: score(communities, scoring_rules, clusters) }, "Скоринг выполнен; причины начислений и штрафов включены.");
  });
  server.registerTool("vk_export_community_candidates", {
    title: "Экспортировать кандидатов сообществ VK", description: "Только чтение: формирует CSV или JSON в памяти и помечает каждого кандидата статусом pending_approval.",
    inputSchema: { communities: z.array(communityCandidateSchema).min(1).max(500), scores: z.array(z.object({ id: z.number().int().positive(), score: z.number(), clusters: z.array(z.string()), reasons: z.array(z.string()), risk_flags: z.array(z.string()) })).max(500).default([]), format: z.enum(["csv", "json"]) }, outputSchema: { format: z.enum(["csv", "json"]), content: z.string(), row_count: z.number().int() }, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  }, async ({ communities, scores, format }) => { const byId = new Map(scores.map((item) => [item.id, item])); const rows = communities.map((item) => { const scoreItem = byId.get(item.id); return { id: item.id, url: item.url, name: item.name, description: item.description, members_count: item.members_count, activity: item.activity?.last_post_at ?? null, score: scoreItem?.score ?? null, cluster: scoreItem?.clusters.join("|") ?? "", reasons: scoreItem?.reasons.join("|") ?? "", risk_flags: [...item.risk_flags, ...(scoreItem?.risk_flags ?? [])].join("|"), status: "pending_approval" }; }); const content = format === "json" ? JSON.stringify(rows) : toCsv(rows).content; return textAndData({ format, content, row_count: rows.length }, "Экспорт сформирован в памяти; запись в сегмент не запускается."); });

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
        catalog: { total: toolCatalog.length, executable: toolCatalog.filter(isExecutableTool).length },
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
    async ({ api_version, object_type, period, ids, date_from, date_to, metrics, format, include_total }) => {
      const statistics = await client.getStatistics({
        apiVersion: api_version,
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
    name: (typeof analyticsToolNames)[number],
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
    "analytics_account_audit",
    {
      title: "Аудит кабинета за период",
      description: "Read-only: получает ограниченную выборку ad plans и статистику за период; отдельно возвращает факты, корреляции и рекомендации без изменения VK Ads.",
      inputSchema: accountAuditInputSchema.shape,
      outputSchema: { period: z.record(z.string(), z.string()), scanned_ad_plans: z.number().int(), total_ad_plans: z.number().int(), data_complete: z.boolean(), limitation: z.string().nullable(), facts: z.record(z.string(), z.unknown()), correlations: z.array(z.unknown()), delivery_issues: z.array(z.unknown()), recommendations: z.array(z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (input) => textAndData(await buildAccountAudit(client, input), "Аудит кабинета выполнен; записи в VK Ads не производились."),
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
          name: z.string(), title: z.string(), category: z.string(), access: z.enum(["read", "write"]), status: z.enum(["planned", "implemented", "docs_verified", "live_read_verified", "live_write_verified"]),
        })),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ query, category, include_planned }) => {
      const items = searchCatalog(query, category).filter((tool) => include_planned || isExecutableTool(tool));
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

  server.registerTool(
    "self_diagnostic",
    {
      title: "Самодиагностика VK Ads MCP",
      description: "Read-only: проверяет доступность credential безопасным запросом и возвращает профиль, режим, лимит и состояние каталога без токенов и PII.",
      outputSchema: {
        authenticated: z.boolean(), profile: z.string(), connection_id: z.string(), mode: z.enum(["readonly", "write"]),
        rate_limit: z.string(), catalog: z.object({ total: z.number().int(), executable: z.number().int() }),
        account: z.object({ id: z.union([z.string(), z.number()]).nullable(), currency: z.string().nullable(), info_currency: z.string().nullable(), status: z.string().nullable(), timezone: z.string().nullable() }),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async () => textAndData({
      authenticated: true, profile: profileName, connection_id: connectionId, mode,
      rate_limit: "Один последовательный API-запрос в секунду на credential, включая параллельные процессы.",
      catalog: { total: toolCatalog.length, executable: toolCatalog.filter(isExecutableTool).length },
      account: publicAccount(await client.getUser()),
    }, "Самодиагностика выполнена."),
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
    "url_id_resolve_v1",
    {
      title: "Получить технический ID рекламной ссылки",
      description: "Read-only: GET v1 /urls?url=… для публичного HTTPS-адреса. Не создаёт URL и не выполняет запрос к самому адресу.",
      inputSchema: { url: z.string().min(1).max(2_048).url() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ url }) => textAndData({ item: publicUrlMetadata(await client.resolveUrlIdV1(validateAdvertisingDestination(url).url)) }, "Технический ID рекламной ссылки получен."),
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
      description: "Read-only: читает users list по ID через документированный v3 detail endpoint. Контакты, хеши, файлы и история намеренно не запрашиваются.",
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
  registerList("subscriptions_list", "Подписки", "Read-only: GET v3 /subscription.json; ресурс возвращает только v3-подписки, v2-подписки не затрагиваются.", client.listSubscriptions.bind(client));
  server.registerTool(
    "subscription_get",
    {
      title: "Получить подписку",
      description: "Read-only: находит только v3-подписку по ID в подтверждённых metadata-страницах GET v3 /subscription.json. Не создаёт, не изменяет и не удаляет подписки v2 или v3.",
      inputSchema: { id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => textAndData({ item: await subscriptionFromPages(client, id) }, "Metadata подписки получены."),
  );
  server.registerTool(
    "transaction_groups_list",
    {
      title: "Группы транзакций",
      description: "Read-only: GET /billing/transaction_groups.json. Финансовые receipt, description и client metadata удаляются до MCP-ответа.",
      inputSchema: pagingSchema,
      outputSchema: { count: z.number().int().nonnegative(), offset: z.number().int().nonnegative(), items: z.array(z.record(z.string(), z.unknown())) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ offset, limit }) => {
      const page = await client.listTransactionGroups(offset, limit);
      return textAndData({ count: page.count, offset: page.offset, items: page.items.map(publicTransactionGroup) }, "Группы транзакций получены; финансовые реквизиты отфильтрованы.");
    },
  );
  server.registerTool(
    "transaction_group_get",
    {
      title: "Получить группу транзакций",
      description: "Read-only: находит группу транзакций по ID в подтверждённых страницах GET /billing/transaction_groups.json. Не читает транзакции, баланс и не выполняет денежных операций.",
      inputSchema: { id: z.number().int().positive() },
      outputSchema: { item: z.record(z.string(), z.unknown()) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => textAndData({ item: publicTransactionGroup(await transactionGroupFromPages(client, id)) }, "Группа транзакций получена; финансовые реквизиты отфильтрованы."),
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
      description: "Показывает режим и границы операций записи.",
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
          ? "Доступны production ad plan/campaign/ad group/banner операции через фиксированные схемы, preflight, preview, одноразовое точное подтверждение, redacted audit и reread. PII, финансовые, агентские, sharing-key, SKAdNetwork, in-app и counter операции сохраняют отдельные opt-in/ограничения."
          : "Сервер запущен в readonly: write-инструменты не зарегистрированы.",
      },
      "Статус write-возможностей получен.",
    ),
  );

  if (mode === "write") {
    const previewOutputSchema = {
      id: z.string().uuid(),
      operation: writeOperationSchema,
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
    const prepareWritePreview = async (operation: WriteOperation, payload: Record<string, unknown>) => {
      if (unindexedWriteOperations.has(operation)) {
        throw new Error("Операция отключена: её endpoint отсутствует в текущем официальном индексе VK Ads API. Нужен первичный опубликованный контракт.");
      }
      const normalized = normalizeTestWritePayload(operation, payload, options.uploadDir);
      if (operation === "recover_token_limit" && !options.tokenRecovery) {
        throw new Error("Восстановление токенов недоступно: сервер запущен без локальных VK_ADS_CLIENT_ID и VK_ADS_CLIENT_SECRET.");
      }
      if (operation === "activate_configured_sharing_key" && !options.externalSharingKey) {
        throw new Error("Активация внешнего ключа недоступна: укажите VK_ADS_EXTERNAL_SHARING_KEY только в локальном .env и перезапустите MCP.");
      }
      const before = await captureWriteBefore(client, operation, normalized);
      let preflight: WritePreflightResult | { ready: boolean; checks: Array<{ code: string; status: "pass" | "fail"; message: string }> } | undefined;
      if (operation === "create_test_ad_plan") {
        preflight = await preflightTestAdPlan(client, normalized);
      } else if (operation === "create_test_segment") {
        preflight = await preflightTestSegment(client, normalized);
      } else if (operation === "create_test_campaign") {
        preflight = await preflightTestAdGroup(client, normalized, before);
      } else if (operation === "create_test_ad_group") {
        preflight = await preflightTestAdGroup(client, normalized, before);
      } else if (operation === "create_test_banner") {
        preflight = await preflightConfirmedTestBanner(client, normalized, uploadedImages, before);
      } else if (operation === "connect_existing_remarketing_counter") {
        const alreadyConnected = before?.counter_already_connected === true;
        preflight = {
          ready: !alreadyConnected,
          checks: [{
            code: "counter_not_connected",
            status: alreadyConnected ? "fail" : "pass",
            message: alreadyConnected ? "Счётчик уже подключён к текущему кабинету; повторная запись заблокирована." : "Счётчик не найден среди уже подключённых к текущему кабинету.",
          }],
        };
      } else if (["create_ad_plan", "create_campaign", "update_campaign", "delete_campaign", "create_ad_group", "update_ad_group", "delete_ad_group", "create_banner", "update_banner", "delete_banner", "update_ad_plan", "delete_ad_plan", "manage_ad_plans", "manage_ad_groups", "manage_banners", "delete_subscription", "create_subscription", "refresh_apple_app_metadata", "refresh_google_app_metadata", "update_agency_client", "delete_agency_client", "update_user_profile", "update_manager_client", "delete_manager_client", "update_ord_partner_acts", "update_ord_partner_pad", "create_ord_partner_subagent", "update_ord_partner_subagent", "transfer_to_client"].includes(operation)) {
        const existing = operation.startsWith("create_") || operation === "manage_ad_plans" || operation === "manage_ad_groups" || operation === "manage_banners" ? true : before !== null;
        preflight = {
          ready: existing,
          checks: [{
            code: "existing_objects",
            status: existing ? "pass" : "fail",
            message: existing ? "Все target objects перечитаны перед production write." : "Target object не найден при preflight.",
          }],
        };
      } else if (operation === "share_test_skadnetwork_ids" || operation === "withdraw_test_skadnetwork_ids") {
        preflight = await preflightSkAdNetwork(client, operation, normalized);
      } else if (operation === "update_test_inapp_event_category") {
        preflight = await preflightInAppEventCategory(client, normalized);
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
      operation: WriteOperation,
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

    registerWritePreviewAlias(
      "vk_recover_token_limit",
      "Подготовить восстановление лимита токенов",
      "Удалит все токены текущей связки clientId--user в VK Ads и выпустит один новый с refresh_token. Операция не затрагивает рекламные сущности, но отзовёт доступ у других локальных процессов с тем же приложением и пользователем.",
      "recover_token_limit",
      {},
    );

    registerWritePreviewAlias(
      "subscription_delete",
      "Подготовить удаление подписки",
      "Удаляет только v3-подписку через опубликованный DELETE /api/v3/subscription/{id}.json. Перед выполнением она должна быть найдена свежим v3 list-запросом; операция высокорисковая и не затрагивает кампании.",
      "delete_subscription",
      { subscription_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "subscription_create",
      "Подготовить создание подписки",
      "Создаёт одну v3-подписку на BANNER, CAMPAIGN или OKLEADAD и отправляет уведомления только на проверенный public HTTPS callback URL.",
      "create_subscription",
      { resource: z.enum(["BANNER", "CAMPAIGN", "OKLEADAD"]), callback_url: z.string().url().max(2_048) },
    );
    registerWritePreviewAlias(
      "apple_app_metadata_refresh",
      "Подготовить обновление metadata iOS-приложения",
      "Перечитывает справочные metadata указанного App Store ID через документированный POST. Рекламные сущности и бюджеты не затрагиваются.",
      "refresh_apple_app_metadata",
      { app_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "google_app_metadata_refresh",
      "Подготовить обновление metadata Android-приложения",
      "Перечитывает справочные metadata указанного Google Play package name через документированный POST. Рекламные сущности и бюджеты не затрагиваются.",
      "refresh_google_app_metadata",
      { package_name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/) },
    );
    registerWritePreviewAlias(
      "user_profile_update",
      "Подготовить изменение профиля VK Ads",
      "Изменяет только фиксированные настройки текущего профиля v2/v3. Нужен VK_ADS_ALLOW_PROFILE_WRITES=1; PII не сохраняются в audit.",
      "update_user_profile",
      { api_version: z.enum(["v2", "v3"]), info_currency: z.string().regex(/^[A-Z]{3}$/).optional(), language: z.enum(["ru", "en"]).optional(), status: z.enum(["active", "blocked", "deleted"]).optional(), additional_emails: z.array(z.string().email().max(254)).min(1).max(10).optional(), additional_info: z.object({ name: z.string().min(1).max(255).optional(), phone: z.string().min(3).max(32).optional() }).strict().optional(), mailing: z.array(z.enum(["finance", "moderation"])).min(1).max(2).optional(), mailings: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), z.object({ email: z.array(z.string().email().max(254)).max(10) }).strict()).refine((value) => { const size = Object.keys(value).length; return size >= 1 && size <= 50; }, "Укажите от 1 до 50 типов рассылки.").optional(), email_settings: z.array(z.object({ type: z.enum(["USER", "PARENT", "ADDITIONAL"]), email: z.string().email().max(254) }).strict()).min(1).max(10).optional() },
    );
    registerWritePreviewAlias(
      "remarketing_counter_connect_existing",
      "Подготовить подключение существующего счётчика ремаркетинга",
      "Подключает только уже существующий счётчик Top.Mail.ru без пароля и URL. Нужен VK_ADS_ALLOW_REMARKETING_COUNTER_WRITES=1; повторное подключение блокируется fresh preflight.",
      "connect_existing_remarketing_counter",
      { counter_id: z.number().int().positive(), name: z.string().min(1).max(120), flags: z.array(z.literal("cookie_sync")).max(1).optional() },
    );
    registerWritePreviewAlias(
      "agency_client_update",
      "Подготовить изменение связи agency-client",
      "Изменяет только документированные параметры уже привязанного клиента агентства. Нужен VK_ADS_ALLOW_AGENCY_WRITES=1; контактные поля не сохраняются в audit.",
      "update_agency_client",
      { client_id: z.number().int().positive(), is_vkads: z.boolean().optional(), access_type: z.literal("full_access").optional(), additional_emails: z.array(z.string().email().max(254)).min(1).max(10).optional(), additional_info: z.object({ client_name: z.string().min(1).max(255).optional(), client_info: z.string().min(1).max(1_000).optional() }).strict().optional() },
    );
    registerWritePreviewAlias(
      "agency_client_delete",
      "Подготовить удаление связи agency-client",
      "Удаляет только связь клиента с агентством через официальный DELETE; рекламный кабинет, кампании, бюджеты и аудитории не удаляются. Нужен VK_ADS_ALLOW_AGENCY_WRITES=1.",
      "delete_agency_client",
      { client_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "manager_client_update",
      "Подготовить изменение связи manager-client",
      "Изменяет access_type через официальный POST; доступно только при VK_ADS_ALLOW_AGENCY_WRITES=1.",
      "update_manager_client",
      { manager_id: z.number().int().positive(), client_id: z.number().int().positive(), access_type: z.enum(["full_access", "readonly", "fin_readonly", "ads_readonly"]) },
    );
    registerWritePreviewAlias(
      "manager_client_delete",
      "Подготовить удаление связи manager-client",
      "Удаляет связь клиента с менеджером через официальный DELETE; аккаунт клиента не удаляется. Нужен VK_ADS_ALLOW_AGENCY_WRITES=1.",
      "delete_manager_client",
      { manager_id: z.number().int().positive(), client_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "ord_partner_acts_update",
      "Подготовить изменение актов ОРД",
      "Изменяет цепочку актов по документированной v1-схеме. Нужен VK_ADS_ALLOW_ORD_WRITES=1; юридические и контактные поля не попадают в audit.",
      "update_ord_partner_acts",
      { month: z.string().regex(/^\d{4}-\d{2}-01$/), ord_pad_id: z.number().int().positive(), acts: z.array(ordActItemSchema).min(1).max(200) },
    );
    registerWritePreviewAlias(
      "ord_partner_pad_update",
      "Подготовить изменение площадки ОРД",
      "Изменяет name или договорную цепочку площадки. Нужен VK_ADS_ALLOW_ORD_WRITES=1.",
      "update_ord_partner_pad",
      { ord_pad_id: z.number().int().positive(), name: z.string().min(1).max(255).optional(), contracts: z.array(ordContractUpdateSchema).min(1).max(200).optional() },
    );
    registerWritePreviewAlias(
      "ord_partner_subagent_create",
      "Подготовить создание контрагента ОРД",
      "Создаёт контрагента по фиксированной официальной схеме. Нужен VK_ADS_ALLOW_ORD_WRITES=1; PII и реквизиты не сохраняются в audit.",
      "create_ord_partner_subagent",
      { user_type: ordSubagentFieldsSchema.shape.user_type, role: ordSubagentFieldsSchema.shape.role, name: ordSubagentFieldsSchema.shape.name, inn: ordSubagentFieldsSchema.shape.inn, site: ordSubagentFieldsSchema.shape.site, phone: ordSubagentFieldsSchema.shape.phone, foreign_epayment_method: ordSubagentFieldsSchema.shape.foreign_epayment_method, foreign_oksm_country_code: ordSubagentFieldsSchema.shape.foreign_oksm_country_code, foreign_registration_number: ordSubagentFieldsSchema.shape.foreign_registration_number },
    );
    registerWritePreviewAlias(
      "ord_partner_subagent_update",
      "Подготовить изменение контрагента ОРД",
      "Изменяет только перечисленные поля контрагента. Нужен VK_ADS_ALLOW_ORD_WRITES=1.",
      "update_ord_partner_subagent",
      { id: z.number().int().positive(), user_type: ordSubagentFieldsSchema.shape.user_type.optional(), role: ordSubagentFieldsSchema.shape.role.optional(), name: ordSubagentFieldsSchema.shape.name.optional(), inn: ordSubagentFieldsSchema.shape.inn, site: ordSubagentFieldsSchema.shape.site, phone: ordSubagentFieldsSchema.shape.phone, foreign_epayment_method: ordSubagentFieldsSchema.shape.foreign_epayment_method, foreign_oksm_country_code: ordSubagentFieldsSchema.shape.foreign_oksm_country_code, foreign_registration_number: ordSubagentFieldsSchema.shape.foreign_registration_number },
    );
    registerWritePreviewAlias(
      "billing_transfer_to_client",
      "Подготовить финансовый перевод клиенту",
      "Перевод средств агентству запрещён по умолчанию и требует VK_ADS_ALLOW_FINANCIAL_WRITES=1. Payload и ответ с балансами не сохраняются в audit.",
      "transfer_to_client",
      { client_id: z.number().int().positive(), amount: z.string().regex(/^\d+(?:\.\d{1,2})?$/) },
    );

    server.registerTool(
      "write_preview",
      {
        title: "Подготовить подтверждение записи",
        description: "Готовит одноразовый preview с hash payload для HTTPS URL, объектов кабинета, static image или MP4-видео из VK_ADS_UPLOAD_DIR.",
        inputSchema: {
          operation: writeOperationSchema,
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
      "vk_create_ad_plan", "Подготовить создание ad plan", "Создаёт ad plan с фиксированной схемой VK Ads. По умолчанию статус blocked; production ID разрешён только через preview и одноразовое подтверждение.", "create_ad_plan",
      { name: z.string().min(1).max(120), objective: z.string().min(1).max(80), status: productionStatusSchema.optional(), date_start: productionDateSchema.optional(), date_end: productionDateSchema.optional(), autobidding_mode: z.string().min(1).max(80).optional(), budget_limit_day: productionMoneySchema.optional(), budget_limit: productionMoneySchema.optional(), enable_utm: z.boolean().optional(), enable_offline_goals: z.boolean().optional(), ad_groups: productionAdPlanFieldsSchema.shape.ad_groups },
    );
    registerWritePreviewAlias(
      "vk_create_campaign", "Подготовить создание campaign", "Создаёт campaign с документированными полями в существующем ad plan; по умолчанию blocked.", "create_campaign",
      { ad_plan_id: z.number().int().positive(), package_id: z.number().int().positive(), objective: z.string().min(1).max(80), name: z.string().min(1).max(120), status: productionStatusSchema.optional(), date_start: productionDateSchema.optional(), date_end: productionDateSchema.optional(), budget_limit_day: productionMoneySchema.optional(), budget_limit: productionMoneySchema.optional(), autobidding_mode: z.string().min(1).max(80).optional() },
    );
    registerWritePreviewAlias(
      "lead_form_copy", "Подготовить копирование лид-формы", "Копирует существующую форму с указанным именем. Контакты и ответы не читаются.", "copy_test_lead_form",
      { form_id: z.number().int().positive(), name: z.string().min(1).max(120) },
    );
    registerWritePreviewAlias(
      "vk_update_lead_form", "Подготовить переименование лид-формы", "Изменяет имя существующей лид-формы. Контактные поля, страницы, согласия и уведомления не передаются в API и не изменяются.", "rename_test_lead_form",
      { form_id: z.number().int().positive(), name: z.string().min(1).max(120) },
    );
    registerWritePreviewAlias(
      "vk_update_inapp_event_category", "Подготовить изменение категории in-app события", "Проверяет доступность события и category_id перед записью.", "update_test_inapp_event_category",
      { app_id: z.number().int().positive(), tracker_id: z.number().int().positive(), event_id: z.number().int().positive(), category_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "lead_form_test_lead_send", "Подготовить отправку тестового лида", "Отправляет служебный тестовый лид в существующую форму. Контактные данные и ответы не принимаются.", "send_test_lead",
      { form_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "sharing_key_create", "Подготовить создание ключа шаринга", "Источник — существующий сегмент. Ключ отправляется указанному получателю средствами VK Ads и не попадает в MCP-ответ или audit.", "create_test_sharing_key",
      { segment_id: z.number().int().positive(), recipient: z.string().trim().min(3).max(254) },
    );
    registerWritePreviewAlias(
      "sharing_key_revoke", "Подготовить отзыв ключа шаринга", "Отзывает только ключ, созданный текущим MCP-сеансом. Нужен отдельный opt-in при запуске: отзыв способен остановить кампании получателя.", "revoke_created_sharing_key",
      { key_handle: z.string().uuid() },
    );
    registerWritePreviewAlias(
      "sharing_key_activate_configured", "Подготовить активацию внешнего ключа", "Активирует все источники только из bearer-key, уже сохранённого локально как VK_ADS_EXTERNAL_SHARING_KEY. Ключ не передаётся через MCP, не показывается и не попадает в audit.", "activate_configured_sharing_key",
      {},
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
      "survey_form_copy", "Подготовить копирование опроса", "Копирует существующий опрос с указанным именем. Ответы респондентов не читаются.", "copy_test_survey_form",
      { form_id: z.number().int().positive(), name: z.string().min(1).max(120) },
    );
    server.registerTool(
      "lead_forms_archive_manage",
      {
        title: "Подготовить archive/unarchive test-лид-форм",
        description: "Разрешает archive или unarchive от 1 до 50 форм после одноразового подтверждения.",
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
        description: "Разрешает archive или unarchive от 1 до 50 форм после одноразового подтверждения.",
        inputSchema: { action: z.enum(["archive", "unarchive"]), form_ids: z.array(z.number().int().positive()).min(1).max(50) },
        outputSchema: previewOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      },
      async ({ action, form_ids }) => prepareWritePreview("manage_test_survey_forms_archive", { action, form_ids }),
    );
    registerWritePreviewAlias(
      "vk_update_ad_plan", "Подготовить изменение ad plan", "Изменяет только перечисленные документированные поля существующего ad plan.", "update_ad_plan",
      { ad_plan_id: z.number().int().positive(), name: z.string().min(1).max(120).optional(), status: productionStatusSchema.optional(), date_start: productionDateSchema.optional(), date_end: productionDateSchema.optional(), autobidding_mode: z.string().min(1).max(80).optional(), budget_limit_day: productionMoneySchema.optional(), budget_limit: productionMoneySchema.optional(), enable_utm: z.boolean().optional(), enable_offline_goals: z.boolean().optional(), objective: z.string().min(1).max(80).optional() },
    );
    server.registerTool(
      "vk_update_campaign",
      {
        title: "Подготовить изменение кампании",
        description: "Изменяет название или `budget_limit_day` существующей кампании. Запись выполняется только через preview и одноразовое подтверждение.",
        inputSchema: {
          campaign_id: z.number().int().positive(),
          name: z.string().min(1).max(120).optional(),
          budget_limit_day: z.number().finite().positive().optional(),
        },
        outputSchema: previewOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
      },
      async ({ campaign_id, name, budget_limit_day }) => {
        if ((name === undefined) === (budget_limit_day === undefined)) {
          throw new Error("Укажите ровно одно поле: name или budget_limit_day.");
        }
        return prepareWritePreview("update_campaign", { campaign_id, ...(name === undefined ? { budget_limit_day } : { name }) });
      },
    );
    registerWritePreviewAlias(
      "vk_delete_ad_plan", "Подготовить удаление ad plan", "Переводит выбранный ad plan в status=deleted после reread и подтверждения.", "delete_ad_plan",
      { ad_plan_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "vk_manage_campaigns", "Подготовить массовое изменение ad plans", "Массово изменяет status, budget_limit_day, dates или max_price для перечисленных ad plans по официальной AdPlanMassAction schema.", "manage_ad_plans",
      { items: z.array(productionAdPlanMassItemSchema).min(1).max(200) },
    );
    registerWritePreviewAlias(
      "vk_create_ad_group", "Подготовить создание ad group", "Создаёт ad group с фиксированными полями budget, bid, status, dates и targetings.", "create_ad_group",
      { ad_plan_id: z.number().int().positive(), package_id: z.number().int().positive(), name: z.string().min(1).max(120), targetings: productionTargetingsSchema, status: productionStatusSchema.optional(), objective: z.string().min(1).max(80).optional(), date_start: productionDateSchema.optional(), date_end: productionDateSchema.optional(), autobidding_mode: z.string().min(1).max(80).optional(), budget_limit_day: productionMoneySchema.optional(), budget_limit: productionMoneySchema.optional(), mixing: z.string().min(1).max(80).optional(), price: productionMoneySchema.optional(), max_price: productionMoneySchema.optional(), age_restrictions: z.string().max(80).optional(), enable_utm: z.boolean().optional(), enable_offline_goals: z.boolean().optional() },
    );
    registerWritePreviewAlias(
      "vk_update_ad_group", "Подготовить изменение ad group", "Изменяет только перечисленные документированные поля production ad group, включая ставки, бюджет и targetings.", "update_ad_group",
      { ad_group_id: z.number().int().positive(), name: z.string().min(1).max(120).optional(), status: productionStatusSchema.optional(), date_start: productionDateSchema.optional(), date_end: productionDateSchema.optional(), autobidding_mode: z.string().min(1).max(80).optional(), budget_limit_day: productionMoneySchema.optional(), budget_limit: productionMoneySchema.optional(), mixing: z.string().min(1).max(80).optional(), price: productionMoneySchema.optional(), max_price: productionMoneySchema.optional(), targetings: productionTargetingsSchema.optional(), enable_utm: z.boolean().optional(), enable_offline_goals: z.boolean().optional() },
    );
    registerWritePreviewAlias(
      "vk_update_banner", "Подготовить изменение banner", "Изменяет только перечисленные content, textblocks, URLs, name или status существующего banner.", "update_banner",
      { banner_id: z.number().int().positive(), name: z.string().min(1).max(120).optional(), status: productionStatusSchema.optional(), content: productionBannerFieldsSchema.shape.content, textblocks: productionBannerFieldsSchema.shape.textblocks, urls: productionBannerFieldsSchema.shape.urls },
    );
    registerWritePreviewAlias(
      "vk_delete_banner", "Подготовить удаление banner", "Удаляет выбранный banner через опубликованный HTTP DELETE после reread и подтверждения.", "delete_banner",
      { banner_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "vk_update_remarketing_counter", "Подготовить переименование счётчика", "Изменяет имя счётчика, доступного текущему credential; URL, учётные данные и flags не передаются.", "rename_test_remarketing_counter",
      { counter_id: z.number().int().positive(), name: z.string().trim().min(1).max(120) },
    );
    registerWritePreviewAlias(
      "vk_delete_remarketing_counter", "Подготовить удаление счётчика", "Удаляет счётчик, доступный текущему credential; операция необратима.", "delete_test_remarketing_counter",
      { counter_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "vk_delete_remarketing_counter_v2", "Подготовить v2-удаление счётчика", "Удаляет счётчик, доступный текущему credential, через документированный v2 DELETE; не заменяет legacy v1-операцию.", "delete_test_remarketing_counter_v2",
      { counter_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "offline_goal_delete", "Подготовить удаление списка офлайн-конверсий", "Удаляет указанный список офлайн-конверсий. Исходные записи и PII не читаются.", "delete_test_offline_goal",
      { offline_goal_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "offline_goal_update", "Подготовить обновление списка офлайн-конверсий", "Переименовывает и/или дозагружает указанный список. Файл принимается лишь из VK_ADS_PII_UPLOAD_DIR при VK_ADS_ALLOW_PII_UPLOADS=1; контакты не читаются и не логируются.", "update_test_offline_goal",
      { offline_goal_id: z.number().int().positive(), name: z.string().min(1).max(120), file_path: z.string().min(1).max(1_024).optional() },
    );
    registerWritePreviewAlias(
      "vk_create_counter_goal", "Подготовить создание цели счётчика", "Создаёт цель в счётчике, доступном текущему credential; перед записью счётчик перечитывается.", "create_test_counter_goal",
      { counter_id: z.number().int().positive(), name: z.string().trim().min(1).max(120), substr: z.string().trim().min(1).max(2_000), condition: z.enum(["uss", "rss", "jse", "hd", "ts"]), goal_type: z.enum(["content", "search", "basket", "wishlist", "checkout", "payment_info", "purchase", "lead", "registration", "custom"]), value: z.number().int().min(-2_147_483_647).max(2_147_483_647).nullable().optional() },
    );
    registerWritePreviewAlias(
      "vk_update_counter_goal", "Подготовить изменение цели счётчика", "Изменяет существующую цель в счётчике, доступном текущему credential; доступны документированные name, value и goal_type.", "update_test_counter_goal",
      { counter_id: z.number().int().positive(), goal_id: z.number().int().positive(), name: z.string().trim().min(1).max(120), value: z.number().int().min(-2_147_483_647).max(2_147_483_647), goal_type: z.enum(["content", "search", "basket", "wishlist", "checkout", "payment_info", "purchase", "lead", "registration", "custom"]) },
    );
    registerWritePreviewAlias(
      "vk_delete_ad_group", "Подготовить удаление ad group", "Удаляет выбранную ad group через опубликованный HTTP DELETE после reread и подтверждения.", "delete_ad_group",
      { ad_group_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "vk_manage_ad_groups", "Подготовить массовое изменение ad groups", "Массово изменяет status или max_price для перечисленных ad groups по официальной AdGroupMassAction schema.", "manage_ad_groups",
      { items: z.array(productionAdGroupMassItemSchema).min(1).max(200) },
    );
    registerWritePreviewAlias(
      "vk_manage_banners", "Подготовить массовое изменение banners", "Массово изменяет status для перечисленных banners по официальной BannerMassAction schema.", "manage_banners",
      { items: z.array(productionBannerMassItemSchema).min(1).max(200) },
    );
    registerWritePreviewAlias(
      "vk_remoderate_banners", "Подготовить повторную модерацию banner", "Перед отправкой VK Ads обязан вернуть для каждого banner user_can_request_remoderation=true. Иначе write-запрос не уйдёт.", "remoderate_test_banners",
      { banner_ids: z.array(z.number().int().positive()).min(1).max(200) },
    );
    registerWritePreviewAlias(
      "vk_create_banner", "Подготовить создание banner", "Создаёт banner с фиксированными content, textblocks и URLs в существующей ad group; по умолчанию blocked.", "create_banner",
      { ad_group_id: z.number().int().positive(), name: z.string().min(1).max(120), status: productionStatusSchema.optional(), content: productionBannerFieldsSchema.shape.content.unwrap(), textblocks: productionBannerFieldsSchema.shape.textblocks.unwrap(), urls: productionBannerFieldsSchema.shape.urls.unwrap() },
    );
    registerWritePreviewAlias(
      "vk_create_segment", "Подготовить создание сегмента", "Создаёт сегмент. Указанный счётчик используется только как источник: сам он не изменяется.", "create_test_segment",
      { name: z.string().min(1).max(120), counter_id: z.number().int().positive(), left_days: z.number().int().min(1).max(365).default(365), goal_id: z.string().min(1).max(120) },
    );
    registerWritePreviewAlias(
      "vk_create_pricelist", "Подготовить создание прайс-листа", "Создаёт пустой каталог с source_type=api и status=blocked. URL, фид, товары и credentials не передаются.", "create_test_pricelist",
      { name: z.string().min(1).max(120) },
    );
    registerWritePreviewAlias(
      "vk_update_segment", "Подготовить переименование сегмента", "Переименовывает существующий сегмент.", "rename_test_segment",
      { segment_id: z.number().int().positive(), name: z.string().min(1).max(120) },
    );
    registerWritePreviewAlias(
      "vk_delete_segment", "Подготовить удаление сегмента", "Удаляет указанный сегмент, не привязанный к кампаниям.", "delete_test_segment",
      { segment_id: z.number().int().positive() },
    );
    server.registerTool(
      "vk_manage_segment_relations",
      {
        title: "Подготовить изменение связи сегментов",
        description: "Добавляет, изменяет или удаляет связь в указанном сегменте после одноразового подтверждения.",
        inputSchema: {
          action: z.enum(["add", "update", "delete"]),
          segment_id: z.number().int().positive(),
          nested_segment_id: z.number().int().positive().optional(),
          relation_id: z.number().int().positive().optional(),
          left: z.number().int().min(1).max(365).optional(),
          right: z.number().int().min(0).max(364).optional(),
          type: z.enum(["positive", "negative"]).optional(),
        },
        outputSchema: previewOutputSchema,
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
      },
      async (payload) => {
        if (payload.action === "add") {
          if (!payload.nested_segment_id) throw new Error("Для добавления связи укажите nested_segment_id.");
          return prepareWritePreview("add_test_segment_relation", { segment_id: payload.segment_id, nested_segment_id: payload.nested_segment_id });
        }
        if (payload.action === "update") {
          if (!payload.relation_id || payload.left === undefined || payload.right === undefined || !payload.type) throw new Error("Для изменения связи укажите relation_id, left, right и type.");
          return prepareWritePreview("update_test_segment_relation", { segment_id: payload.segment_id, relation_id: payload.relation_id, left: payload.left, right: payload.right, type: payload.type });
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
      "offer_batch_task_create", "Подготовить batch-задачу synthetic offer", "Создаёт один offer в указанном прайс-листе; URL и цена проходят строгую локальную проверку.", "create_test_offer_batch",
      { pricelist_id: z.number().int().positive(), offer_id: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/), product_type: z.string().regex(/^[A-Za-z0-9._ -]{1,100}$/), title: z.string().trim().min(1).max(150), link: z.string().url(), image_link: z.string().url(), price: z.string().regex(/^\d+(?:\.\d{1,2})? [A-Z]{3}$/) },
    );
    registerWritePreviewAlias(
      "vk_create_remarketing_list", "Подготовить загрузку списка ремаркетинга", "Принимается новый список из отдельного VK_ADS_PII_UPLOAD_DIR при VK_ADS_ALLOW_PII_UPLOADS=1. Содержимое контактов не читается и не логируется.", "upload_test_remarketing_user_list",
      { file_path: z.string().min(1).max(1_024), name: z.string().min(1).max(120), type: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/) },
    );
    registerWritePreviewAlias(
      "vk_create_remarketing_list_v3", "Подготовить v3-загрузку списка ремаркетинга", "Принимается новый список из VK_ADS_PII_UPLOAD_DIR при VK_ADS_ALLOW_PII_UPLOADS=1; v3 multipart не возвращает содержимое контактов.", "upload_test_remarketing_user_list",
      { file_path: z.string().min(1).max(1_024), name: z.string().min(1).max(120), type: z.string().regex(/^[a-z][a-z0-9_]{0,31}$/), api_version: z.literal("v3") },
    );
    registerWritePreviewAlias(
      "vk_create_offline_goal", "Подготовить загрузку списка офлайн-конверсий", "Принимается новый список из отдельного VK_ADS_PII_UPLOAD_DIR при VK_ADS_ALLOW_PII_UPLOADS=1. Контакты не читаются и не логируются.", "upload_test_offline_goal",
      { file_path: z.string().min(1).max(1_024), name: z.string().min(1).max(120), attribution_period: z.number().int().min(1).max(365), type: z.enum(["email", "hash_email", "phone", "hash_phone"]) },
    );
    registerWritePreviewAlias(
      "vk_update_remarketing_list", "Подготовить переименование списка ремаркетинга", "Переименовывает существующий список; состав аудитории не меняется.", "rename_test_remarketing_user_list",
      { list_id: z.number().int().positive(), name: z.string().min(1).max(120) },
    );
    registerWritePreviewAlias(
      "vk_update_remarketing_list_v3", "Подготовить v3-переименование списка", "Переименовывает существующий список через документированный v3 POST; состав аудитории не меняется.", "rename_test_remarketing_user_list",
      { list_id: z.number().int().positive(), name: z.string().min(1).max(120), api_version: z.literal("v3") },
    );
    registerWritePreviewAlias(
      "vk_delete_remarketing_list", "Подготовить удаление списка ремаркетинга", "Удаляет неиспользуемый список. VK Ads отклонит список, связанный с аудиторией или lookalike.", "delete_test_remarketing_user_list",
      { list_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "vk_delete_remarketing_list_v3", "Подготовить v3-удаление списка ремаркетинга", "Удаляет неиспользуемый список. Операция использует документированный v3 DELETE и не заменяет legacy v1-операцию.", "delete_test_remarketing_user_list_v3",
      { list_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "vk_create_async_report", "Подготовить создание отчёта", "Создаёт серверный отчёт с фиксированным v3 contract. Он не меняет кампании, ставки или бюджет.", "create_test_async_report",
      { title: z.string().min(1).max(120), advertisers: z.array(z.number().int().positive()).min(1).max(50), date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), metrics: z.array(z.enum(["acs", "cart_count", "clicks", "conversions", "cpa", "cpc", "cr", "cr_cart", "cr_purchase", "ctr", "inapp_count", "money", "purchase_count", "romi", "shows", "top_goal_count", "value", "video_100cost", "video_100pct", "video_10sec", "video_10sec_cost", "video_10sec_rate", "video_25pct", "video_50pct", "video_75pct", "video_avg_depth", "video_started", "video_view_rate"])).min(1).max(30), slices: z.array(z.enum(["ad_plan_id", "advertiser_id", "age", "banner_id", "campaign_id", "day", "feed_id", "geo", "hour", "inapp_id", "interests", "month", "offer_id", "search_phrase", "sex", "shop_id", "top_goal_id", "week", "year"])).min(1).max(16) },
    );
    registerWritePreviewAlias(
      "vk_delete_async_report", "Подготовить удаление отчёта", "Удаляет указанный серверный отчёт.", "delete_test_async_report",
      { report_id: z.number().int().positive() },
    );
    registerWritePreviewAlias(
      "vk_connect_client", "Подготовить подключение существующего клиента агентства", "Доступно только агентскому credential при VK_ADS_ALLOW_AGENCY_WRITES=1. Операция не создаёт credential и не принимает PII клиента.", "connect_agency_client",
      { user_id: z.number().int().positive(), access_type: z.literal("full_access") },
    );
    server.registerTool(
      "vk_manage_local_geo",
      {
        title: "Подготовить изменение local geo",
        description: "Создаёт, изменяет или удаляет список локального гео после одноразового подтверждения.",
        inputSchema: {
          action: z.enum(["create", "update", "delete"]),
          local_geo_id: z.number().int().positive().optional(),
          name: z.string().min(1).max(120).optional(),
          regions: z.array(z.object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180), radius: z.number().int().min(500).max(10_000), label: z.string().trim().min(1).max(200), address: z.string().trim().min(1).max(500).optional() }).strict()).min(1).max(200).optional(),
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
        title: "Выполнить подготовленную запись",
        description: options.requireWriteConfirmation === false ? "Выполняет ровно один свежий preview без фразы: локальный владелец профиля явно отключил подтверждение при старте. Не принимает произвольный endpoint, ID существующих кампаний или свободный payload." : "Выполняет ровно один свежий preview только после явного согласия пользователя именно на это изменение. Оценивайте смысл сообщения на языке пользователя: при отказе, сомнении, вопросе или нейтральной реплике не вызывайте этот инструмент. Не принимает произвольный endpoint, ID существующих кампаний или свободный payload.",
        inputSchema: { preview_id: z.string().uuid(), confirmation_statement: z.string().min(1).max(100).optional() },
        outputSchema: {
          operation: writeOperationSchema,
          result: z.record(z.string(), z.unknown()),
          after: z.record(z.string(), z.unknown()),
          audit: z.object({
            id: z.string().uuid(), operation: writeOperationSchema, connection_id: z.string(),
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
          case "recover_token_limit": {
            if (!options.tokenRecovery) throw new Error("Восстановление токенов недоступно в этом профиле.");
            result = await options.tokenRecovery.recover();
            break;
          }
          case "activate_configured_sharing_key": {
            if (!options.externalSharingKey) throw new Error("Внешний ключ шаринга не настроен в этом профиле.");
            await client.activateExternalSharingKey(options.externalSharingKey);
            result = { activated: true, activation_scope: "all_sources" };
            break;
          }
          case "create_url": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.createUrl(payload.url as string);
            break;
          }
          case "create_ad_plan": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.createAdPlan(payload);
            break;
          }
          case "update_ad_plan": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const { ad_plan_id: _id, ...body } = payload;
            result = await client.updateAdPlan(_id as number, body);
            break;
          }
          case "delete_ad_plan": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteAdPlan(payload.ad_plan_id as number);
            break;
          }
          case "manage_ad_plans": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.manageAdPlans(payload.items as VkObject[]);
            break;
          }
          case "create_campaign": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.createCampaign(payload);
            break;
          }
          case "update_campaign": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const { campaign_id: _id, ...body } = payload;
            result = await client.updateCampaign(_id as number, body);
            break;
          }
          case "delete_campaign": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteCampaign(payload.campaign_id as number);
            break;
          }
          case "create_ad_group": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.createAdGroup(payload);
            break;
          }
          case "update_ad_group": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const { ad_group_id: _id, ...body } = payload;
            result = await client.updateAdGroup(_id as number, body);
            break;
          }
          case "delete_ad_group": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteAdGroup(payload.ad_group_id as number);
            break;
          }
          case "manage_ad_groups": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.manageAdGroups(payload.items as VkObject[]);
            break;
          }
          case "create_banner": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.createBanner(payload as VkObject & { ad_group_id: number });
            break;
          }
          case "update_banner": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const { banner_id: _id, ...body } = payload;
            result = await client.updateBanner(_id as number, body);
            break;
          }
          case "delete_banner": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteBanner(payload.banner_id as number);
            break;
          }
          case "manage_banners": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.manageBanners(payload.items as VkObject[]);
            break;
          }
          case "delete_subscription": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteSubscription(payload.subscription_id as number);
            break;
          }
          case "create_subscription": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = subscriptionMetadata(await client.createSubscription({ resource: payload.resource as "BANNER" | "CAMPAIGN" | "OKLEADAD", callbackUrl: payload.callback_url as string }));
            break;
          }
          case "refresh_apple_app_metadata": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = publicMobileAppMetadata(await client.refreshAppleAppMetadata(payload.app_id as number));
            break;
          }
          case "refresh_google_app_metadata": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = publicMobileAppMetadata(await client.refreshGoogleAppMetadata(payload.package_name as string));
            break;
          }
          case "update_manager_client": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.updateAgencyManagerClient({ managerId: payload.manager_id as number, clientId: payload.client_id as number, accessType: payload.access_type as "full_access" | "readonly" | "fin_readonly" | "ads_readonly" });
            break;
          }
          case "delete_manager_client": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteAgencyManagerClient(payload.manager_id as number, payload.client_id as number);
            break;
          }
          case "update_agency_client": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.updateAgencyClient({
              clientId: payload.client_id as number,
              ...(payload.is_vkads === undefined ? {} : { isVkads: payload.is_vkads as boolean }),
              ...(payload.access_type === undefined ? {} : { accessType: payload.access_type as "full_access" }),
              ...(payload.additional_emails === undefined ? {} : { additionalEmails: payload.additional_emails as string[] }),
              ...(payload.additional_info === undefined ? {} : { additionalInfo: {
                ...((payload.additional_info as VkObject).client_name === undefined ? {} : { clientName: (payload.additional_info as VkObject).client_name as string }),
                ...((payload.additional_info as VkObject).client_info === undefined ? {} : { clientInfo: (payload.additional_info as VkObject).client_info as string }),
              } }),
            });
            break;
          }
          case "delete_agency_client": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteAgencyClient(payload.client_id as number);
            break;
          }
          case "update_user_profile": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const { api_version, ...body } = payload;
            result = await client.updateUserProfile(api_version as "v2" | "v3", body);
            break;
          }
          case "connect_existing_remarketing_counter": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.connectExistingRemarketingCounter({ counterId: payload.counter_id as number, name: payload.name as string, flags: payload.flags as Array<"cookie_sync"> });
            break;
          }
          case "update_ord_partner_acts": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = publicSensitiveMetadata(await client.updateOrdPartnerActs(payload.month as string, payload.ord_pad_id as number, payload.acts as VkObject[])) as VkObject;
            break;
          }
          case "update_ord_partner_pad": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const { ord_pad_id: _id, ...body } = payload;
            result = publicSensitiveMetadata(await client.updateOrdPartnerPad(_id as number, body)) as VkObject;
            break;
          }
          case "create_ord_partner_subagent": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = publicSensitiveMetadata(await client.createOrdPartnerSubagent(payload)) as VkObject;
            break;
          }
          case "update_ord_partner_subagent": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const { id: _id, ...body } = payload;
            result = publicSensitiveMetadata(await client.updateOrdPartnerSubagent(_id as number, body)) as VkObject;
            break;
          }
          case "transfer_to_client": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = { operation: "transfer_to_client", client_id: payload.client_id as number, status: "submitted" };
            await client.transferToClient(payload.client_id as number, payload.amount as string);
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
              counterId: payload.counter_id as number,
              leftDays: payload.left_days as number,
              goalId: payload.goal_id as string,
            });
            break;
          }
          case "create_test_pricelist": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.createTestPricelist(payload.name as string);
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
          case "update_campaign_budget_limit_day": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.updateCampaignBudgetLimitDay(payload.campaign_id as number, payload.budget_limit_day as number);
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
          case "delete_test_remarketing_counter_v2": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteTestRemarketingCounterV2(payload.counter_id as number);
            break;
          }
          case "delete_test_offline_goal": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteTestOfflineGoal(payload.offline_goal_id as number);
            break;
          }
          case "update_test_offline_goal": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.updateTestOfflineGoal({
              id: payload.offline_goal_id as number,
              name: payload.name as string,
              ...(payload.file_path === undefined ? {} : { filename: payload.filename as string, mimeType: payload.mime_type as string, bytes: await readFile(payload.file_path as string) }),
            });
            break;
          }
          case "create_test_counter_goal": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.createTestCounterGoal({ counterId: payload.counter_id as number, name: payload.name as string, substr: payload.substr as string, condition: payload.condition as "uss" | "rss" | "jse" | "hd" | "ts", goalType: payload.goal_type as "content" | "search" | "basket" | "wishlist" | "checkout" | "payment_info" | "purchase" | "lead" | "registration" | "custom", ...(payload.value === undefined ? {} : { value: payload.value as number | null }) });
            break;
          }
          case "delete_test_ad_group": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteTestAdGroup(payload.ad_group_id as number);
            break;
          }
          case "delete_test_campaign": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteTestCampaign(payload.campaign_id as number);
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
          case "update_test_segment_relation": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.updateTestSegmentRelation({ segmentId: payload.segment_id as number, relationId: payload.relation_id as number, left: payload.left as number, right: payload.right as number, type: payload.type as "positive" | "negative" });
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
            result = payload.api_version === "v3" ? await client.createTestRemarketingUserListV3({
              name: payload.name as string, type: payload.type as string, filename: list.filename, mimeType: list.mimeType, bytes: list.bytes,
            }) : await client.createTestRemarketingUserList({
              name: payload.name as string,
              type: payload.type as string,
              filename: list.filename,
              mimeType: list.mimeType,
              bytes: list.bytes,
            });
            break;
          }
          case "upload_test_offline_goal": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            const piiRoot = options.piiUploadDir;
            if (!piiRoot || !options.allowPiiUploads) {
              throw new Error("Загрузка офлайн-конверсий с PII отключена до явного opt-in при запуске.");
            }
            const list = validateRemarketingUserListUpload(payload.file_path as string, piiRoot);
            if (list.sha256 !== payload.sha256 || list.size !== payload.size || list.lineCount !== payload.line_count) {
              throw new Error("Файл офлайн-конверсий изменился после preview; подготовьте новое подтверждение.");
            }
            result = await client.createTestOfflineGoal({
              name: payload.name as string,
              attributionPeriod: payload.attribution_period as number,
              type: payload.type as "email" | "hash_email" | "phone" | "hash_phone",
              filename: list.filename,
              mimeType: list.mimeType,
              bytes: list.bytes,
            });
            break;
          }
          case "rename_test_remarketing_user_list": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = payload.api_version === "v3" ? await client.renameTestRemarketingUserListV3(payload.list_id as number, payload.name as string) : await client.renameTestRemarketingUserList(payload.list_id as number, payload.name as string);
            break;
          }
          case "delete_test_remarketing_user_list": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteTestRemarketingUserList(payload.list_id as number);
            break;
          }
          case "delete_test_remarketing_user_list_v3": {
            const payload = normalizeTestWritePayload(preview.operation, preview.payload, options.uploadDir);
            result = await client.deleteTestRemarketingUserListV3(payload.list_id as number);
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
          return textAndData({ operation: preview.operation, result, after, audit }, "Подтверждённая операция VK Ads выполнена и повторно проверена, если API поддерживает чтение объекта.");
        } catch (error) {
          writeGate.complete(preview, "failed");
          throw error;
        }
      },
    );

    server.registerTool(
      "write_audit_list",
      {
        title: "Журнал записей",
        description: "Read-only: возвращает метаданные preview и выполнения текущего процесса без токенов, payload и тел API-ответов.",
        inputSchema: { limit: z.number().int().min(1).max(100).default(50) },
        outputSchema: { items: z.array(z.object({
          id: z.string().uuid(), operation: writeOperationSchema, connection_id: z.string(), status: z.enum(["prepared", "succeeded", "failed"]),
          prepared_at: z.string().datetime(), completed_at: z.string().datetime().nullable(), result_hash: z.string().length(64).nullable(),
        })) },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
      },
      async ({ limit }) => textAndData({ items: writeGate.listAudit(limit) }, "Журнал записей получен."),
    );
  }

  return server;
}
