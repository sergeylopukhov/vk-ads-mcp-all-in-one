import { z } from "zod";

import { EnvFileVkAdsCredentialStore } from "../auth/env-store.js";
import { VkAdsOAuthClient, type FetchLike } from "../auth/oauth-client.js";
import { VkAdsTokenManager } from "../auth/token-manager.js";
import {
  formatProviderErrorSuffix,
  normalizeProviderError,
} from "../provider-error.js";
import { VkAdsApiError } from "./errors.js";
import {
  appendPagination,
  createPageSchema,
  type VkAdsPaginationInput,
} from "./pagination.js";

export const VK_ADS_API_V3_BASE_URL = "https://ads.vk.ru/api/v3";
export const VK_ADS_API_V2_BASE_URL = "https://ads.vk.ru/api/v2";
export const VK_ADS_API_V1_BASE_URL = "https://ads.vk.ru/api/v1";
const REQUEST_TIMEOUT_MS = 15_000;
const READ_RATE_LIMIT_RETRIES = 2;
const DEFAULT_READ_RETRY_DELAY_MS = 1_000;
const MAX_READ_RETRY_DELAY_MS = 5_000;

const currentUserSchema = z
  .object({
    id: z.union([z.number().int(), z.string().min(1)]),
    status: z.string().min(1).optional(),
    currency: z.string().min(1).optional(),
    types: z.array(z.string().min(1)).optional(),
  })
  .passthrough();
const userProfileSchema = z
  .object({
    id: z.union([z.number().int(), z.string().min(1)]),
    status: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
    currency: z.string().min(1).optional(),
    info_currency: z.string().min(1).optional(),
    timezone: z.number().int().optional(),
    country: z.number().int().optional(),
    types: z.array(z.string().min(1)).optional(),
  })
  .passthrough();

const referenceItemSchema = z.record(z.string(), z.unknown());
const referenceCollectionSchema = z
  .object({
    items: z.array(referenceItemSchema),
    count: z.number().int().nonnegative().optional(),
    limit: z.number().int().nonnegative().nullable().optional(),
    offset: z.number().int().nonnegative().nullable().optional(),
  })
  .passthrough();
const referenceMapSchema = z.record(z.string(), z.unknown());

const adPlanStatusSchema = z.enum(["active", "blocked", "deleted"]);

const adPlanSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    status: adPlanStatusSchema,
  })
  .passthrough();

const adPlansPageSchema = createPageSchema(adPlanSchema);
const adGroupSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    status: adPlanStatusSchema,
    ad_plan_id: z.number().int().nonnegative().nullable(),
    package_id: z.number().int(),
    max_price: z
      .union([z.number().finite(), z.string().min(1)])
      .optional(),
  })
  .passthrough();
const adGroupsPageSchema = createPageSchema(adGroupSchema);
const bannerSchema = z
  .object({
    id: z.number().int().positive(),
    ad_group_id: z.number().int().positive().optional(),
    ad_group: z.number().int().positive().optional(),
    name: z.string().optional(),
    status: adPlanStatusSchema.optional(),
    moderation_status: z
      .enum(["pending", "allowed", "banned"])
      .optional(),
    content: z
      .record(z.string(), z.unknown())
      .optional(),
    textblocks: z
      .record(z.string(), z.unknown())
      .optional(),
    urls: z
      .record(z.string(), z.unknown())
      .optional(),
  })
  .passthrough()
  .refine(
    (banner) =>
      banner.ad_group_id !== undefined ||
      banner.ad_group !== undefined,
    "Banner response has no ad-group identifier.",
  );
const bannersPageSchema = createPageSchema(bannerSchema);
const bannerRemoderationResponseSchema = z
  .object({
    banners: z.array(
      z
        .object({
          id: z.number().int().positive(),
          remoderated: z.boolean(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const createBannerResponseSchema = z
  .object({
    id: z.number().int().positive(),
  })
  .passthrough();
const html5ContentVariantSchema = z
  .object({
    url: z.string().min(1),
    html_params: z
      .object({
        width: z.coerce.number().int().positive(),
        height: z.coerce.number().int().positive(),
        size: z.coerce.number().int().nonnegative().optional(),
      })
      .passthrough(),
    size: z.coerce.number().int().nonnegative().optional(),
  })
  .passthrough()
  .refine(
    (variant) =>
      variant.size !== undefined ||
      variant.html_params.size !== undefined,
    "HTML5 content variant has no size.",
  );
const contentUploadResponseSchema = z
  .object({
    id: z.number().int().positive(),
    variants: z.record(z.string(), html5ContentVariantSchema),
  })
  .passthrough();
const staticContentVariantSchema = z
  .object({
    url: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    size: z.number().int().nonnegative(),
  })
  .passthrough();
const staticContentUploadResponseSchema = z
  .object({
    id: z.number().int().positive(),
    variants: z.record(z.string(), staticContentVariantSchema),
  })
  .passthrough();
const remarketingCounterSchema = z
  .object({
    id: z.number().int().positive(),
    counter_id: z.number().int().positive(),
    name: z.string(),
    status: z.enum(["active", "blocked", "deleted"]),
    system_status: z.enum(["active", "blocked", "deleted"]),
    working: z.boolean().nullable(),
    flags: z.array(z.string()).optional(),
  })
  .passthrough();
const remarketingCountersResponseSchema = z
  .object({
    items: z.array(remarketingCounterSchema),
  })
  .passthrough();
const remarketingCounterGoalSchema = z
  .object({
    id: z
      .union([z.number().int().positive(), z.string().min(1)])
      .optional(),
    substr: z.string().nullable().optional(),
    value: z.number().finite().nullable().optional(),
    name: z.string(),
    condition: z.string().optional(),
    goal_type: z.string().optional(),
  })
  .passthrough();
const remarketingCounterGoalsResponseSchema = z
  .object({
    items: z.array(remarketingCounterGoalSchema),
  })
  .passthrough();
const goalSchema = z
  .object({
    goal: z.string().min(1),
    description: z.string(),
    id: z.number().int().optional(),
    counter_id: z.number().int().optional(),
    counter_name: z.string().optional(),
  })
  .passthrough();
const goalsResponseSchema = z.record(
  z.string(),
  z.array(goalSchema),
);
const inAppEventSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    inapp_event_category_id: z.number().int().positive().optional(),
  })
  .passthrough();
const inAppTrackerSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    events: z.array(inAppEventSchema),
  })
  .passthrough();
const remarketingInAppEventSourceSchema = z
  .object({
    rb_mobile_app_id: z.number().int().positive(),
    app_name: z.string(),
    platform: z.string().min(1),
    status: z.string().min(1),
    trackers: z.array(inAppTrackerSchema),
  })
  .passthrough();
const remarketingInAppEventsResponseSchema = createPageSchema(
  remarketingInAppEventSourceSchema,
);
const localGeoRegionSchema = z
  .object({
    lat: z.number().finite(),
    lng: z.number().finite(),
    radius: z.number().int().positive(),
    label: z.string(),
    address: z.string(),
  })
  .passthrough();
const localGeoSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    regions: z.array(localGeoRegionSchema),
  })
  .passthrough();
const localGeosResponseSchema = z
  .object({
    items: z.array(localGeoSchema),
  })
  .passthrough();
const remarketingPricelistSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    status: z.string().min(1).optional(),
    source_type: z.string().min(1).optional(),
  })
  .passthrough();
const remarketingPricelistsPageSchema = createPageSchema(
  remarketingPricelistSchema,
);
const createRemarketingPricelistResponseSchema = z
  .object({
    id: z.number().int().positive(),
  })
  .passthrough();
const offerBatchTaskSchema = z
  .object({
    id: z.number().int().positive(),
    status: z.string().min(1),
  })
  .passthrough();
const createOfferBatchTaskResponseSchema = z
  .union([
    z.array(offerBatchTaskSchema).min(1),
    offerBatchTaskSchema,
  ]);
const offerBatchTaskErrorSchema = z
  .object({
    event: z.enum([
      "feed_failure",
      "offer_error",
      "offer_warning",
    ]),
    code: z.string().min(1),
    count: z.number().int().nonnegative(),
  })
  .passthrough();
const offerBatchTaskDetailSchema = offerBatchTaskSchema
  .extend({
    errors: z.array(offerBatchTaskErrorSchema).optional(),
  })
  .passthrough();
const remarketingOfflineGoalSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    type: z.enum(["email", "phone"]),
    attribution_period: z.number().int().positive(),
    load_status: z.string().min(1).optional(),
  })
  .passthrough();
const remarketingOfflineGoalsResponseSchema = z
  .object({
    items: z.array(remarketingOfflineGoalSchema),
  })
  .passthrough();
const remarketingUsersListSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    status: z.string().min(1),
    type: z.string().min(1),
    base: z.number().int(),
    entries_count: z.number().int().nonnegative(),
    ids_count: z.number().int().nonnegative(),
    matched_ids_count: z.number().int().nonnegative().optional(),
    has_history: z.boolean().optional(),
  })
  .passthrough();
const remarketingUsersListsResponseSchema = z
  .object({
    items: z.array(remarketingUsersListSchema),
  })
  .passthrough();
const createRemarketingUsersListResponseSchema = z
  .object({
    id: z.number().int().positive(),
  })
  .passthrough();
const vkGroupSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1),
    object_id: z.number().int().positive(),
    shortname: z.string().min(1),
    url: z.string().url(),
  })
  .passthrough();
const vkGroupsPageSchema = z
  .object({
    count: z.number().int().nonnegative(),
    items: z.array(vkGroupSchema),
  })
  .passthrough();
const segmentSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    pass_condition: z.number().int().nonnegative(),
    relations_count: z.number().int().nonnegative().optional(),
  })
  .passthrough();
const segmentsPageSchema = createPageSchema(segmentSchema);
const createSegmentResponseSchema = z
  .object({
    id: z.number().int().positive(),
  })
  .passthrough();
const segmentRelationSchema = z
  .object({
    id: z.number().int().positive(),
    object_type: z.string().min(1),
    object_id: z.number().int(),
    params: z
      .record(z.string(), z.unknown())
      .nullable()
      .optional(),
  })
  .passthrough();
const segmentRelationsResponseSchema = z
  .object({
    items: z.array(segmentRelationSchema),
  })
  .passthrough();
const sharingKeySourceSchema = z
  .object({
    object_type: z.string().min(1),
    object_id: z.number().int().positive(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
const sharingKeySchema = z
  .object({
    sharing_key: z.string().min(1),
    sources: z.array(sharingKeySourceSchema),
    price: z.union([z.string(), z.number()]).optional(),
    is_marketplace: z.boolean().optional(),
    send_email: z.boolean().nullable().optional(),
    payment_type: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
    users: z.array(z.unknown()).optional(),
  })
  .passthrough();
const sharingKeysResponseSchema = z
  .object({
    items: z.array(sharingKeySchema),
  })
  .passthrough();
const sharingKeyActivationSchema = z
  .object({
    id: z.number().int().positive(),
    sources: z.array(sharingKeySourceSchema),
  })
  .passthrough();
const auditPixelResponseSchema = z
  .object({
    audit_pixel: z.string().url(),
    generated_audit_pixels: z.array(
      z
        .object({
          audit_pixel: z.string().url(),
          role: z.string().min(1),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const projectionResponseSchema = z
  .object({
    cr_ctr: z.array(
      z
        .object({
          package_id: z.number().int().positive(),
          histogram_id: z.number().int().positive(),
          avg_cr: z.number().nullable(),
          avg_ctr: z.number(),
        })
        .passthrough(),
    ),
    histograms: z.array(
      z
        .object({
          histogram_id: z.number().int().positive(),
          count: z.number().int().nonnegative(),
          histogram: z.array(
            z
              .object({
                price: z.number(),
                uniqs: z.number().int().nonnegative(),
                share: z.number(),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const statisticsDayResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.number().int().positive(),
          user_id: z.number().int().positive().optional(),
          total: z.record(z.string(), z.unknown()),
        })
        .passthrough(),
    ),
    total: z.record(z.string(), z.unknown()),
    limit: z.number().int().positive(),
    offset: z.number().int().nonnegative(),
    count: z.number().int().nonnegative(),
  })
  .passthrough();
const fastStatisticsSeriesSchema = z
  .object({
    timestamp: z.number().int().nonnegative(),
    minutely: z
      .object({
        clicks: z.array(z.number()),
        shows: z.array(z.number()),
      })
      .passthrough(),
  })
  .passthrough();
const fastStatisticsResponseSchema = z
  .object({
    last_seen_msg_time: z
      .object({
        timestamp: z.number().int().nonnegative(),
        string: z.string(),
        ago: z.number().int().nonnegative(),
      })
      .passthrough(),
    banners: z.record(z.string(), fastStatisticsSeriesSchema),
    campaigns: z.record(z.string(), fastStatisticsSeriesSchema),
    advertisers: z.record(z.string(), fastStatisticsSeriesSchema),
    ad_plans: z.record(z.string(), fastStatisticsSeriesSchema),
  })
  .passthrough();
const v2StatisticsResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.number().int().positive(),
          total: z.record(z.string(), z.unknown()),
          rows: z
            .array(z.record(z.string(), z.unknown()))
            .optional(),
        })
        .passthrough(),
    ),
    total: z.record(z.string(), z.unknown()),
  })
  .passthrough();
const offlineConversionStatisticsResponseSchema = z
  .object({
    items: z.array(
      z
        .object({
          id: z.number().int().positive(),
          total: z.record(z.string(), z.unknown()),
          rows: z
            .array(z.record(z.string(), z.unknown()))
            .optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const leadFormIdSchema = z
  .union([
    z.number().int().positive(),
    z.string().regex(/^\d+$/),
  ])
  .transform(Number);
const leadFormSchema = z
  .object({
    id: leadFormIdSchema,
    name: z.string(),
    status: z.number().int().optional(),
    first_screen_type: z
      .enum(["compact", "long_text", "award"])
      .optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    long_description: z.string().optional(),
    company_title: z.string().optional(),
    logo_id: z.string().nullable().optional(),
    award: z.record(z.string(), z.unknown()).optional(),
    gradient: z.number().int().optional(),
    contact_fields: z.array(z.string()).optional(),
    result_info: z.record(z.string(), z.unknown()).optional(),
    agreement: z.record(z.string(), z.unknown()).optional(),
    notifications: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    pages: z.array(z.record(z.string(), z.unknown())).optional(),
    required_answers: z.boolean().optional(),
    main_color: z.string().optional(),
    main_image_id: z.string().nullable().optional(),
    leads_count: z.number().int().nonnegative().optional(),
  })
  .passthrough();
const leadFormsPageSchema = z
  .object({
    count: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    items: z.array(leadFormSchema),
  })
  .passthrough();
const leadFormsMutationResponseSchema = z.array(leadFormSchema);
const leadFormCreateResponseSchema = z
  .object({
    id: leadFormIdSchema,
  })
  .passthrough();
const leadFormImageUploadResponseSchema = z
  .object({
    id: z.string().min(1),
    variants: z.record(z.string(), z.string().url()),
  })
  .passthrough();
const surveySchema = z
  .object({
    id: leadFormIdSchema,
    name: z.string(),
    status: z.number().int().optional(),
    first_screen_type: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    company_title: z.string().optional(),
    logo_id: z.string().nullable().optional(),
    logo: z
      .object({
        id: z.string().min(1),
      })
      .passthrough()
      .optional(),
    gradient: z.number().int().optional(),
    result_info: z.record(z.string(), z.unknown()).optional(),
    pages: z.array(z.record(z.string(), z.unknown())).optional(),
    respondents_count: z.number().int().nonnegative().optional(),
  })
  .passthrough();
const surveysPageSchema = z
  .object({
    count: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    items: z.array(surveySchema),
  })
  .passthrough();
const surveysMutationResponseSchema = z.array(surveySchema);
const surveyCreateResponseSchema = z
  .object({ id: leadFormIdSchema })
  .passthrough();
const respondentSchema = z
  .object({
    id: z.union([
      z.number().int().positive(),
      z.string().min(1),
    ]),
    survey_id: leadFormIdSchema.optional(),
    form_id: leadFormIdSchema.optional(),
    survey_name: z.string().optional(),
    form_name: z.string().optional(),
    ad_plan_id: z.number().int().positive().nullable().optional(),
    ad_group_id: z.number().int().positive().nullable().optional(),
    banner_id: z.number().int().positive().nullable().optional(),
    created_at: z.string().min(1),
  })
  .passthrough()
  .refine(
    (item) =>
      item.survey_id !== undefined || item.form_id !== undefined,
    "Respondent response has no survey identifier.",
  );
const respondentsPageSchema = z
  .object({
    count: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    items: z.array(respondentSchema),
  })
  .passthrough();
const subscriptionIdSchema = z
  .union([
    z.number().int().positive(),
    z.string().regex(/^\d+$/),
  ])
  .transform(Number);
const subscriptionSchema = z
  .object({
    id: subscriptionIdSchema,
    resource: z.string().min(1),
    callback_url: z.string().url(),
  })
  .passthrough();
const subscriptionsPageSchema = z
  .object({
    count: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive().nullable().optional(),
    items: z.array(subscriptionSchema),
  })
  .passthrough();
const subscriptionCreateResponseSchema = z
  .object({ id: subscriptionIdSchema })
  .passthrough();
const urlIdSchema = z.number().int().positive();
const resolvedUrlSchema = z
  .object({
    id: urlIdSchema,
    url_types: z.array(z.string()),
    has_goals: z.boolean().optional(),
  })
  .passthrough();
const urlSchema = resolvedUrlSchema
  .extend({
    url: z.string().url(),
  })
  .passthrough();
const urlsSchema = z
  .object({
    items: z.array(urlSchema),
  })
  .passthrough();
const urlsResponseSchema = z.union([urlsSchema, urlSchema]);
const urlCreateResponseSchema = z
  .object({
    id: urlIdSchema,
  })
  .passthrough();
const mobileStoreAppSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string().min(1),
    status: z.string().min(1),
    title: z.string(),
    content_rating: z.string().optional(),
    type: z.string().optional(),
    category_id: z.number().int().optional(),
  })
  .passthrough();
const ordUserSchema = z
  .object({
    name: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    inn: z.string().nullable().optional(),
    foreign_epayment_method: z.string().nullable().optional(),
    foreign_oksm_country_code: z.string().nullable().optional(),
    foreign_registration_number: z.string().nullable().optional(),
    foreign_inn: z.string().nullable().optional(),
    site: z.string().nullable().optional(),
  })
  .passthrough();
const userGeoItemSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
  })
  .passthrough();
const userGeoPageSchema = z
  .object({
    count: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive().nullable().optional(),
    items: z.array(userGeoItemSchema),
  })
  .passthrough();
const leadIdSchema = z
  .union([
    z.number().int().positive(),
    z.string().regex(/^\d+$/),
  ])
  .transform(String);
const leadSchema = z
  .object({
    id: leadIdSchema,
    form_id: leadFormIdSchema,
    form_name: z.string(),
    ad_plan_id: z.number().int().positive().nullable().optional(),
    ad_group_id: z.number().int().positive().nullable().optional(),
    banner_id: z.number().int().positive().nullable().optional(),
    created_at: z.string().min(1),
  })
  .passthrough();
const leadsPageSchema = z
  .object({
    count: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().nonnegative(),
    items: z.array(leadSchema),
  })
  .passthrough();
const testLeadResponseSchema = z
  .object({
    is_operation_processed: z.boolean(),
    message: z.string(),
    seconds_before_next_sending: z.number().int().nonnegative(),
  })
  .passthrough();
const createAdGroupResponseSchema = z
  .object({
    id: z.number().int().positive(),
    banners: z
      .array(
        z
          .object({
            id: z.number().int().positive(),
          })
          .passthrough(),
      )
      .optional(),
  })
  .passthrough();
const createAdPlanResponseSchema = z
  .object({
    id: z.number().int().positive(),
  })
  .passthrough();

export interface VkAdsCurrentUser {
  id: number | string;
  status?: string;
  currency?: string;
  types?: string[];
}

export type VkAdsUserApiVersion = "v2" | "v3";

export interface VkAdsUserProfile extends VkAdsCurrentUser {
  language?: string;
  infoCurrency?: string;
  timezone?: number;
  country?: number;
}

export type VkAdsReferenceCollectionResource =
  | "banner_fields"
  | "banner_patterns"
  | "currencies"
  | "in_app_event_categories"
  | "mobile_apps"
  | "mobile_categories"
  | "mobile_os"
  | "mobile_operators"
  | "mobile_types"
  | "mobile_vendors"
  | "packages"
  | "packages_pads"
  | "pads_trees"
  | "regions"
  | "transaction_groups";

export type VkAdsReferenceMapResource =
  | "targetings_tree"
  | "throttling";

export interface VkAdsReferenceCollectionResult {
  count: number;
  limit: number;
  offset: number;
  items: Array<Record<string, unknown>>;
}

export interface VkAdsReferenceCollectionInput
  extends VkAdsPaginationInput {
  ids?: number[];
}

export interface VkAdsUrl {
  id: number;
  url: string;
  urlTypes: string[];
  hasGoals?: boolean;
}

export type VkAdsMobileStore = "apple" | "google";

export interface VkAdsMobileStoreApp {
  id: number;
  identifier: string;
  status: string;
  title: string;
  contentRating?: string;
  type?: string;
  categoryId?: number;
}

export interface VkAdsOrdUser {
  name?: string | null;
  phone?: string | null;
  inn?: string | null;
  foreign_epayment_method?: string | null;
  foreign_oksm_country_code?: string | null;
  foreign_registration_number?: string | null;
  foreign_inn?: string | null;
  site?: string | null;
}

export interface VkAdsUserGeoPage {
  count: number;
  limit: number;
  offset: number;
  items: Array<{ id: number; name: string }>;
}

export type VkAdsAdPlanStatus = z.infer<typeof adPlanStatusSchema>;

export interface VkAdsAdPlan {
  id: number;
  name: string;
  status: VkAdsAdPlanStatus;
}

export interface VkAdsAdPlansPage {
  count: number;
  offset: number;
  items: VkAdsAdPlan[];
}

export interface ListVkAdsAdPlansInput extends VkAdsPaginationInput {
  status?: VkAdsAdPlanStatus;
}

export type VkAdsAdGroupSorting =
  | "id"
  | "-id"
  | "name"
  | "-name"
  | "status"
  | "-status";

export interface ListVkAdsAdGroupsInput extends VkAdsPaginationInput {
  id?: number;
  ids?: number[];
  status?: VkAdsAdPlanStatus;
  statusNot?: VkAdsAdPlanStatus;
  statuses?: VkAdsAdPlanStatus[];
  lastUpdatedLt?: string;
  lastUpdatedLte?: string;
  lastUpdatedGt?: string;
  lastUpdatedGte?: string;
  sorting?: VkAdsAdGroupSorting[];
}

export interface VkAdsAdGroup {
  id: number;
  name: string;
  status: VkAdsAdPlanStatus;
  adPlanId: number;
  packageId: number;
  maxPrice?: VkAdsDecimalInput;
}

export interface VkAdsAdGroupsPage {
  count: number;
  offset: number;
  items: VkAdsAdGroup[];
}

export interface VkAdsBanner {
  id: number;
  adGroupId: number;
  name?: string;
  status?: VkAdsAdPlanStatus;
  moderationStatus?: "pending" | "allowed" | "banned";
  content?: Record<string, unknown>;
  textblocks?: Record<string, unknown>;
  urls?: Record<string, unknown>;
}

export interface ListVkAdsBannersInput extends VkAdsPaginationInput {
  id?: number;
  ids?: number[];
  adGroupId?: number;
  adGroupIds?: number[];
  adGroupStatus?: VkAdsAdPlanStatus;
  adGroupStatusNot?: VkAdsAdPlanStatus;
  adGroupStatuses?: VkAdsAdPlanStatus[];
  status?: VkAdsAdPlanStatus;
  statusNot?: VkAdsAdPlanStatus;
  statuses?: VkAdsAdPlanStatus[];
  updatedLt?: string;
  updatedLte?: string;
  updatedGt?: string;
  updatedGte?: string;
  url?: string;
  textblock?: string;
}

export interface VkAdsBannersPage {
  count: number;
  offset: number;
  items: VkAdsBanner[];
}

export interface UpdateVkAdsBannerInput {
  name?: string;
  status?: VkAdsAdPlanStatus;
  content?: Record<string, unknown>;
  textblocks?: Record<string, unknown>;
  urls?: Record<string, unknown>;
}

export type CreateVkAdsBannerInput = UpdateVkAdsBannerInput;

export interface CreateVkAdsBannerResult {
  id: number;
}

export interface MassUpdateVkAdsBannerInput {
  id: number;
  status: VkAdsAdPlanStatus;
}

export interface VkAdsBannerRemoderationResult {
  id: number;
  remoderated: boolean;
}

export interface VkAdsContentVariant {
  width: number;
  height: number;
  size: number;
}

export interface VkAdsContentUploadResult {
  id: number;
  variants: Record<string, VkAdsContentVariant>;
}

export interface VkAdsLeadFormImageUploadResult {
  id: string;
  variants: string[];
}

export interface VkAdsLead {
  id: string;
  formId: number;
  formName: string;
  adPlanId?: number | null;
  adGroupId?: number | null;
  bannerId?: number | null;
  createdAt: string;
}

export interface ListVkAdsLeadsInput {
  limit?: number;
  offset?: number;
  formIds?: number[];
  adPlanIds?: number[];
  adGroupIds?: number[];
  bannerIds?: number[];
  createdAtFrom?: string;
  createdAtTo?: string;
}

export interface VkAdsLeadsPage {
  count: number;
  offset: number;
  limit: number;
  items: VkAdsLead[];
}

export interface ExportVkAdsLeadFormLeadsInput {
  format: "csv" | "xlsx";
  createdAtFrom?: string;
  createdAtTo?: string;
  adPlanIds?: number[];
  adGroupIds?: number[];
  bannerIds?: number[];
}

export interface VkAdsLeadFormLeadsExport {
  bytes: Uint8Array;
  contentType?: string;
}

export interface VkAdsTestLeadResult {
  processed: boolean;
  secondsBeforeNextSending: number;
}

export interface ListVkAdsRemarketingCountersInput {
  counterId?: number;
  counterIds?: number[];
  domain?: string;
  domains?: string[];
}

export interface VkAdsRemarketingCounter {
  id: number;
  counterId: number;
  name: string;
  status: "active" | "blocked" | "deleted";
  systemStatus: "active" | "blocked" | "deleted";
  working: boolean | null;
  flags: string[];
}

export interface VkAdsRemarketingCountersResult {
  items: VkAdsRemarketingCounter[];
}

export interface VkAdsRemarketingCounterGoal {
  id?: number | string;
  substr?: string | null;
  value?: number | null;
  name: string;
  condition?: string;
  goalType?: string;
}

export interface CreateVkAdsRemarketingCounterGoalInput {
  substr?: string;
  value?: number;
  name: string;
  condition?: string;
  goal_type?: string;
}

export type UpdateVkAdsRemarketingCounterGoalInput = Partial<
  CreateVkAdsRemarketingCounterGoalInput
>;

export interface VkAdsRemarketingOfflineGoal {
  id: number;
  name: string;
  type: "email" | "phone";
  attributionPeriod: number;
  loadStatus?: string;
}

export interface VkAdsRemarketingOfflineGoalsResult {
  items: VkAdsRemarketingOfflineGoal[];
}

export interface CreateVkAdsRemarketingOfflineGoalInput {
  name: string;
  type: "email" | "phone";
  attribution_period: number;
}

export interface UpdateVkAdsRemarketingOfflineGoalInput {
  name?: string;
}

export interface VkAdsRemarketingUsersList {
  id: number;
  name: string;
  status: string;
  type: string;
  base: number;
  entriesCount: number;
  idsCount: number;
  matchedIdsCount?: number;
  hasHistory?: boolean;
}

export interface VkAdsRemarketingUsersListsResult {
  items: VkAdsRemarketingUsersList[];
}

export interface CreateVkAdsRemarketingUsersListInput {
  name: string;
  type: string;
  base?: number;
}

export type VkAdsRemarketingUsersListApiVersion = 2 | 3;
export type VkAdsRemarketingUsersListDeleteApiVersion = 1 | 2 | 3;

export interface VkAdsVkGroup {
  id: number;
  name: string;
  objectId: number;
  shortname: string;
  url: string;
}

export interface VkAdsVkGroupsPage {
  count: number;
  offset: number;
  items: VkAdsVkGroup[];
}

export type CreateVkAdsVkGroupInput =
  | { object_id: number }
  | { shortname: string };

export interface VkAdsSegment {
  id: number;
  name: string;
  passCondition: number;
  relationsCount?: number;
}

export interface VkAdsSegmentsPage {
  count: number;
  offset: number;
  items: VkAdsSegment[];
}

export interface ListVkAdsSegmentsInput extends VkAdsPaginationInput {
  id?: number;
  ids?: number[];
  name?: string;
  nameStartsWith?: string;
}

export interface VkAdsSegmentRelation {
  id: number;
  objectType: string;
  objectId: number;
  params?: Record<string, unknown>;
}

export interface CreateVkAdsSegmentRelationInput {
  object_type: string;
  object_id?: number;
  params?: Record<string, unknown>;
}

export interface CreateVkAdsSegmentInput {
  name: string;
  pass_condition: number;
  relations: CreateVkAdsSegmentRelationInput[];
}

export interface UpdateVkAdsSegmentInput {
  name?: string;
  pass_condition?: number;
}

export interface VkAdsSharingKeySource {
  objectType: string;
  objectId: number;
  params?: Record<string, unknown>;
}

export interface VkAdsSharingKey {
  sharingKey: string;
  sources: VkAdsSharingKeySource[];
  price?: string;
  isMarketplace?: boolean;
  sendEmail?: boolean | null;
  paymentType?: string;
  type?: string;
  userCount: number;
}

export interface CreateVkAdsSharingKeyInput {
  sources: Array<{
    object_type: string;
    object_id: number;
  }>;
  send_email?: boolean;
  users?: Array<{ username: string }>;
  is_marketplace?: boolean;
  payment_type?: string;
  price?: string;
}

export interface VkAdsAuditPixelCheckResult {
  auditPixel: string;
  generatedAuditPixels: Array<{
    auditPixel: string;
    role: string;
  }>;
}

export interface VkAdsProjectionInput {
  campaign_id?: number;
  package_ids?: number[];
  targetings: Record<string, unknown>;
}

export interface VkAdsProjectionResult {
  crCtr: Array<{
    packageId: number;
    histogramId: number;
    avgCr: number | null;
    avgCtr: number;
  }>;
  histograms: Array<{
    id: number;
    points: Array<{
      price: number;
      uniqs: number;
      share: number;
    }>;
  }>;
}

export type VkAdsStatisticsResource =
  | "banners"
  | "ad_groups"
  | "ad_plans"
  | "users";

export interface ListVkAdsStatisticsDayInput {
  resource: VkAdsStatisticsResource;
  date_from: string;
  date_to?: string;
  ids?: number[];
  excluded_ids?: number[];
  fields?: string[];
  attribution?: "conversion" | "impression";
  banner_statuses?: string[];
  excluded_banner_statuses?: string[];
  ad_group_statuses?: string[];
  excluded_ad_group_statuses?: string[];
  ad_group_ids?: number[];
  excluded_ad_group_ids?: number[];
  package_ids?: number[];
  excluded_package_ids?: number[];
  sort_by?: string;
  direction?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface VkAdsStatisticsDayResult {
  items: Array<{
    id: number;
    userId?: number;
    total: Record<string, unknown>;
  }>;
  total: Record<string, unknown>;
  limit: number;
  offset: number;
  count: number;
}

export type VkAdsFastStatisticsResource =
  | "banners"
  | "campaigns"
  | "ad_plans"
  | "users";

export interface VkAdsFastStatisticsResult {
  lastSeen: {
    timestamp: number;
    string: string;
    ago: number;
  };
  items: Array<{
    id: string;
    timestamp: number;
    clicks: number[];
    shows: number[];
  }>;
}

export interface VkAdsV2StatisticsInput {
  resource: VkAdsStatisticsResource;
  date_from: string;
  date_to: string;
  ids: number[];
  attribution?: "conversion" | "impression";
}

export interface VkAdsV2GeneralStatisticsInput
  extends VkAdsV2StatisticsInput {
  granularity: "day" | "summary";
  metrics?: string[];
}

export interface VkAdsV2ConversionStatisticsInput
  extends VkAdsV2StatisticsInput {
  conversion_types?: Array<"postview" | "postclick" | "total">;
}

export interface VkAdsV2StatisticsResult {
  items: Array<{
    id: number;
    total: Record<string, unknown>;
    rows?: Array<Record<string, unknown>>;
  }>;
  total: Record<string, unknown>;
}

export type VkAdsOfflineConversionStatisticsResource =
  | "users"
  | "ad_groups"
  | "ad_plans";

export interface VkAdsOfflineConversionStatisticsInput {
  resource: VkAdsOfflineConversionStatisticsResource;
  granularity: "day" | "summary";
  date_from: string;
  date_to: string;
  ids: number[];
}

export interface VkAdsOfflineConversionStatisticsResult {
  items: VkAdsV2StatisticsResult["items"];
  source: "day" | "summary" | "day_fallback";
}

export interface VkAdsLeadForm {
  id: number;
  name: string;
  status?: number;
  firstScreenType?: "compact" | "long_text" | "award";
  title?: string;
  description?: string;
  longDescription?: string;
  companyTitle?: string;
  logoId?: string | null;
  award?: Record<string, unknown>;
  gradient?: number;
  contactFields?: string[];
  resultInfo?: Record<string, unknown>;
  agreement?: Record<string, unknown>;
  notifications?: Array<Record<string, unknown>>;
  pages?: Array<Record<string, unknown>>;
  requiredAnswers?: boolean;
  mainColor?: string;
  mainImageId?: string | null;
  leadsCount?: number;
}

export interface ListVkAdsLeadFormsInput {
  limit?: number;
  offset?: number;
  adPlanIds?: number[];
  adGroupIds?: number[];
  bannerIds?: number[];
  query?: string;
  sorting?: string[];
  includeActiveAdPlanIds?: boolean;
}

export interface VkAdsLeadFormsPage {
  count: number;
  offset: number;
  limit: number;
  items: VkAdsLeadForm[];
}

export interface CreateVkAdsLeadFormInput {
  name: string;
  first_screen_type: "compact" | "long_text" | "award";
  title: string;
  description?: string;
  long_description?: string;
  company_title: string;
  logo_id: string;
  award?: Record<string, unknown>;
  gradient?: number;
  contact_fields: string[];
  result_info: Record<string, unknown>;
  agreement: Record<string, unknown>;
  notifications?: Array<Record<string, unknown>>;
  pages?: Array<Record<string, unknown>>;
  required_answers?: boolean;
  main_color?: string;
  main_image_id?: string;
}

export type UpdateVkAdsLeadFormInput =
  Partial<CreateVkAdsLeadFormInput>;

export interface VkAdsSurvey {
  id: number;
  name: string;
  status?: number;
  firstScreenType?: string;
  title?: string;
  description?: string;
  companyTitle?: string;
  logoId?: string | null;
  gradient?: number;
  resultInfo?: Record<string, unknown>;
  pages?: Array<Record<string, unknown>>;
  respondentsCount?: number;
}

export interface ListVkAdsSurveysInput {
  limit?: number;
  offset?: number;
  adPlanIds?: number[];
  adGroupIds?: number[];
  bannerIds?: number[];
  query?: string;
  sorting?: string[];
  includeActiveAdPlanIds?: boolean;
}

export interface VkAdsSurveysPage {
  count: number;
  offset: number;
  limit: number;
  items: VkAdsSurvey[];
}

export interface CreateVkAdsSurveyInput {
  name: string;
  first_screen_type: string;
  title: string;
  description?: string;
  company_title: string;
  result_info: Record<string, unknown>;
  pages: Array<Record<string, unknown>>;
  logo_id: string;
  gradient: number;
}

export type UpdateVkAdsSurveyInput =
  Partial<CreateVkAdsSurveyInput>;

export interface ListVkAdsRespondentsInput
  extends VkAdsPaginationInput {
  surveyIds?: number[];
  adPlanIds?: number[];
  adGroupIds?: number[];
  bannerIds?: number[];
  createdAtFrom?: string;
  createdAtTo?: string;
  sorting?: string[];
}

export interface VkAdsRespondent {
  id: number | string;
  surveyId: number;
  surveyName?: string;
  adPlanId?: number | null;
  adGroupId?: number | null;
  bannerId?: number | null;
  createdAt: string;
}

export interface VkAdsRespondentsPage {
  count: number;
  offset: number;
  limit: number;
  items: VkAdsRespondent[];
}

export interface VkAdsSubscription {
  id: number;
  resource: string;
  callbackUrl: string;
}

export interface VkAdsSubscriptionsPage {
  count: number;
  offset: number;
  limit: number;
  items: VkAdsSubscription[];
}

export type CreateVkAdsRemarketingCounterInput =
  | {
      name: string;
      url: string;
      email: string;
      password: string;
    }
  | {
      counter_id: number;
      name: string;
      flags?: string[];
    };

export interface VkAdsGoal {
  goal: string;
  description: string;
  id?: number;
  counterId?: number;
  counterName?: string;
}

export interface VkAdsGoalsResult {
  categories: Record<string, VkAdsGoal[]>;
}

export interface VkAdsRemarketingInAppEvent {
  id: number;
  name: string;
  categoryId?: number;
}

export interface VkAdsRemarketingInAppTracker {
  id: number;
  name: string;
  events: VkAdsRemarketingInAppEvent[];
}

export interface VkAdsRemarketingInAppEventSource {
  appId: number;
  appName: string;
  platform: string;
  status: string;
  trackers: VkAdsRemarketingInAppTracker[];
}

export interface ListVkAdsRemarketingInAppEventsInput
  extends VkAdsPaginationInput {
  urlObjectId?: string;
}

export interface VkAdsRemarketingInAppEventsResult {
  count: number;
  offset: number;
  items: VkAdsRemarketingInAppEventSource[];
}

export interface VkAdsLocalGeoRegion {
  lat: number;
  lng: number;
  radius: number;
  label: string;
  address: string;
}

export interface VkAdsLocalGeo {
  id: number;
  name: string;
  regions: VkAdsLocalGeoRegion[];
}

export interface VkAdsLocalGeosResult {
  items: VkAdsLocalGeo[];
}

export interface VkAdsRemarketingPricelist {
  id: number;
  name: string;
  status?: string;
  sourceType?: string;
}

export interface VkAdsRemarketingPricelistsResult {
  count: number;
  offset: number;
  items: VkAdsRemarketingPricelist[];
}

export interface CreateVkAdsRemarketingPricelistInput {
  name: string;
  status: "active" | "blocked";
  source_type:
    | "api"
    | "url"
    | "ozon_api"
    | "wildberries";
  export_url?: string;
  remove_utm_tags?: boolean;
  refresh_period?: number;
  credentials?: {
    client_id?: string;
    api_key?: string;
  };
}

export type VkAdsOfferBatchOperation =
  | {
      method: "PUT";
      data: Record<string, unknown> & { id: string };
    }
  | {
      method: "DELETE";
      data: { id: string };
    };

export interface VkAdsOfferBatchTask {
  id: number;
  status: string;
  errorCount: number;
  feedFailureCount: number;
  offerErrorCount: number;
  offerWarningCount: number;
}

export interface CreateVkAdsLocalGeoInput {
  name: string;
  regions: VkAdsLocalGeoRegion[];
}

export type UpdateVkAdsLocalGeoInput =
  CreateVkAdsLocalGeoInput;

export interface CreateVkAdsAdGroupInput {
  name: string;
  package_id: number;
  ad_plan_id?: number;
  status?: VkAdsAdPlanStatus;
  age_restrictions?: string;
  audit_pixels?: Array<Record<string, unknown>>;
  autobidding_mode?: "max_goals";
  banner_uniq_shows_limit?: number;
  banners?: Array<Record<string, unknown>>;
  budget_limit?: VkAdsDecimalInput;
  budget_limit_day?: VkAdsDecimalInput;
  date_end?: string;
  date_start?: string;
  dynamic_banners_use_storelink?: boolean;
  dynamic_without_remarketing?: boolean;
  enable_offline_goals?: boolean;
  enable_utm?: boolean;
  language?: "ru" | "en";
  marketplace_app_client_id?: string;
  max_price?: VkAdsDecimalInput;
  objective?: string;
  price?: VkAdsDecimalInput;
  priced_goal?: Record<string, unknown>;
  pricelist_id?: number;
  targetings?: Record<string, unknown>;
  uniq_shows_limit?: number;
  uniq_shows_period?: "day" | "week" | "month" | "eternity";
  utm?: string;
  not_ad?: boolean;
  [packageField: string]: unknown;
}

export interface CreateVkAdsAdGroupResult {
  id: number;
  bannerIds: number[];
}

export type UpdateVkAdsAdGroupInput = Partial<
  Omit<CreateVkAdsAdGroupInput, "banners">
>;

type VkAdsDecimalInput = number | string;

export interface CreateVkAdsAdPlanInput {
  name: string;
  campaigns: Array<Record<string, unknown>>;
  status?: VkAdsAdPlanStatus;
  autobidding_mode?: "max_goals";
  budget_limit?: VkAdsDecimalInput;
  budget_limit_day?: VkAdsDecimalInput;
  date_start?: string;
  date_end?: string;
  max_price?: VkAdsDecimalInput;
  objective?: string;
  priced_goal?: Record<string, unknown>;
  pricelist_id?: number;
  enable_offline_goals?: boolean;
  enable_utm?: boolean;
}

export interface CreateVkAdsAdPlanResult {
  id: number;
}

export type UpdateVkAdsAdPlanInput =
  Partial<CreateVkAdsAdPlanInput>;

export interface MassUpdateVkAdsAdPlanInput {
  id: number;
  status?: VkAdsAdPlanStatus;
  budget_limit?: VkAdsDecimalInput;
  budget_limit_day?: VkAdsDecimalInput;
  date_start?: string;
  date_end?: string;
  max_price?: VkAdsDecimalInput;
}

export interface MassUpdateVkAdsAdGroupInput {
  id: number;
  status?: VkAdsAdPlanStatus;
  max_price?: VkAdsDecimalInput;
}

interface VkAdsAccessTokenProvider {
  getAccessToken(): Promise<string>;
  refreshAfterAuthenticationFailure(
    rejectedAccessToken: string,
  ): Promise<string>;
}

interface VkAdsApiClientOptions {
  baseUrl?: string;
  v2BaseUrl?: string;
  v1BaseUrl?: string;
  fetchImpl?: FetchLike;
}

function createProviderApiError(
  payload: unknown,
  httpStatus: number,
): VkAdsApiError {
  const providerError = normalizeProviderError(
    payload,
    "api_request_failed",
  );

  return new VkAdsApiError(
    `VK Ads rejected the API request with code ${providerError.code}.${formatProviderErrorSuffix(providerError)}`,
    providerError.code,
    httpStatus,
    providerError.fieldIssues,
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new VkAdsApiError(
      "VK Ads returned a non-JSON API response.",
      "invalid_api_response",
      response.status,
    );
  }
}

function retryDelayMilliseconds(response: Response): number {
  const retryAfter = response.headers.get("retry-after");

  if (retryAfter === null) {
    return DEFAULT_READ_RETRY_DELAY_MS;
  }

  if (/^\d+(?:\.\d+)?$/u.test(retryAfter)) {
    return Math.min(
      Number(retryAfter) * 1_000,
      MAX_READ_RETRY_DELAY_MS,
    );
  }

  const retryAt = Date.parse(retryAfter);

  if (Number.isNaN(retryAt)) {
    return DEFAULT_READ_RETRY_DELAY_MS;
  }

  return Math.min(
    Math.max(0, retryAt - Date.now()),
    MAX_READ_RETRY_DELAY_MS,
  );
}

async function wait(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalizeRemarketingUsersList(
  item: z.infer<typeof remarketingUsersListSchema>,
): VkAdsRemarketingUsersList {
  return {
    id: item.id,
    name: item.name,
    status: item.status,
    type: item.type,
    base: item.base,
    entriesCount: item.entries_count,
    idsCount: item.ids_count,
    ...(item.matched_ids_count === undefined
      ? {}
      : { matchedIdsCount: item.matched_ids_count }),
    ...(item.has_history === undefined
      ? {}
      : { hasHistory: item.has_history }),
  };
}

function normalizeSegment(
  item: z.infer<typeof segmentSchema>,
): VkAdsSegment {
  return {
    id: item.id,
    name: item.name,
    passCondition: item.pass_condition,
    ...(item.relations_count === undefined
      ? {}
      : { relationsCount: item.relations_count }),
  };
}

function normalizeVkGroup(
  item: z.infer<typeof vkGroupSchema>,
): VkAdsVkGroup {
  return {
    id: item.id,
    name: item.name,
    objectId: item.object_id,
    shortname: item.shortname,
    url: item.url,
  };
}

function normalizeSegmentRelation(
  item: z.infer<typeof segmentRelationSchema>,
): VkAdsSegmentRelation {
  return {
    id: item.id,
    objectType: item.object_type,
    objectId: item.object_id,
    ...(item.params == null ? {} : { params: item.params }),
  };
}

function normalizeSharingKeySource(
  item: z.infer<typeof sharingKeySourceSchema>,
): VkAdsSharingKeySource {
  return {
    objectType: item.object_type,
    objectId: item.object_id,
    ...(item.params === undefined ? {} : { params: item.params }),
  };
}

function normalizeSharingKey(
  item: z.infer<typeof sharingKeySchema>,
): VkAdsSharingKey {
  return {
    sharingKey: item.sharing_key,
    sources: item.sources.map(normalizeSharingKeySource),
    ...(item.price === undefined
      ? {}
      : { price: String(item.price) }),
    ...(item.is_marketplace === undefined
      ? {}
      : { isMarketplace: item.is_marketplace }),
    ...(item.send_email === undefined
      ? {}
      : { sendEmail: item.send_email }),
    ...(item.payment_type === undefined
      ? {}
      : { paymentType: item.payment_type }),
    ...(item.type === undefined ? {} : { type: item.type }),
    userCount: item.users?.length ?? 0,
  };
}

function normalizeLeadForm(
  item: z.infer<typeof leadFormSchema>,
): VkAdsLeadForm {
  return {
    id: item.id,
    name: item.name,
    ...(item.status === undefined ? {} : { status: item.status }),
    ...(item.first_screen_type === undefined
      ? {}
      : { firstScreenType: item.first_screen_type }),
    ...(item.title === undefined ? {} : { title: item.title }),
    ...(item.description === undefined
      ? {}
      : { description: item.description }),
    ...(item.long_description === undefined
      ? {}
      : { longDescription: item.long_description }),
    ...(item.company_title === undefined
      ? {}
      : { companyTitle: item.company_title }),
    ...(item.logo_id === undefined ? {} : { logoId: item.logo_id }),
    ...(item.award === undefined ? {} : { award: item.award }),
    ...(item.gradient === undefined
      ? {}
      : { gradient: item.gradient }),
    ...(item.contact_fields === undefined
      ? {}
      : { contactFields: item.contact_fields }),
    ...(item.result_info === undefined
      ? {}
      : { resultInfo: item.result_info }),
    ...(item.agreement === undefined
      ? {}
      : { agreement: item.agreement }),
    ...(item.notifications === undefined
      ? {}
      : { notifications: item.notifications }),
    ...(item.pages === undefined ? {} : { pages: item.pages }),
    ...(item.required_answers === undefined
      ? {}
      : { requiredAnswers: item.required_answers }),
    ...(item.main_color === undefined
      ? {}
      : { mainColor: item.main_color }),
    ...(item.main_image_id === undefined
      ? {}
      : { mainImageId: item.main_image_id }),
    ...(item.leads_count === undefined
      ? {}
      : { leadsCount: item.leads_count }),
  };
}

function normalizeSurvey(
  item: z.infer<typeof surveySchema>,
): VkAdsSurvey {
  return {
    id: item.id,
    name: item.name,
    ...(item.status === undefined ? {} : { status: item.status }),
    ...(item.first_screen_type === undefined
      ? {}
      : { firstScreenType: item.first_screen_type }),
    ...(item.title === undefined ? {} : { title: item.title }),
    ...(item.description === undefined
      ? {}
      : { description: item.description }),
    ...(item.company_title === undefined
      ? {}
      : { companyTitle: item.company_title }),
    ...(item.logo_id === undefined && item.logo === undefined
      ? {}
      : { logoId: item.logo_id ?? item.logo?.id ?? null }),
    ...(item.gradient === undefined
      ? {}
      : { gradient: item.gradient }),
    ...(item.result_info === undefined
      ? {}
      : { resultInfo: item.result_info }),
    ...(item.pages === undefined ? {} : { pages: item.pages }),
    ...(item.respondents_count === undefined
      ? {}
      : { respondentsCount: item.respondents_count }),
  };
}

function normalizeSubscription(
  item: z.infer<typeof subscriptionSchema>,
): VkAdsSubscription {
  return {
    id: item.id,
    resource: item.resource,
    callbackUrl: item.callback_url,
  };
}

function normalizeOrdUser(
  item: z.infer<typeof ordUserSchema>,
): VkAdsOrdUser {
  return {
    ...(item.name === undefined ? {} : { name: item.name }),
    ...(item.phone === undefined ? {} : { phone: item.phone }),
    ...(item.inn === undefined ? {} : { inn: item.inn }),
    ...(item.foreign_epayment_method === undefined
      ? {}
      : {
          foreign_epayment_method:
            item.foreign_epayment_method,
        }),
    ...(item.foreign_oksm_country_code === undefined
      ? {}
      : {
          foreign_oksm_country_code:
            item.foreign_oksm_country_code,
        }),
    ...(item.foreign_registration_number === undefined
      ? {}
      : {
          foreign_registration_number:
            item.foreign_registration_number,
        }),
    ...(item.foreign_inn === undefined
      ? {}
      : { foreign_inn: item.foreign_inn }),
    ...(item.site === undefined ? {} : { site: item.site }),
  };
}

export class VkAdsApiClient {
  private readonly v3BaseUrl: string;
  private readonly v2BaseUrl: string;
  private readonly v1BaseUrl: string;
  private readonly fetchImpl: FetchLike;

  constructor(
    private readonly tokenProvider: VkAdsAccessTokenProvider,
    options: VkAdsApiClientOptions = {},
  ) {
    this.v3BaseUrl = (options.baseUrl ?? VK_ADS_API_V3_BASE_URL).replace(
      /\/$/u,
      "",
    );
    this.v2BaseUrl = (options.v2BaseUrl ?? VK_ADS_API_V2_BASE_URL).replace(
      /\/$/u,
      "",
    );
    this.v1BaseUrl = (options.v1BaseUrl ?? VK_ADS_API_V1_BASE_URL).replace(
      /\/$/u,
      "",
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getCurrentUser(): Promise<VkAdsCurrentUser> {
    const parsed = await this.requestValidated(
      "GET",
      new URL(`${this.v3BaseUrl}/user.json`),
      currentUserSchema,
      "VK Ads returned an invalid current-user object.",
    );
    const user: VkAdsCurrentUser = { id: parsed.id };

    if (parsed.status !== undefined) {
      user.status = parsed.status;
    }

    if (parsed.currency !== undefined) {
      user.currency = parsed.currency;
    }

    if (parsed.types !== undefined) {
      user.types = parsed.types;
    }

    return user;
  }

  async getUserProfile(
    version: VkAdsUserApiVersion,
  ): Promise<VkAdsUserProfile> {
    const baseUrl =
      version === "v2" ? this.v2BaseUrl : this.v3BaseUrl;
    const parsed = await this.requestValidated(
      "GET",
      new URL(`${baseUrl}/user.json`),
      userProfileSchema,
      "VK Ads returned an invalid user profile.",
    );

    return {
      id: parsed.id,
      ...(parsed.status === undefined
        ? {}
        : { status: parsed.status }),
      ...(parsed.language === undefined
        ? {}
        : { language: parsed.language }),
      ...(parsed.currency === undefined
        ? {}
        : { currency: parsed.currency }),
      ...(parsed.info_currency === undefined
        ? {}
        : { infoCurrency: parsed.info_currency }),
      ...(parsed.timezone === undefined
        ? {}
        : { timezone: parsed.timezone }),
      ...(parsed.country === undefined
        ? {}
        : { country: parsed.country }),
      ...(parsed.types === undefined ? {} : { types: parsed.types }),
    };
  }

  async updateUserLanguage(
    version: VkAdsUserApiVersion,
    language: "ru" | "en",
  ): Promise<VkAdsUserProfile> {
    const baseUrl =
      version === "v2" ? this.v2BaseUrl : this.v3BaseUrl;
    const parsed = await this.requestValidated(
      "POST",
      new URL(`${baseUrl}/user.json`),
      userProfileSchema,
      "VK Ads returned an invalid updated user profile.",
      { language },
    );

    return {
      id: parsed.id,
      ...(parsed.status === undefined
        ? {}
        : { status: parsed.status }),
      ...(parsed.language === undefined
        ? {}
        : { language: parsed.language }),
      ...(parsed.currency === undefined
        ? {}
        : { currency: parsed.currency }),
      ...(parsed.info_currency === undefined
        ? {}
        : { infoCurrency: parsed.info_currency }),
      ...(parsed.timezone === undefined
        ? {}
        : { timezone: parsed.timezone }),
      ...(parsed.country === undefined
        ? {}
        : { country: parsed.country }),
      ...(parsed.types === undefined ? {} : { types: parsed.types }),
    };
  }

  async resolveUrl(url: string): Promise<VkAdsUrl> {
    const endpoint = new URL(`${this.v1BaseUrl}/urls/`);
    endpoint.searchParams.set("url", url);
    const parsed = await this.requestValidated(
      "GET",
      endpoint,
      resolvedUrlSchema,
      "VK Ads returned an invalid resolved URL.",
    );

    return {
      id: parsed.id,
      url,
      urlTypes: parsed.url_types,
      ...(parsed.has_goals === undefined
        ? {}
        : { hasGoals: parsed.has_goals }),
    };
  }

  async createUrl(url: string): Promise<{ id: number }> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(`${this.v2BaseUrl}/urls.json`),
      urlCreateResponseSchema,
      "VK Ads returned an invalid URL creation response.",
      { url },
    );

    return { id: parsed.id };
  }

  async getUrl(id: number): Promise<VkAdsUrl> {
    const parsed = await this.requestValidated(
      "GET",
      new URL(`${this.v2BaseUrl}/urls/${id}.json`),
      urlSchema,
      "VK Ads returned an invalid URL object.",
    );

    return {
      id: parsed.id,
      url: parsed.url,
      urlTypes: parsed.url_types,
      ...(parsed.has_goals === undefined
        ? {}
        : { hasGoals: parsed.has_goals }),
    };
  }

  async getUrls(ids: number[]): Promise<VkAdsUrl[]> {
    const parsed = await this.requestValidated(
      "GET",
      new URL(`${this.v2BaseUrl}/urls/${ids.join(",")}.json`),
      urlsResponseSchema,
      "VK Ads returned an invalid URL collection.",
    );

    const parsedEnvelope = urlsSchema.safeParse(parsed);
    const items = parsedEnvelope.success
      ? parsedEnvelope.data.items
      : [urlSchema.parse(parsed)];

    return items.map((item) => ({
      id: item.id,
      url: item.url,
      urlTypes: item.url_types,
      ...(item.has_goals === undefined
        ? {}
        : { hasGoals: item.has_goals }),
    }));
  }

  async getMobileStoreApp(
    store: VkAdsMobileStore,
    identifier: string,
  ): Promise<VkAdsMobileStoreApp> {
    const resource = store === "apple" ? "apple_apps" : "google_apps";
    const parsed = await this.requestValidated(
      "GET",
      new URL(
        `${this.v2BaseUrl}/${resource}/${encodeURIComponent(identifier)}.json`,
      ),
      mobileStoreAppSchema,
      "VK Ads returned an invalid mobile-store application.",
    );

    return {
      id: parsed.id,
      identifier: parsed.name,
      status: parsed.status,
      title: parsed.title,
      ...(parsed.content_rating === undefined
        ? {}
        : { contentRating: parsed.content_rating }),
      ...(parsed.type === undefined ? {} : { type: parsed.type }),
      ...(parsed.category_id === undefined
        ? {}
        : { categoryId: parsed.category_id }),
    };
  }

  async refreshMobileStoreApp(
    store: VkAdsMobileStore,
    identifier: string,
  ): Promise<VkAdsMobileStoreApp> {
    const resource = store === "apple" ? "apple_apps" : "google_apps";
    const parsed = await this.requestValidated(
      "POST",
      new URL(
        `${this.v2BaseUrl}/${resource}/${encodeURIComponent(identifier)}.json`,
      ),
      mobileStoreAppSchema,
      "VK Ads returned an invalid refreshed mobile-store application.",
    );

    return {
      id: parsed.id,
      identifier: parsed.name,
      status: parsed.status,
      title: parsed.title,
      ...(parsed.content_rating === undefined
        ? {}
        : { contentRating: parsed.content_rating }),
      ...(parsed.type === undefined ? {} : { type: parsed.type }),
      ...(parsed.category_id === undefined
        ? {}
        : { categoryId: parsed.category_id }),
    };
  }

  async listMobileAppsForSkAd(): Promise<
    Array<Record<string, unknown>>
  > {
    const url = new URL(`${this.v1BaseUrl}/mobile_app_users.json`);
    url.searchParams.set(
      "fields",
      "rb_mobile_app_id,sk_ad_network_ids",
    );
    url.searchParams.set("limit", "50");
    const parsed = await this.requestValidated(
      "GET",
      url,
      referenceCollectionSchema,
      "VK Ads returned invalid mobile applications for SKAdNetwork.",
    );

    return parsed.items;
  }

  async transferSkAdNetworkIds(
    action: "share" | "withdraw",
    appId: number,
    count: number,
    username: string,
  ): Promise<void> {
    await this.requestSuccessfulEmpty(
      "POST",
      new URL(
        `${this.v2BaseUrl}/apple_apps/${appId}/sk_ad_network_ids/${action}.json`,
      ),
      { count, username },
    );
  }

  async getOrdUser(): Promise<VkAdsOrdUser> {
    const parsed = await this.requestValidated(
      "GET",
      new URL(`${this.v2BaseUrl}/ord_user.json`),
      ordUserSchema,
      "VK Ads returned invalid ORD user data.",
    );

    return normalizeOrdUser(parsed);
  }

  async updateOrdUser(
    input: VkAdsOrdUser,
  ): Promise<VkAdsOrdUser> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(`${this.v2BaseUrl}/ord_user.json`),
      ordUserSchema,
      "VK Ads returned invalid updated ORD user data.",
      input,
    );

    return normalizeOrdUser(parsed);
  }

  async listUserGeo(
    input: {
      limit?: number;
      offset?: number;
      ids?: number[];
      query?: string;
    } = {},
  ): Promise<VkAdsUserGeoPage> {
    const url = new URL(`${this.v2BaseUrl}/user_geo.json`);
    appendPagination(url.searchParams, input);

    if (input.ids !== undefined) {
      url.searchParams.set("_id__in", input.ids.join(","));
    }

    if (input.query !== undefined) {
      url.searchParams.set("_q", input.query);
    }

    const parsed = await this.requestValidated(
      "GET",
      url,
      userGeoPageSchema,
      "VK Ads returned an invalid user-geo page.",
    );

    return {
      count: parsed.count,
      offset: parsed.offset,
      limit: parsed.limit ?? input.limit ?? 20,
      items: parsed.items.map(({ id, name }) => ({ id, name })),
    };
  }

  async listReferenceData(
    resource: VkAdsReferenceCollectionResource,
    input: VkAdsReferenceCollectionInput = {},
  ): Promise<VkAdsReferenceCollectionResult> {
    const endpoints: Record<
      VkAdsReferenceCollectionResource,
      string
    > = {
      banner_fields: `${this.v2BaseUrl}/banner_fields.json`,
      banner_patterns: `${this.v2BaseUrl}/banner_patterns.json`,
      currencies: `${this.v2BaseUrl}/currencies.json`,
      in_app_event_categories:
        `${this.v1BaseUrl}/inapp_event_categories.json`,
      mobile_apps: `${this.v1BaseUrl}/mobile_app_users.json`,
      mobile_categories: `${this.v2BaseUrl}/mobile_categories.json`,
      mobile_os: `${this.v2BaseUrl}/mobile_os.json`,
      mobile_operators: `${this.v2BaseUrl}/mobile_operators.json`,
      mobile_types: `${this.v2BaseUrl}/mobile_types.json`,
      mobile_vendors: `${this.v2BaseUrl}/mobile_vendors.json`,
      packages: `${this.v2BaseUrl}/packages.json`,
      packages_pads: `${this.v2BaseUrl}/packages_pads.json`,
      pads_trees: `${this.v2BaseUrl}/pads_trees.json`,
      regions: `${this.v2BaseUrl}/regions.json`,
      transaction_groups:
        `${this.v2BaseUrl}/billing/transaction_groups.json`,
    };
    const url = new URL(endpoints[resource]);

    if (input.ids !== undefined) {
      url.searchParams.set("_id__in", input.ids.join(","));
    }

    if (resource === "packages") {
      url.searchParams.set(
        "fields",
        "id,name,status,options",
      );
    }

    const parsed = await this.requestValidated(
      "GET",
      url,
      referenceCollectionSchema,
      `VK Ads returned invalid ${resource} reference data.`,
    );
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 50;

    return {
      count: parsed.count ?? parsed.items.length,
      offset,
      limit,
      items: parsed.items.slice(offset, offset + limit),
    };
  }

  async getReferenceMap(
    resource: VkAdsReferenceMapResource,
  ): Promise<Record<string, unknown>> {
    const endpoints: Record<VkAdsReferenceMapResource, string> = {
      targetings_tree: `${this.v2BaseUrl}/targetings_tree.json`,
      throttling: `${this.v2BaseUrl}/throttling.json`,
    };

    return await this.requestValidated(
      "GET",
      new URL(endpoints[resource]),
      referenceMapSchema,
      `VK Ads returned invalid ${resource} reference data.`,
    );
  }

  async listLeadForms(
    input: ListVkAdsLeadFormsInput = {},
  ): Promise<VkAdsLeadFormsPage> {
    const url = new URL(`${this.v1BaseUrl}/lead_ads/lead_forms.json`);

    if (input.limit !== undefined) {
      url.searchParams.set("limit", String(input.limit));
    }

    if (input.offset !== undefined) {
      url.searchParams.set("offset", String(input.offset));
    }

    for (const [name, values] of [
      ["_ad_plan_ids__in", input.adPlanIds],
      ["_ad_group_ids__in", input.adGroupIds],
      ["_banner_ids__in", input.bannerIds],
    ] as const) {
      if (values !== undefined) {
        url.searchParams.set(name, values.join(","));
      }
    }

    if (input.query !== undefined) {
      url.searchParams.set("q", input.query);
    }

    if (input.sorting !== undefined) {
      url.searchParams.set("sorting", input.sorting.join(","));
    }

    if (input.includeActiveAdPlanIds !== undefined) {
      url.searchParams.set(
        "get_active_form_ad_plans",
        input.includeActiveAdPlanIds ? "1" : "0",
      );
    }

    const parsed = await this.requestValidated(
      "GET",
      url,
      leadFormsPageSchema,
      "VK Ads returned an invalid lead-forms page.",
    );

    return {
      count: parsed.count,
      offset: parsed.offset,
      limit: parsed.limit,
      items: parsed.items.map(normalizeLeadForm),
    };
  }

  async getLeadForm(id: number): Promise<VkAdsLeadForm> {
    const parsed = await this.requestValidated(
      "GET",
      new URL(`${this.v1BaseUrl}/lead_ads/lead_forms/${id}.json`),
      leadFormSchema,
      "VK Ads returned an invalid lead-form response.",
    );

    return normalizeLeadForm(parsed);
  }

  async createLeadForm(
    input: CreateVkAdsLeadFormInput,
  ): Promise<{ id: number }> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(`${this.v1BaseUrl}/lead_ads/lead_forms.json`),
      leadFormCreateResponseSchema,
      "VK Ads returned an invalid lead-form creation response.",
      input,
    );

    return { id: parsed.id };
  }

  async uploadLeadFormLogo(
    file: Blob,
    filename: string,
  ): Promise<VkAdsLeadFormImageUploadResult> {
    const form = new FormData();
    form.append("file", file, filename);
    const parsed = await this.requestMultipartValidated(
      new URL(`${this.v1BaseUrl}/lead_ads/upload_image/logo`),
      leadFormImageUploadResponseSchema,
      "VK Ads returned an invalid lead-form logo response.",
      form,
    );

    return {
      id: parsed.id,
      variants: Object.keys(parsed.variants),
    };
  }

  async updateLeadForm(
    id: number,
    input: UpdateVkAdsLeadFormInput,
  ): Promise<VkAdsLeadForm> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(`${this.v1BaseUrl}/lead_ads/lead_forms/${id}.json`),
      leadFormSchema,
      "VK Ads returned an invalid lead-form update response.",
      input,
    );

    return normalizeLeadForm(parsed);
  }

  async copyLeadForm(
    id: number,
    name?: string,
  ): Promise<VkAdsLeadForm> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(`${this.v1BaseUrl}/lead_ads/lead_forms/${id}/copy`),
      leadFormSchema,
      "VK Ads returned an invalid lead-form copy response.",
      name === undefined ? {} : { name },
    );

    return normalizeLeadForm(parsed);
  }

  async setLeadFormsArchived(
    ids: number[],
    archived: boolean,
  ): Promise<VkAdsLeadForm[]> {
    const url = new URL(
      `${this.v1BaseUrl}/lead_ads/lead_forms/${
        archived ? "archive" : "unarchive"
      }`,
    );
    url.searchParams.set("_form_ids__in", ids.join(","));
    const parsed = await this.requestValidated(
      "POST",
      url,
      leadFormsMutationResponseSchema,
      "VK Ads returned an invalid lead-form archival response.",
    );

    return parsed.map(normalizeLeadForm);
  }

  async listLeads(
    input: ListVkAdsLeadsInput = {},
  ): Promise<VkAdsLeadsPage> {
    const url = new URL(`${this.v1BaseUrl}/lead_ads/leads.json`);
    appendPagination(url.searchParams, input);
    const listFilters = [
      ["formIds", "_form_ids__in"],
      ["adPlanIds", "_ad_plan_ids__in"],
      ["adGroupIds", "_ad_group_ids__in"],
      ["bannerIds", "_banner_ids__in"],
    ] as const;

    for (const [key, queryName] of listFilters) {
      const values = input[key];

      if (values !== undefined) {
        url.searchParams.set(queryName, values.join(","));
      }
    }

    if (input.createdAtFrom !== undefined) {
      url.searchParams.set("_created_at__gte", input.createdAtFrom);
    }

    if (input.createdAtTo !== undefined) {
      url.searchParams.set("_created_at__lte", input.createdAtTo);
    }

    const parsed = await this.requestValidated(
      "GET",
      url,
      leadsPageSchema,
      "VK Ads returned an invalid leads page.",
    );

    return {
      count: parsed.count,
      offset: parsed.offset,
      limit: parsed.limit,
      items: parsed.items.map((item) => ({
        id: item.id,
        formId: item.form_id,
        formName: item.form_name,
        ...(item.ad_plan_id === undefined
          ? {}
          : { adPlanId: item.ad_plan_id }),
        ...(item.ad_group_id === undefined
          ? {}
          : { adGroupId: item.ad_group_id }),
        ...(item.banner_id === undefined
          ? {}
          : { bannerId: item.banner_id }),
        createdAt: item.created_at,
      })),
    };
  }

  async exportLeadFormLeads(
    formId: number,
    input: ExportVkAdsLeadFormLeadsInput,
  ): Promise<VkAdsLeadFormLeadsExport> {
    const url = new URL(
      `${this.v1BaseUrl}/lead_ads/lead_forms/${formId}/leads.${input.format}`,
    );
    const listFilters = [
      ["adPlanIds", "_ad_plan_id__in"],
      ["adGroupIds", "_ad_group_id__in"],
      ["bannerIds", "_banner_id__in"],
    ] as const;

    for (const [key, queryName] of listFilters) {
      const values = input[key];

      if (values !== undefined) {
        url.searchParams.set(queryName, values.join(","));
      }
    }

    if (input.createdAtFrom !== undefined) {
      url.searchParams.set("_created_at__gte", input.createdAtFrom);
    }

    if (input.createdAtTo !== undefined) {
      url.searchParams.set("_created_at__lte", input.createdAtTo);
    }

    return await this.requestBinary(url);
  }

  async sendTestLead(formId: number): Promise<VkAdsTestLeadResult> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(
        `${this.v1BaseUrl}/lead_ads/lead_forms/${formId}/send_test_lead`,
      ),
      testLeadResponseSchema,
      "VK Ads returned an invalid test-lead response.",
    );

    return {
      processed: parsed.is_operation_processed,
      secondsBeforeNextSending: parsed.seconds_before_next_sending,
    };
  }

  async listSurveys(
    input: ListVkAdsSurveysInput = {},
  ): Promise<VkAdsSurveysPage> {
    const url = new URL(
      `${this.v1BaseUrl}/lead_ads/survey_forms.json`,
    );
    appendPagination(url.searchParams, input);

    for (const [name, values] of [
      ["_ad_plan_ids__in", input.adPlanIds],
      ["_ad_group_ids__in", input.adGroupIds],
      ["_banner_ids__in", input.bannerIds],
    ] as const) {
      if (values !== undefined) {
        url.searchParams.set(name, values.join(","));
      }
    }

    if (input.query !== undefined) {
      url.searchParams.set("q", input.query);
    }

    if (input.sorting !== undefined) {
      url.searchParams.set("sorting", input.sorting.join(","));
    }

    if (input.includeActiveAdPlanIds !== undefined) {
      url.searchParams.set(
        "get_active_form_ad_plans",
        input.includeActiveAdPlanIds ? "1" : "0",
      );
    }

    const parsed = await this.requestValidated(
      "GET",
      url,
      surveysPageSchema,
      "VK Ads returned an invalid surveys page.",
    );

    return {
      count: parsed.count,
      offset: parsed.offset,
      limit: parsed.limit,
      items: parsed.items.map(normalizeSurvey),
    };
  }

  async getSurvey(id: number): Promise<VkAdsSurvey> {
    const parsed = await this.requestValidated(
      "GET",
      new URL(
        `${this.v1BaseUrl}/lead_ads/survey_forms/${id}.json`,
      ),
      surveySchema,
      "VK Ads returned an invalid survey response.",
    );

    return normalizeSurvey(parsed);
  }

  async createSurvey(
    input: CreateVkAdsSurveyInput,
  ): Promise<{ id: number }> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(`${this.v1BaseUrl}/lead_ads/survey_forms.json`),
      surveyCreateResponseSchema,
      "VK Ads returned an invalid survey creation response.",
      input,
    );

    return { id: parsed.id };
  }

  async updateSurvey(
    id: number,
    input: UpdateVkAdsSurveyInput,
  ): Promise<VkAdsSurvey> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(
        `${this.v1BaseUrl}/lead_ads/survey_forms/${id}.json`,
      ),
      surveySchema,
      "VK Ads returned an invalid survey update response.",
      input,
    );

    return normalizeSurvey(parsed);
  }

  async copySurvey(
    id: number,
    name?: string,
  ): Promise<VkAdsSurvey> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(
        `${this.v1BaseUrl}/lead_ads/survey_forms/${id}/copy`,
      ),
      surveySchema,
      "VK Ads returned an invalid survey copy response.",
      name === undefined ? {} : { name },
    );

    return normalizeSurvey(parsed);
  }

  async setSurveysArchived(
    ids: number[],
    archived: boolean,
  ): Promise<VkAdsSurvey[]> {
    const url = new URL(
      `${this.v1BaseUrl}/lead_ads/survey_forms/${
        archived ? "archive" : "unarchive"
      }`,
    );
    url.searchParams.set("_form_ids__in", ids.join(","));
    const parsed = await this.requestValidated(
      "POST",
      url,
      surveysMutationResponseSchema,
      "VK Ads returned an invalid survey archival response.",
    );

    return parsed.map(normalizeSurvey);
  }

  async listRespondents(
    input: ListVkAdsRespondentsInput = {},
  ): Promise<VkAdsRespondentsPage> {
    const url = new URL(
      `${this.v1BaseUrl}/lead_ads/respondents.json`,
    );
    appendPagination(url.searchParams, input);

    for (const [name, values] of [
      ["_form_ids__in", input.surveyIds],
      ["_ad_plan_ids__in", input.adPlanIds],
      ["_ad_group_ids__in", input.adGroupIds],
      ["_banner_ids__in", input.bannerIds],
    ] as const) {
      if (values !== undefined) {
        url.searchParams.set(name, values.join(","));
      }
    }

    if (input.createdAtFrom !== undefined) {
      url.searchParams.set("_created_at__gte", input.createdAtFrom);
    }

    if (input.createdAtTo !== undefined) {
      url.searchParams.set("_created_at__lte", input.createdAtTo);
    }

    if (input.sorting !== undefined) {
      url.searchParams.set("sorting", input.sorting.join(","));
    }

    const parsed = await this.requestValidated(
      "GET",
      url,
      respondentsPageSchema,
      "VK Ads returned an invalid respondents page.",
    );

    return {
      count: parsed.count,
      offset: parsed.offset,
      limit: parsed.limit,
      items: parsed.items.map((item) => ({
        id: item.id,
        surveyId: item.survey_id ?? item.form_id!,
        ...(item.survey_name !== undefined
          ? { surveyName: item.survey_name }
          : item.form_name !== undefined
            ? { surveyName: item.form_name }
            : {}),
        ...(item.ad_plan_id === undefined
          ? {}
          : { adPlanId: item.ad_plan_id }),
        ...(item.ad_group_id === undefined
          ? {}
          : { adGroupId: item.ad_group_id }),
        ...(item.banner_id === undefined
          ? {}
          : { bannerId: item.banner_id }),
        createdAt: item.created_at,
      })),
    };
  }

  async exportSurveyRespondents(
    surveyId: number,
  ): Promise<VkAdsLeadFormLeadsExport> {
    return await this.requestBinary(
      new URL(
        `${this.v1BaseUrl}/lead_ads/survey_forms/${surveyId}/respondents.xlsx`,
      ),
    );
  }

  async listSubscriptions(
    input: VkAdsPaginationInput = {},
  ): Promise<VkAdsSubscriptionsPage> {
    const url = new URL(`${this.v3BaseUrl}/subscription.json`);
    appendPagination(url.searchParams, input);
    const parsed = await this.requestValidated(
      "GET",
      url,
      subscriptionsPageSchema,
      "VK Ads returned an invalid subscriptions page.",
    );

    return {
      count: parsed.count,
      offset: parsed.offset,
      limit: parsed.limit ?? input.limit ?? 20,
      items: parsed.items.map(normalizeSubscription),
    };
  }

  async createSubscription(
    resource: string,
    callbackUrl: string,
  ): Promise<{ id: number }> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(`${this.v3BaseUrl}/subscription.json`),
      subscriptionCreateResponseSchema,
      "VK Ads returned an invalid subscription creation response.",
      {
        resource,
        callback_url: callbackUrl,
      },
    );

    return { id: parsed.id };
  }

  async deleteSubscription(id: number): Promise<void> {
    await this.requestSuccessfulEmpty(
      "DELETE",
      new URL(`${this.v3BaseUrl}/subscription/${id}.json`),
    );
  }

  async listAdPlans(
    input: ListVkAdsAdPlansInput = {},
  ): Promise<VkAdsAdPlansPage> {
    const url = new URL(`${this.v2BaseUrl}/ad_plans.json`);
    url.searchParams.set("fields", "id,name,status");
    appendPagination(url.searchParams, input);

    if (input.status !== undefined) {
      url.searchParams.set("_status", input.status);
    }

    const parsed = await this.requestValidated(
      "GET",
      url,
      adPlansPageSchema,
      "VK Ads returned an invalid ad-plans page.",
    );

    return {
      count: parsed.count,
      offset: parsed.offset,
      items: parsed.items.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
      })),
    };
  }

  async getAdPlan(id: number): Promise<VkAdsAdPlan> {
    const url = new URL(`${this.v2BaseUrl}/ad_plans/${id}.json`);
    url.searchParams.set("fields", "id,name,status");

    const parsed = await this.requestValidated(
      "GET",
      url,
      adPlanSchema,
      "VK Ads returned an invalid ad-plan object.",
    );

    return {
      id: parsed.id,
      name: parsed.name,
      status: parsed.status,
    };
  }

  async listAdGroups(
    input: ListVkAdsAdGroupsInput = {},
  ): Promise<VkAdsAdGroupsPage> {
    const url = new URL(`${this.v2BaseUrl}/ad_groups.json`);
    url.searchParams.set(
      "fields",
      "id,name,status,ad_plan_id,package_id",
    );
    appendPagination(url.searchParams, input);

    if (input.id !== undefined) {
      url.searchParams.set("_id", String(input.id));
    }

    if (input.ids !== undefined) {
      url.searchParams.set("_id__in", input.ids.join(","));
    }

    if (input.status !== undefined) {
      url.searchParams.set("_status", input.status);
    }

    if (input.statusNot !== undefined) {
      url.searchParams.set("_status__ne", input.statusNot);
    }

    if (input.statuses !== undefined) {
      url.searchParams.set("_status__in", input.statuses.join(","));
    }

    const lastUpdatedFilters = [
      ["lastUpdatedLt", "_last_updated__lt"],
      ["lastUpdatedLte", "_last_updated__lte"],
      ["lastUpdatedGt", "_last_updated__gt"],
      ["lastUpdatedGte", "_last_updated__gte"],
    ] as const;

    for (const [key, queryName] of lastUpdatedFilters) {
      const value = input[key];

      if (value !== undefined) {
        url.searchParams.set(queryName, value);
      }
    }

    if (input.sorting !== undefined) {
      url.searchParams.set("sorting", input.sorting.join(","));
    }

    const parsed = await this.requestValidated(
      "GET",
      url,
      adGroupsPageSchema,
      "VK Ads returned an invalid ad-groups page.",
    );

    return {
      count: parsed.count,
      offset: parsed.offset,
      items: parsed.items.map((item) => ({
          id: item.id,
          name: item.name,
          status: item.status,
          adPlanId: item.ad_plan_id ?? 0,
          packageId: item.package_id,
      })),
    };
  }

  async getAdGroup(id: number): Promise<VkAdsAdGroup> {
    const url = new URL(`${this.v2BaseUrl}/ad_groups/${id}.json`);
    url.searchParams.set(
      "fields",
      "id,name,status,ad_plan_id,package_id,max_price",
    );

    const parsed = await this.requestValidated(
      "GET",
      url,
      adGroupSchema,
      "VK Ads returned an invalid ad-group object.",
    );

    const group: VkAdsAdGroup = {
      id: parsed.id,
      name: parsed.name,
      status: parsed.status,
      adPlanId: parsed.ad_plan_id ?? 0,
      packageId: parsed.package_id,
    };

    if (parsed.max_price !== undefined) {
      group.maxPrice = parsed.max_price;
    }

    return group;
  }

  async getAdGroupWritableState(
    id: number,
  ): Promise<Record<string, unknown>> {
    const url = new URL(`${this.v2BaseUrl}/ad_groups/${id}.json`);
    url.searchParams.set(
      "fields",
      [
        "id",
        "name",
        "status",
        "package_id",
        "ad_plan_id",
        "age_restrictions",
        "audit_pixels",
        "autobidding_mode",
        "banner_uniq_shows_limit",
        "budget_limit",
        "budget_limit_day",
        "date_end",
        "date_start",
        "dynamic_banners_use_storelink",
        "dynamic_without_remarketing",
        "enable_offline_goals",
        "enable_utm",
        "language",
        "marketplace_app_client_id",
        "max_price",
        "objective",
        "price",
        "priced_goal",
        "pricelist_id",
        "targetings",
        "uniq_shows_limit",
        "uniq_shows_period",
        "utm",
        "not_ad",
      ].join(","),
    );

    return await this.requestValidated(
      "GET",
      url,
      z.record(z.string(), z.unknown()),
      "VK Ads returned an invalid writable ad-group state.",
    );
  }

  async getBanner(id: number): Promise<VkAdsBanner> {
    const url = new URL(`${this.v2BaseUrl}/banners/${id}.json`);
    url.searchParams.set(
      "fields",
      "id,ad_group_id,name,status,moderation_status,content,textblocks,urls",
    );

    const parsed = await this.requestValidated(
      "GET",
      url,
      bannerSchema,
      "VK Ads returned an invalid banner object.",
    );
    const banner: VkAdsBanner = {
      id: parsed.id,
      adGroupId: parsed.ad_group_id ?? parsed.ad_group!,
    };

    if (parsed.name !== undefined) {
      banner.name = parsed.name;
    }

    if (parsed.status !== undefined) {
      banner.status = parsed.status;
    }

    if (parsed.moderation_status !== undefined) {
      banner.moderationStatus = parsed.moderation_status;
    }

    if (parsed.content !== undefined) {
      banner.content = parsed.content;
    }

    if (parsed.textblocks !== undefined) {
      banner.textblocks = parsed.textblocks;
    }

    if (parsed.urls !== undefined) {
      banner.urls = parsed.urls;
    }

    return banner;
  }

  async listBanners(
    input: ListVkAdsBannersInput = {},
  ): Promise<VkAdsBannersPage> {
    const url = new URL(`${this.v2BaseUrl}/banners.json`);
    url.searchParams.set(
      "fields",
      "id,ad_group_id,name,status,moderation_status",
    );
    appendPagination(url.searchParams, input);

    const filters = [
      ["id", "_id"],
      ["ids", "_id__in"],
      ["adGroupId", "_ad_group_id"],
      ["adGroupIds", "_ad_group_id__in"],
      ["adGroupStatus", "_ad_group_status"],
      ["adGroupStatusNot", "_ad_group_status__ne"],
      ["adGroupStatuses", "_ad_group_status__in"],
      ["status", "_status"],
      ["statusNot", "_status__ne"],
      ["statuses", "_status__in"],
      ["updatedLt", "_updated__lt"],
      ["updatedLte", "_updated__lte"],
      ["updatedGt", "_updated__gt"],
      ["updatedGte", "_updated__gte"],
      ["url", "_url"],
      ["textblock", "_textblock"],
    ] as const;

    for (const [key, queryName] of filters) {
      const value = input[key];

      if (value !== undefined) {
        url.searchParams.set(
          queryName,
          Array.isArray(value) ? value.join(",") : String(value),
        );
      }
    }

    const parsed = await this.requestValidated(
      "GET",
      url,
      bannersPageSchema,
      "VK Ads returned an invalid banners page.",
    );

    return {
      count: parsed.count,
      offset: parsed.offset,
      items: parsed.items.map((item) => ({
        id: item.id,
        adGroupId: item.ad_group_id ?? item.ad_group!,
        ...(item.name !== undefined ? { name: item.name } : {}),
        ...(item.status !== undefined
          ? { status: item.status }
          : {}),
        ...(item.moderation_status !== undefined
          ? { moderationStatus: item.moderation_status }
          : {}),
      })),
    };
  }

  async createBanner(
    adGroupId: number,
    input: CreateVkAdsBannerInput,
  ): Promise<CreateVkAdsBannerResult> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(
        `${this.v2BaseUrl}/ad_groups/${adGroupId}/banners.json`,
      ),
      createBannerResponseSchema,
      "VK Ads returned an invalid banner creation response.",
      input,
    );

    return {
      id: parsed.id,
    };
  }

  async updateBanner(
    id: number,
    input: UpdateVkAdsBannerInput,
  ): Promise<void> {
    await this.requestSuccessfulEmpty(
      "POST",
      new URL(`${this.v2BaseUrl}/banners/${id}.json`),
      input,
    );
  }

  async deleteBanner(id: number): Promise<void> {
    await this.requestSuccessfulEmpty(
      "DELETE",
      new URL(`${this.v2BaseUrl}/banners/${id}.json`),
    );
  }

  async massUpdateBanners(
    input: MassUpdateVkAdsBannerInput[],
  ): Promise<void> {
    await this.requestSuccessfulEmpty(
      "POST",
      new URL(`${this.v2BaseUrl}/banners/mass_action.json`),
      input,
    );
  }

  async remoderateBanners(
    ids: number[],
  ): Promise<VkAdsBannerRemoderationResult[]> {
    const url = new URL(
      `${this.v2BaseUrl}/banners/remoderate.json`,
    );
    url.searchParams.set("fields", "id,remoderated");
    const parsed = await this.requestValidated(
      "POST",
      url,
      bannerRemoderationResponseSchema,
      "VK Ads returned an invalid banner remoderation response.",
      {
        banners: ids.map((id) => ({ id })),
      },
    );

    return parsed.banners;
  }

  async uploadHtml5Content(
    file: Blob,
    filename: string,
  ): Promise<VkAdsContentUploadResult> {
    const form = new FormData();
    form.append("file", file, filename);
    const parsed = await this.requestMultipartValidated(
      new URL(`${this.v2BaseUrl}/content/html5.json`),
      contentUploadResponseSchema,
      "VK Ads returned an invalid HTML5 content response.",
      form,
    );

    return {
      id: parsed.id,
      variants: Object.fromEntries(
        Object.entries(parsed.variants).map(([key, variant]) => [
          key,
          {
            width: variant.html_params.width,
            height: variant.html_params.height,
            size: variant.size ?? variant.html_params.size!,
          },
        ]),
      ),
    };
  }

  async uploadStaticContent(
    file: Blob,
    filename: string,
    width: number,
    height: number,
  ): Promise<VkAdsContentUploadResult> {
    const form = new FormData();
    form.append("file", file, filename);
    form.append(
      "data",
      JSON.stringify({
        width,
        height,
      }),
    );
    const parsed = await this.requestMultipartValidated(
      new URL(`${this.v2BaseUrl}/content/static.json`),
      staticContentUploadResponseSchema,
      "VK Ads returned an invalid static content response.",
      form,
    );

    return {
      id: parsed.id,
      variants: Object.fromEntries(
        Object.entries(parsed.variants).map(([key, variant]) => [
          key,
          {
            width: variant.width,
            height: variant.height,
            size: variant.size,
          },
        ]),
      ),
    };
  }

  async uploadVideoContent(
    file: Blob,
    filename: string,
    width: number,
    height: number,
  ): Promise<VkAdsContentUploadResult> {
    const form = new FormData();
    form.append("file", file, filename);
    form.append(
      "data",
      JSON.stringify({
        width,
        height,
      }),
    );
    const parsed = await this.requestMultipartValidated(
      new URL(`${this.v2BaseUrl}/content/video.json`),
      staticContentUploadResponseSchema,
      "VK Ads returned an invalid video content response.",
      form,
    );

    return {
      id: parsed.id,
      variants: Object.fromEntries(
        Object.entries(parsed.variants).map(([key, variant]) => [
          key,
          {
            width: variant.width,
            height: variant.height,
            size: variant.size,
          },
        ]),
      ),
    };
  }

  async listRemarketingCounters(
    input: ListVkAdsRemarketingCountersInput = {},
  ): Promise<VkAdsRemarketingCountersResult> {
    const url = new URL(
      `${this.v2BaseUrl}/remarketing/counters.json`,
    );

    if (input.counterId !== undefined) {
      url.searchParams.set("_counter_id", String(input.counterId));
    }

    if (input.counterIds !== undefined) {
      url.searchParams.set(
        "_counter_id__in",
        input.counterIds.join(","),
      );
    }

    if (input.domain !== undefined) {
      url.searchParams.set("_domain", input.domain);
    }

    if (input.domains !== undefined) {
      url.searchParams.set("_domain__in", input.domains.join(","));
    }

    const parsed = await this.requestValidated(
      "GET",
      url,
      remarketingCountersResponseSchema,
      "VK Ads returned an invalid remarketing counters response.",
    );

    return {
      items: parsed.items.map((counter) => ({
        id: counter.id,
        counterId: counter.counter_id,
        name: counter.name,
        status: counter.status,
        systemStatus: counter.system_status,
        working: counter.working,
        flags: counter.flags ?? [],
      })),
    };
  }

  async getRemarketingCounter(
    counterId: number,
  ): Promise<VkAdsRemarketingCounter> {
    const parsed = await this.requestValidated(
      "GET",
      new URL(
        `${this.v2BaseUrl}/remarketing/counters/${counterId}.json`,
      ),
      remarketingCounterSchema,
      "VK Ads returned an invalid remarketing counter response.",
    );

    return {
      id: parsed.id,
      counterId: parsed.counter_id,
      name: parsed.name,
      status: parsed.status,
      systemStatus: parsed.system_status,
      working: parsed.working,
      flags: parsed.flags ?? [],
    };
  }

  async createRemarketingCounter(
    input: CreateVkAdsRemarketingCounterInput,
  ): Promise<VkAdsRemarketingCounter> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(`${this.v2BaseUrl}/remarketing/counters.json`),
      remarketingCounterSchema,
      "VK Ads returned an invalid remarketing counter creation response.",
      input,
    );

    return {
      id: parsed.id,
      counterId: parsed.counter_id,
      name: parsed.name,
      status: parsed.status,
      systemStatus: parsed.system_status,
      working: parsed.working,
      flags: parsed.flags ?? [],
    };
  }

  async updateRemarketingCounter(
    counterId: number,
    input: { name?: string; flags?: string[] },
  ): Promise<VkAdsRemarketingCounter> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(
        `${this.v2BaseUrl}/remarketing/counters/${counterId}.json`,
      ),
      remarketingCounterSchema,
      "VK Ads returned an invalid updated remarketing counter.",
      input,
    );

    return {
      id: parsed.id,
      counterId: parsed.counter_id,
      name: parsed.name,
      status: parsed.status,
      systemStatus: parsed.system_status,
      working: parsed.working,
      flags: parsed.flags ?? [],
    };
  }

  async listRemarketingCounterGoals(
    counterId: number,
  ): Promise<VkAdsRemarketingCounterGoal[]> {
    const parsed = await this.requestValidated(
      "GET",
      new URL(
        `${this.v2BaseUrl}/remarketing/counters/${counterId}/goals.json`,
      ),
      remarketingCounterGoalsResponseSchema,
      "VK Ads returned invalid remarketing counter goals.",
    );

    return parsed.items.map((goal) => ({
      ...(goal.id === undefined ? {} : { id: goal.id }),
      ...(goal.substr === undefined
        ? {}
        : { substr: goal.substr }),
      ...(goal.value === undefined ? {} : { value: goal.value }),
      name: goal.name,
      ...(goal.condition === undefined
        ? {}
        : { condition: goal.condition }),
      ...(goal.goal_type === undefined
        ? {}
        : { goalType: goal.goal_type }),
    }));
  }

  async createRemarketingCounterGoal(
    counterId: number,
    input: CreateVkAdsRemarketingCounterGoalInput,
  ): Promise<VkAdsRemarketingCounterGoal> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(
        `${this.v2BaseUrl}/remarketing/counters/${counterId}/goals.json`,
      ),
      remarketingCounterGoalSchema,
      "VK Ads returned an invalid created remarketing counter goal.",
      input,
    );

    return {
      ...(parsed.id === undefined ? {} : { id: parsed.id }),
      ...(parsed.substr === undefined
        ? {}
        : { substr: parsed.substr }),
      ...(parsed.value === undefined
        ? {}
        : { value: parsed.value }),
      name: parsed.name,
      ...(parsed.condition === undefined
        ? {}
        : { condition: parsed.condition }),
      ...(parsed.goal_type === undefined
        ? {}
        : { goalType: parsed.goal_type }),
    };
  }

  async updateRemarketingCounterGoal(
    counterId: number,
    goalId: number | string,
    input: UpdateVkAdsRemarketingCounterGoalInput,
  ): Promise<VkAdsRemarketingCounterGoal> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(
        `${this.v2BaseUrl}/remarketing/counters/${counterId}/goals/${encodeURIComponent(String(goalId))}.json`,
      ),
      remarketingCounterGoalSchema,
      "VK Ads returned an invalid updated remarketing counter goal.",
      input,
    );

    return {
      ...(parsed.id === undefined ? {} : { id: parsed.id }),
      ...(parsed.substr === undefined
        ? {}
        : { substr: parsed.substr }),
      ...(parsed.value === undefined
        ? {}
        : { value: parsed.value }),
      name: parsed.name,
      ...(parsed.condition === undefined
        ? {}
        : { condition: parsed.condition }),
      ...(parsed.goal_type === undefined
        ? {}
        : { goalType: parsed.goal_type }),
    };
  }

  async updateRemarketingInAppEventCategory(
    appId: number,
    trackerId: number,
    eventId: number,
    categoryId: number,
  ): Promise<void> {
    await this.requestSuccessfulEmpty(
      "POST",
      new URL(
        `${this.v2BaseUrl}/remarketing/inapp_events/${appId}/trackers/${trackerId}/events/${eventId}.json`,
      ),
      { inapp_event_category_id: categoryId },
    );
  }

  async listRemarketingOfflineGoals(): Promise<VkAdsRemarketingOfflineGoalsResult> {
    const url = new URL(
      `${this.v2BaseUrl}/remarketing/offline_goals.json`,
    );
    url.searchParams.set(
      "fields",
      "id,name,type,attribution_period,load_status",
    );
    const parsed = await this.requestValidated(
      "GET",
      url,
      remarketingOfflineGoalsResponseSchema,
      "VK Ads returned an invalid remarketing offline goals response.",
    );

    return {
      items: parsed.items.map((goal) => ({
        id: goal.id,
        name: goal.name,
        type: goal.type,
        attributionPeriod: goal.attribution_period,
        ...(goal.load_status === undefined
          ? {}
          : { loadStatus: goal.load_status }),
      })),
    };
  }

  async createRemarketingOfflineGoal(
    file: Blob,
    filename: string,
    input: CreateVkAdsRemarketingOfflineGoalInput,
  ): Promise<void> {
    const form = new FormData();
    form.set("list_users", file, filename);
    form.set("name", input.name);
    form.set("type", input.type);
    form.set(
      "attribution_period",
      String(input.attribution_period),
    );
    await this.requestMultipartSuccessfulEmpty(
      new URL(
        `${this.v2BaseUrl}/remarketing/offline_goals.json`,
      ),
      form,
    );
  }

  async updateRemarketingOfflineGoal(
    id: number,
    input: UpdateVkAdsRemarketingOfflineGoalInput,
    file?: Blob,
    filename?: string,
  ): Promise<void> {
    const form = new FormData();

    if (input.name !== undefined) {
      form.set("name", input.name);
    }

    if (file !== undefined && filename !== undefined) {
      form.set("list_users", file, filename);
    }

    await this.requestMultipartSuccessfulEmpty(
      new URL(
        `${this.v2BaseUrl}/remarketing/offline_goals/${id}.json`,
      ),
      form,
    );
  }

  async deleteRemarketingOfflineGoal(id: number): Promise<void> {
    await this.requestSuccessfulEmpty(
      "DELETE",
      new URL(
        `${this.v2BaseUrl}/remarketing/offline_goals/${id}.json`,
      ),
    );
  }

  async listRemarketingUsersLists(
    query?: string,
    apiVersion: VkAdsRemarketingUsersListApiVersion = 3,
  ): Promise<VkAdsRemarketingUsersListsResult> {
    const url = new URL(
      `${
        apiVersion === 2 ? this.v2BaseUrl : this.v3BaseUrl
      }/remarketing/users_lists.json`,
    );

    if (query !== undefined) {
      if (apiVersion === 2) {
        throw new VkAdsApiError(
          "Remarketing users-list search is supported only by API v3.",
          "unsupported_remarketing_users_list_query",
        );
      }

      url.searchParams.set("_q", query);
    }

    const parsed = await this.requestValidated(
      "GET",
      url,
      remarketingUsersListsResponseSchema,
      "VK Ads returned an invalid remarketing users-lists response.",
    );

    return {
      items: parsed.items.map(normalizeRemarketingUsersList),
    };
  }

  async getRemarketingUsersList(
    id: number,
    apiVersion: VkAdsRemarketingUsersListApiVersion = 3,
  ): Promise<VkAdsRemarketingUsersList> {
    const parsed = await this.requestValidated(
      "GET",
      new URL(
        `${
          apiVersion === 2 ? this.v2BaseUrl : this.v3BaseUrl
        }/remarketing/users_lists/${id}.json`,
      ),
      remarketingUsersListSchema,
      "VK Ads returned an invalid remarketing users-list response.",
    );

    return normalizeRemarketingUsersList(parsed);
  }

  async createRemarketingUsersList(
    file: Blob,
    filename: string,
    input: CreateVkAdsRemarketingUsersListInput,
    apiVersion: VkAdsRemarketingUsersListApiVersion = 3,
  ): Promise<{ id: number }> {
    const form = new FormData();
    form.set("file", file, filename);

    if (apiVersion === 2) {
      form.set("data", JSON.stringify(input));
    } else {
      form.set("name", input.name);
      form.set("type", input.type);

      if (input.base !== undefined) {
        form.set("base", String(input.base));
      }
    }

    const parsed = await this.requestMultipartValidated(
      new URL(
        `${
          apiVersion === 2 ? this.v2BaseUrl : this.v3BaseUrl
        }/remarketing/users_lists.json`,
      ),
      createRemarketingUsersListResponseSchema,
      "VK Ads returned an invalid remarketing users-list creation response.",
      form,
    );

    return {
      id: parsed.id,
    };
  }

  async updateRemarketingUsersList(
    id: number,
    name: string,
    apiVersion: VkAdsRemarketingUsersListApiVersion = 3,
  ): Promise<void> {
    await this.requestSuccessfulEmpty(
      "POST",
      new URL(
        `${
          apiVersion === 2 ? this.v2BaseUrl : this.v3BaseUrl
        }/remarketing/users_lists/${id}.json`,
      ),
      { name },
    );
  }

  async deleteRemarketingUsersList(
    id: number,
    apiVersion: VkAdsRemarketingUsersListDeleteApiVersion = 3,
  ): Promise<void> {
    const endpoint =
      apiVersion === 1
        ? `${this.v1BaseUrl}/remarketing_users_list/${id}.json`
        : `${
            apiVersion === 2 ? this.v2BaseUrl : this.v3BaseUrl
          }/remarketing/users_lists/${id}.json`;

    await this.requestSuccessfulEmpty(
      "DELETE",
      new URL(endpoint),
    );
  }

  async listVkGroups(
    input: VkAdsPaginationInput = {},
  ): Promise<VkAdsVkGroupsPage> {
    const url = new URL(
      `${this.v2BaseUrl}/remarketing/vk_groups.json`,
    );
    appendPagination(url.searchParams, input);
    const parsed = await this.requestValidated(
      "GET",
      url,
      vkGroupsPageSchema,
      "VK Ads returned an invalid VK-groups page.",
    );

    return {
      count: parsed.count,
      offset: input.offset ?? 0,
      items: parsed.items.map(normalizeVkGroup),
    };
  }

  async createVkGroup(
    input: CreateVkAdsVkGroupInput,
  ): Promise<VkAdsVkGroup> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(
        `${this.v2BaseUrl}/remarketing/vk_groups.json`,
      ),
      vkGroupSchema,
      "VK Ads returned an invalid VK-group creation response.",
      input,
    );

    return normalizeVkGroup(parsed);
  }

  async listSegments(
    input: ListVkAdsSegmentsInput = {},
  ): Promise<VkAdsSegmentsPage> {
    const url = new URL(
      `${this.v2BaseUrl}/remarketing/segments.json`,
    );
    appendPagination(url.searchParams, input);

    if (input.id !== undefined) {
      url.searchParams.set("_id", String(input.id));
    }

    if (input.ids !== undefined) {
      url.searchParams.set("_id__in", input.ids.join(","));
    }

    if (input.name !== undefined) {
      url.searchParams.set("_name", input.name);
    }

    if (input.nameStartsWith !== undefined) {
      url.searchParams.set(
        "_name__startswith",
        input.nameStartsWith,
      );
    }

    const parsed = await this.requestValidated(
      "GET",
      url,
      segmentsPageSchema,
      "VK Ads returned an invalid segments page.",
    );

    return {
      count: parsed.count,
      offset: parsed.offset,
      items: parsed.items.map(normalizeSegment),
    };
  }

  async getSegment(id: number): Promise<VkAdsSegment> {
    const parsed = await this.requestValidated(
      "GET",
      new URL(
        `${this.v2BaseUrl}/remarketing/segments/${id}.json`,
      ),
      segmentSchema,
      "VK Ads returned an invalid segment response.",
    );

    return normalizeSegment(parsed);
  }

  async createSegment(
    input: CreateVkAdsSegmentInput,
  ): Promise<{ id: number }> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(`${this.v2BaseUrl}/remarketing/segments.json`),
      createSegmentResponseSchema,
      "VK Ads returned an invalid segment creation response.",
      input,
    );

    return { id: parsed.id };
  }

  async updateSegment(
    id: number,
    input: UpdateVkAdsSegmentInput,
  ): Promise<void> {
    await this.requestSuccessfulEmpty(
      "POST",
      new URL(
        `${this.v2BaseUrl}/remarketing/segments/${id}.json`,
      ),
      input,
    );
  }

  async deleteSegment(id: number): Promise<void> {
    await this.requestSuccessfulEmpty(
      "DELETE",
      new URL(
        `${this.v2BaseUrl}/remarketing/segments/${id}.json`,
      ),
    );
  }

  async listSegmentRelations(
    segmentId: number,
  ): Promise<VkAdsSegmentRelation[]> {
    const url = new URL(
      `${this.v2BaseUrl}/remarketing/segments/${segmentId}/relations.json`,
    );
    url.searchParams.set(
      "fields",
      "id,object_id,object_type,params",
    );
    const parsed = await this.requestValidated(
      "GET",
      url,
      segmentRelationsResponseSchema,
      "VK Ads returned an invalid segment-relations response.",
    );

    return parsed.items.map(normalizeSegmentRelation);
  }

  async createSegmentRelations(
    segmentId: number,
    items: CreateVkAdsSegmentRelationInput[],
  ): Promise<VkAdsSegmentRelation[]> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(
        `${this.v2BaseUrl}/remarketing/segments/${segmentId}/relations.json`,
      ),
      segmentRelationsResponseSchema,
      "VK Ads returned an invalid segment-relations creation response.",
      { items },
    );

    return parsed.items.map(normalizeSegmentRelation);
  }

  async updateSegmentRelation(
    segmentId: number,
    relationId: number,
    params: Record<string, unknown>,
  ): Promise<VkAdsSegmentRelation> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(
        `${this.v2BaseUrl}/remarketing/segments/${segmentId}/relations/${relationId}.json`,
      ),
      segmentRelationSchema,
      "VK Ads returned an invalid segment-relation update response.",
      { params },
    );

    return normalizeSegmentRelation(parsed);
  }

  async deleteSegmentRelation(
    segmentId: number,
    relationId: number,
  ): Promise<void> {
    await this.requestSuccessfulEmpty(
      "DELETE",
      new URL(
        `${this.v2BaseUrl}/remarketing/segments/${segmentId}/relations/${relationId}.json`,
      ),
    );
  }

  async listSharingKeys(
    key?: string,
  ): Promise<VkAdsSharingKey[]> {
    const url = new URL(`${this.v2BaseUrl}/sharing_keys.json`);
    url.searchParams.set(
      "fields",
      "sharing_key,sources,price,is_marketplace,payment_type,type,users",
    );
    const parsed = await this.requestValidated(
      "GET",
      url,
      sharingKeysResponseSchema,
      "VK Ads returned an invalid sharing-keys response.",
    );

    const items = parsed.items.map(normalizeSharingKey);

    return key === undefined
      ? items
      : items.filter((item) => item.sharingKey === key);
  }

  async createSharingKey(
    input: CreateVkAdsSharingKeyInput,
  ): Promise<VkAdsSharingKey> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(`${this.v2BaseUrl}/sharing_keys.json`),
      sharingKeySchema,
      "VK Ads returned an invalid sharing-key creation response.",
      input,
    );

    return normalizeSharingKey(parsed);
  }

  async activateSharingKey(
    key: string,
    sources?: CreateVkAdsSharingKeyInput["sources"],
  ): Promise<{ id: number; sources: VkAdsSharingKeySource[] }> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(
        `${this.v2BaseUrl}/sharing_keys/${encodeURIComponent(key)}.json`,
      ),
      sharingKeyActivationSchema,
      "VK Ads returned an invalid sharing-key activation response.",
      sources === undefined ? {} : { sources },
    );

    return {
      id: parsed.id,
      sources: parsed.sources.map(normalizeSharingKeySource),
    };
  }

  async deleteSharingKey(key: string): Promise<void> {
    await this.requestSuccessfulEmpty(
      "DELETE",
      new URL(
        `${this.v2BaseUrl}/sharing_keys/${encodeURIComponent(key)}.json`,
      ),
    );
  }

  async checkAuditPixel(
    auditPixel: string,
  ): Promise<VkAdsAuditPixelCheckResult> {
    const url = new URL(`${this.v3BaseUrl}/audit_pixel.json`);
    url.searchParams.set(
      "fields",
      "audit_pixel,generated_audit_pixels",
    );
    const parsed = await this.requestValidated(
      "POST",
      url,
      auditPixelResponseSchema,
      "VK Ads returned an invalid audit-pixel response.",
      { audit_pixel: auditPixel },
    );

    return {
      auditPixel: parsed.audit_pixel,
      generatedAuditPixels: parsed.generated_audit_pixels.map(
        (item) => ({
          auditPixel: item.audit_pixel,
          role: item.role,
        }),
      ),
    };
  }

  async predictProjection(
    input: VkAdsProjectionInput,
  ): Promise<VkAdsProjectionResult> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(`${this.v3BaseUrl}/projection.json`),
      projectionResponseSchema,
      "VK Ads returned an invalid projection response.",
      input,
    );

    return {
      crCtr: parsed.cr_ctr.map((item) => ({
        packageId: item.package_id,
        histogramId: item.histogram_id,
        avgCr: item.avg_cr,
        avgCtr: item.avg_ctr,
      })),
      histograms: parsed.histograms.map((item) => ({
        id: item.histogram_id,
        points: item.histogram.map((point) => ({
          price: point.price,
          uniqs: point.uniqs,
          share: point.share,
        })),
      })),
    };
  }

  async listStatisticsDay(
    input: ListVkAdsStatisticsDayInput,
  ): Promise<VkAdsStatisticsDayResult> {
    const url = new URL(
      `${this.v3BaseUrl}/statistics/${input.resource}/day.json`,
    );
    const listParams: Array<
      [string, number[] | string[] | undefined]
    > = [
      ["id", input.ids],
      ["id_ne", input.excluded_ids],
      ["fields", input.fields],
      ["banner_status", input.banner_statuses],
      ["banner_status_ne", input.excluded_banner_statuses],
      ["ad_group_status", input.ad_group_statuses],
      ["ad_group_status_ne", input.excluded_ad_group_statuses],
      ["ad_group_id", input.ad_group_ids],
      ["ad_group_id_ne", input.excluded_ad_group_ids],
      ["package_id", input.package_ids],
      ["package_id_ne", input.excluded_package_ids],
    ];
    url.searchParams.set("date_from", input.date_from);

    if (input.date_to !== undefined) {
      url.searchParams.set("date_to", input.date_to);
    }

    for (const [name, values] of listParams) {
      if (values !== undefined) {
        url.searchParams.set(name, values.join(","));
      }
    }

    if (input.attribution !== undefined) {
      url.searchParams.set("attribution", input.attribution);
    }

    if (input.sort_by !== undefined) {
      url.searchParams.set("sort_by", input.sort_by);
    }

    if (input.direction !== undefined) {
      url.searchParams.set("d", input.direction);
    }

    if (input.limit !== undefined) {
      url.searchParams.set("limit", String(input.limit));
    }

    if (input.offset !== undefined) {
      url.searchParams.set("offset", String(input.offset));
    }

    const parsed = await this.requestValidated(
      "GET",
      url,
      statisticsDayResponseSchema,
      "VK Ads returned an invalid statistics response.",
    );

    return {
      items: parsed.items.map((item) => ({
        id: item.id,
        ...(item.user_id === undefined
          ? {}
          : { userId: item.user_id }),
        total: item.total,
      })),
      total: parsed.total,
      limit: parsed.limit,
      offset: parsed.offset,
      count: parsed.count,
    };
  }

  async getFastStatistics(
    resource: VkAdsFastStatisticsResource,
    ids: number[],
  ): Promise<VkAdsFastStatisticsResult> {
    const url = new URL(
      `${this.v3BaseUrl}/statistics/faststat/${resource}.json`,
    );
    url.searchParams.set("id", ids.join(","));
    const parsed = await this.requestValidated(
      "GET",
      url,
      fastStatisticsResponseSchema,
      "VK Ads returned an invalid fast-statistics response.",
    );
    const collectionName =
      resource === "users" ? "advertisers" : resource;
    const collection = parsed[collectionName];

    return {
      lastSeen: {
        timestamp: parsed.last_seen_msg_time.timestamp,
        string: parsed.last_seen_msg_time.string,
        ago: parsed.last_seen_msg_time.ago,
      },
      items: Object.entries(collection).map(([id, item]) => ({
        id,
        timestamp: item.timestamp,
        clicks: item.minutely.clicks,
        shows: item.minutely.shows,
      })),
    };
  }

  async getGeneralStatistics(
    input: VkAdsV2GeneralStatisticsInput,
  ): Promise<VkAdsV2StatisticsResult> {
    return await this.getV2Statistics(
      `${input.resource}/${input.granularity}`,
      input,
      input.metrics === undefined
        ? {}
        : { metrics: input.metrics.join(",") },
    );
  }

  async getGoalStatistics(
    input: VkAdsV2ConversionStatisticsInput,
  ): Promise<VkAdsV2StatisticsResult> {
    return await this.getV2Statistics(
      `goals/${input.resource}/day`,
      input,
      input.conversion_types === undefined
        ? {}
        : {
            conversion_type: input.conversion_types.join(","),
          },
    );
  }

  async getInAppStatistics(
    input: VkAdsV2ConversionStatisticsInput,
  ): Promise<VkAdsV2StatisticsResult> {
    return await this.getV2Statistics(
      `inapp/${input.resource}/day`,
      input,
      input.conversion_types === undefined
        ? {}
        : {
            conversion_type: input.conversion_types.join(","),
          },
    );
  }

  async getOfflineConversionStatistics(
    input: VkAdsOfflineConversionStatisticsInput,
  ): Promise<VkAdsOfflineConversionStatisticsResult> {
    const requestGranularity = async (
      granularity: "day" | "summary",
    ) => {
      const url = new URL(
        `${this.v2BaseUrl}/statistics/offline_conversions/${input.resource}/${granularity}.json`,
      );
      url.searchParams.set("date_from", input.date_from);
      url.searchParams.set("date_to", input.date_to);
      url.searchParams.set("id", input.ids.join(","));

      return await this.requestValidated(
        "GET",
        url,
        offlineConversionStatisticsResponseSchema,
        "VK Ads returned an invalid offline-conversion statistics response.",
      );
    };
    let parsed: z.infer<
      typeof offlineConversionStatisticsResponseSchema
    >;
    let source: VkAdsOfflineConversionStatisticsResult["source"] =
      input.granularity;

    try {
      // Always try native summary first so a future provider fix
      // automatically replaces the temporary day-based fallback.
      parsed = await requestGranularity(input.granularity);
    } catch (error) {
      if (
        input.granularity !== "summary" ||
        !(error instanceof VkAdsApiError) ||
        error.code !== "WRONG_RESOURCE" ||
        error.httpStatus !== 404
      ) {
        throw error;
      }

      parsed = await requestGranularity("day");
      source = "day_fallback";
    }

    return {
      items: parsed.items.map((item) => ({
        id: item.id,
        total: item.total,
        ...(item.rows === undefined ? {} : { rows: item.rows }),
      })),
      source,
    };
  }

  async deleteRemarketingCounter(
    counterId: number,
    version: "v1" | "v2" = "v2",
  ): Promise<void> {
    const url =
      version === "v1"
        ? `${this.v1BaseUrl}/remarketing_counters/${counterId}.json`
        : `${this.v2BaseUrl}/remarketing/counters/${counterId}.json`;
    await this.requestSuccessfulEmpty(
      "DELETE",
      new URL(url),
    );
  }

  async listGoals(): Promise<VkAdsGoalsResult> {
    const parsed = await this.requestValidated(
      "GET",
      new URL(`${this.v2BaseUrl}/goals.json`),
      goalsResponseSchema,
      "VK Ads returned an invalid goals response.",
    );

    return {
      categories: Object.fromEntries(
        Object.entries(parsed).map(([category, goals]) => [
          category,
          goals.map((goal) => ({
            goal: goal.goal,
            description: goal.description,
            ...(goal.id === undefined ? {} : { id: goal.id }),
            ...(goal.counter_id === undefined
              ? {}
              : { counterId: goal.counter_id }),
            ...(goal.counter_name === undefined
              ? {}
              : { counterName: goal.counter_name }),
          })),
        ]),
      ),
    };
  }

  async listRemarketingInAppEvents(
    input: ListVkAdsRemarketingInAppEventsInput = {},
  ): Promise<VkAdsRemarketingInAppEventsResult> {
    const url = new URL(
      `${this.v2BaseUrl}/remarketing/inapp_events.json`,
    );
    appendPagination(url.searchParams, input);

    if (input.urlObjectId !== undefined) {
      url.searchParams.set("_url_object_id", input.urlObjectId);
    }

    const parsed = await this.requestValidated(
      "GET",
      url,
      remarketingInAppEventsResponseSchema,
      "VK Ads returned an invalid remarketing in-app events response.",
    );

    return {
      count: parsed.count,
      offset: parsed.offset,
      items: parsed.items.map((source) => ({
        appId: source.rb_mobile_app_id,
        appName: source.app_name,
        platform: source.platform,
        status: source.status,
        trackers: source.trackers.map((tracker) => ({
          id: tracker.id,
          name: tracker.name,
          events: tracker.events.map((event) => ({
            id: event.id,
            name: event.name,
            ...(event.inapp_event_category_id === undefined
              ? {}
              : {
                  categoryId:
                    event.inapp_event_category_id,
                }),
          })),
        })),
      })),
    };
  }

  async listLocalGeos(): Promise<VkAdsLocalGeosResult> {
    const url = new URL(
      `${this.v2BaseUrl}/remarketing/local_geo.json`,
    );
    url.searchParams.set("fields", "id,name,regions");
    const parsed = await this.requestValidated(
      "GET",
      url,
      localGeosResponseSchema,
      "VK Ads returned an invalid local geos response.",
    );

    return {
      items: parsed.items.map((localGeo) => ({
        id: localGeo.id,
        name: localGeo.name,
        regions: localGeo.regions.map((region) => ({
          lat: region.lat,
          lng: region.lng,
          radius: region.radius,
          label: region.label,
          address: region.address,
        })),
      })),
    };
  }

  async listRemarketingPricelists(
    input: VkAdsPaginationInput = {},
  ): Promise<VkAdsRemarketingPricelistsResult> {
    const url = new URL(
      `${this.v2BaseUrl}/remarketing/pricelists.json`,
    );
    appendPagination(url.searchParams, input);
    const parsed = await this.requestValidated(
      "GET",
      url,
      remarketingPricelistsPageSchema,
      "VK Ads returned an invalid remarketing pricelists response.",
    );

    return {
      count: parsed.count,
      offset: parsed.offset,
      items: parsed.items.map((pricelist) => ({
        id: pricelist.id,
        name: pricelist.name,
        ...(pricelist.status !== undefined
          ? { status: pricelist.status }
          : {}),
        ...(pricelist.source_type !== undefined
          ? { sourceType: pricelist.source_type }
          : {}),
      })),
    };
  }

  async createRemarketingPricelist(
    input: CreateVkAdsRemarketingPricelistInput,
  ): Promise<{ id: number }> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(
        `${this.v2BaseUrl}/remarketing/pricelists.json`,
      ),
      createRemarketingPricelistResponseSchema,
      "VK Ads returned an invalid remarketing pricelist creation response.",
      input,
    );

    return {
      id: parsed.id,
    };
  }

  async createRemarketingPricelistBatch(
    pricelistId: number,
    operations: VkAdsOfferBatchOperation[],
  ): Promise<Array<{ id: number; status: string }>> {
    const body = operations
      .map((operation) => JSON.stringify(operation))
      .join("\n");
    const parsed = await this.requestNdjsonValidated(
      new URL(
        `${this.v2BaseUrl}/remarketing/pricelists/${pricelistId}/batch.json`,
      ),
      createOfferBatchTaskResponseSchema,
      "VK Ads returned an invalid offer batch creation response.",
      body,
    );

    const tasks = Array.isArray(parsed) ? parsed : [parsed];

    return tasks.map((task) => ({
      id: task.id,
      status: task.status,
    }));
  }

  async getRemarketingPricelistBatchTask(
    pricelistId: number,
    taskId: number,
  ): Promise<VkAdsOfferBatchTask> {
    const parsed = await this.requestValidated(
      "GET",
      new URL(
        `${this.v2BaseUrl}/remarketing/pricelists/${pricelistId}/batch/${taskId}.json`,
      ),
      offerBatchTaskDetailSchema,
      "VK Ads returned an invalid offer batch task response.",
    );
    const errors = parsed.errors ?? [];

    return {
      id: parsed.id,
      status: parsed.status,
      errorCount: errors.reduce(
        (total, error) => total + error.count,
        0,
      ),
      feedFailureCount: errors
        .filter((error) => error.event === "feed_failure")
        .reduce((total, error) => total + error.count, 0),
      offerErrorCount: errors
        .filter((error) => error.event === "offer_error")
        .reduce((total, error) => total + error.count, 0),
      offerWarningCount: errors
        .filter((error) => error.event === "offer_warning")
        .reduce((total, error) => total + error.count, 0),
    };
  }

  async deleteRemarketingPricelist(id: number): Promise<void> {
    await this.requestSuccessfulEmpty(
      "DELETE",
      new URL(
        `${this.v2BaseUrl}/remarketing/pricelists/${id}.json`,
      ),
    );
  }

  async createLocalGeo(
    input: CreateVkAdsLocalGeoInput,
  ): Promise<VkAdsLocalGeo> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(`${this.v2BaseUrl}/remarketing/local_geo.json`),
      localGeoSchema,
      "VK Ads returned an invalid local geo creation response.",
      input,
    );

    return {
      id: parsed.id,
      name: parsed.name,
      regions: parsed.regions.map((region) => ({
        lat: region.lat,
        lng: region.lng,
        radius: region.radius,
        label: region.label,
        address: region.address,
      })),
    };
  }

  async updateLocalGeo(
    id: number,
    input: UpdateVkAdsLocalGeoInput,
  ): Promise<VkAdsLocalGeo> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(
        `${this.v2BaseUrl}/remarketing/local_geo/${id}.json`,
      ),
      localGeoSchema,
      "VK Ads returned an invalid local geo update response.",
      input,
    );

    return {
      id: parsed.id,
      name: parsed.name,
      regions: parsed.regions.map((region) => ({
        lat: region.lat,
        lng: region.lng,
        radius: region.radius,
        label: region.label,
        address: region.address,
      })),
    };
  }

  async deleteLocalGeo(id: number): Promise<void> {
    await this.requestSuccessfulEmpty(
      "DELETE",
      new URL(
        `${this.v2BaseUrl}/remarketing/local_geo/${id}.json`,
      ),
    );
  }

  async createAdGroup(
    input: CreateVkAdsAdGroupInput,
  ): Promise<CreateVkAdsAdGroupResult> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(`${this.v2BaseUrl}/ad_groups.json`),
      createAdGroupResponseSchema,
      "VK Ads returned an invalid ad-group creation response.",
      input,
    );

    return {
      id: parsed.id,
      bannerIds:
        parsed.banners?.map((banner) => banner.id) ?? [],
    };
  }

  async updateAdGroup(
    id: number,
    input: UpdateVkAdsAdGroupInput,
  ): Promise<void> {
    await this.requestSuccessfulEmpty(
      "POST",
      new URL(`${this.v2BaseUrl}/ad_groups/${id}.json`),
      input,
    );
  }

  async deleteAdGroup(id: number): Promise<void> {
    await this.requestSuccessfulEmpty(
      "DELETE",
      new URL(`${this.v2BaseUrl}/ad_groups/${id}.json`),
    );
  }

  async createAdPlan(
    input: CreateVkAdsAdPlanInput,
  ): Promise<CreateVkAdsAdPlanResult> {
    const parsed = await this.requestValidated(
      "POST",
      new URL(`${this.v2BaseUrl}/ad_plans.json`),
      createAdPlanResponseSchema,
      "VK Ads returned an invalid ad-plan creation response.",
      input,
    );

    return {
      id: parsed.id,
    };
  }

  async updateAdPlan(
    id: number,
    input: UpdateVkAdsAdPlanInput,
  ): Promise<void> {
    await this.requestSuccessfulEmpty(
      "POST",
      new URL(`${this.v2BaseUrl}/ad_plans/${id}.json`),
      input,
    );
  }

  async massUpdateAdPlans(
    input: MassUpdateVkAdsAdPlanInput[],
  ): Promise<void> {
    await this.requestSuccessfulEmpty(
      "POST",
      new URL(`${this.v2BaseUrl}/ad_plans/mass_action.json`),
      input,
    );
  }

  async massUpdateAdGroups(
    input: MassUpdateVkAdsAdGroupInput[],
  ): Promise<void> {
    await this.requestSuccessfulEmpty(
      "POST",
      new URL(`${this.v2BaseUrl}/ad_groups/mass_action.json`),
      input,
    );
  }

  private async requestValidated<Output>(
    method: "GET" | "POST",
    url: URL,
    schema: z.ZodType<Output>,
    invalidResponseMessage: string,
    body?: object,
  ): Promise<Output> {
    let accessToken = await this.tokenProvider.getAccessToken();
    let response = await this.request(method, url, accessToken, body);

    if (response.status === 401) {
      accessToken =
        await this.tokenProvider.refreshAfterAuthenticationFailure(
          accessToken,
        );
      response = await this.request(
        method,
        url,
        accessToken,
        body,
      );
    }

    if (method === "GET") {
      for (
        let retry = 0;
        response.status === 429 &&
        retry < READ_RATE_LIMIT_RETRIES;
        retry += 1
      ) {
        await wait(retryDelayMilliseconds(response));
        response = await this.request(
          method,
          url,
          accessToken,
          body,
        );
      }
    }

    const payload = await readJson(response);

    if (!response.ok) {
      throw createProviderApiError(payload, response.status);
    }

    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      throw new VkAdsApiError(
        invalidResponseMessage,
        "invalid_api_response",
        response.status,
      );
    }

    return parsed.data;
  }

  private async requestSuccessfulEmpty(
    method: "POST" | "DELETE",
    url: URL,
    body?: object,
  ): Promise<void> {
    const accessToken = await this.tokenProvider.getAccessToken();
    let response = await this.request(method, url, accessToken, body);

    if (response.status === 401) {
      const refreshedAccessToken =
        await this.tokenProvider.refreshAfterAuthenticationFailure(
          accessToken,
        );
      response = await this.request(
        method,
        url,
        refreshedAccessToken,
        body,
      );
    }

    if (!response.ok) {
      const payload = await readJson(response);
      throw createProviderApiError(payload, response.status);
    }

    if (response.status !== 200 && response.status !== 204) {
      throw new VkAdsApiError(
        "VK Ads returned an unexpected successful response status.",
        "invalid_api_response",
        response.status,
      );
    }
  }

  private async requestBinary(
    url: URL,
  ): Promise<VkAdsLeadFormLeadsExport> {
    let accessToken = await this.tokenProvider.getAccessToken();
    let response = await this.request("GET", url, accessToken);

    if (response.status === 401) {
      accessToken =
        await this.tokenProvider.refreshAfterAuthenticationFailure(
          accessToken,
        );
      response = await this.request("GET", url, accessToken);
    }

    for (
      let retry = 0;
      response.status === 429 && retry < READ_RATE_LIMIT_RETRIES;
      retry += 1
    ) {
      await wait(retryDelayMilliseconds(response));
      response = await this.request("GET", url, accessToken);
    }

    if (!response.ok) {
      const payload = await readJson(response);
      throw createProviderApiError(payload, response.status);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());

    if (bytes.byteLength === 0) {
      throw new VkAdsApiError(
        "VK Ads returned an empty lead export.",
        "invalid_api_response",
        response.status,
      );
    }

    const contentType = response.headers.get("content-type");

    return {
      bytes,
      ...(contentType === null ? {} : { contentType }),
    };
  }

  private async requestNdjsonValidated<Output>(
    url: URL,
    schema: z.ZodType<Output>,
    invalidResponseMessage: string,
    body: string,
  ): Promise<Output> {
    let accessToken = await this.tokenProvider.getAccessToken();
    let response = await this.requestNdjson(
      url,
      accessToken,
      body,
    );

    if (response.status === 401) {
      accessToken =
        await this.tokenProvider.refreshAfterAuthenticationFailure(
          accessToken,
        );
      response = await this.requestNdjson(
        url,
        accessToken,
        body,
      );
    }

    const payload = await readJson(response);

    if (!response.ok) {
      throw createProviderApiError(payload, response.status);
    }

    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      throw new VkAdsApiError(
        invalidResponseMessage,
        "invalid_api_response",
        response.status,
      );
    }

    return parsed.data;
  }

  private async requestMultipartValidated<Output>(
    url: URL,
    schema: z.ZodType<Output>,
    invalidResponseMessage: string,
    form: FormData,
  ): Promise<Output> {
    const accessToken = await this.tokenProvider.getAccessToken();
    let response = await this.requestMultipart(
      url,
      accessToken,
      form,
    );

    if (response.status === 401) {
      const refreshedAccessToken =
        await this.tokenProvider.refreshAfterAuthenticationFailure(
          accessToken,
        );
      response = await this.requestMultipart(
        url,
        refreshedAccessToken,
        form,
      );
    }

    const payload = await readJson(response);

    if (!response.ok) {
      throw createProviderApiError(payload, response.status);
    }

    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      throw new VkAdsApiError(
        invalidResponseMessage,
        "invalid_api_response",
        response.status,
      );
    }

    return parsed.data;
  }

  private async requestMultipartSuccessfulEmpty(
    url: URL,
    form: FormData,
  ): Promise<void> {
    const accessToken = await this.tokenProvider.getAccessToken();
    let response = await this.requestMultipart(
      url,
      accessToken,
      form,
    );

    if (response.status === 401) {
      const refreshedAccessToken =
        await this.tokenProvider.refreshAfterAuthenticationFailure(
          accessToken,
        );
      response = await this.requestMultipart(
        url,
        refreshedAccessToken,
        form,
      );
    }

    if (!response.ok) {
      const payload = await readJson(response);
      throw createProviderApiError(payload, response.status);
    }

    if (response.status !== 200 && response.status !== 204) {
      throw new VkAdsApiError(
        "VK Ads returned an unexpected successful response status.",
        "invalid_api_response",
        response.status,
      );
    }
  }

  private async requestMultipart(
    url: URL,
    accessToken: string,
    form: FormData,
  ): Promise<Response> {
    try {
      return await this.fetchImpl(url.toString(), {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
        },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new VkAdsApiError(
        "VK Ads API request failed before a confirmed response.",
        "api_transport_error",
      );
    }
  }

  private async requestNdjson(
    url: URL,
    accessToken: string,
    body: string,
  ): Promise<Response> {
    try {
      return await this.fetchImpl(url.toString(), {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/x-ndjson",
        },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new VkAdsApiError(
        "VK Ads API request failed before a confirmed response.",
        "api_transport_error",
      );
    }
  }

  private async request(
    method: "GET" | "POST" | "DELETE",
    url: URL,
    accessToken: string,
    body?: object,
  ): Promise<Response> {
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
    };
    const init: RequestInit = {
      method,
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    };

    if (body !== undefined) {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    try {
      return await this.fetchImpl(url.toString(), init);
    } catch {
      throw new VkAdsApiError(
        "VK Ads API request failed before a confirmed response.",
        "api_transport_error",
      );
    }
  }

  private async getV2Statistics(
    path: string,
    input: VkAdsV2StatisticsInput,
    extra: Record<string, string>,
  ): Promise<VkAdsV2StatisticsResult> {
    const url = new URL(`${this.v2BaseUrl}/statistics/${path}.json`);
    url.searchParams.set("date_from", input.date_from);
    url.searchParams.set("date_to", input.date_to);
    url.searchParams.set("id", input.ids.join(","));

    if (input.attribution !== undefined) {
      url.searchParams.set("attribution", input.attribution);
    }

    for (const [name, value] of Object.entries(extra)) {
      url.searchParams.set(name, value);
    }

    const parsed = await this.requestValidated(
      "GET",
      url,
      v2StatisticsResponseSchema,
      "VK Ads returned an invalid v2 statistics response.",
    );

    return {
      items: parsed.items.map((item) => ({
        id: item.id,
        total: item.total,
        ...(item.rows === undefined ? {} : { rows: item.rows }),
      })),
      total: parsed.total,
    };
  }
}

export function createDefaultVkAdsApiClient(): VkAdsApiClient {
  const configuredAuthPath =
    process.env.VK_ADS_AUTH_FILE?.trim();
  const store =
    configuredAuthPath === undefined ||
    configuredAuthPath.length === 0
      ? new EnvFileVkAdsCredentialStore()
      : new EnvFileVkAdsCredentialStore(configuredAuthPath);
  const oauthClient = new VkAdsOAuthClient();
  const tokenManager = new VkAdsTokenManager(store, oauthClient);

  return new VkAdsApiClient(tokenManager);
}
