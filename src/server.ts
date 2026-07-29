import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { openAsBlob } from "node:fs";
import { lstat, writeFile } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import { z } from "zod";

import {
  JsonLinesVkAdsAuditLog,
  type VkAdsAuditSink,
} from "./audit-log.js";
import {
  createDefaultVkAdsOAuthOperations,
  type VkAdsOAuthOperations,
} from "./auth/operations.js";
import {
  type CreateVkAdsBannerInput,
  type CreateVkAdsBannerResult,
  type CreateVkAdsAdGroupInput,
  type CreateVkAdsAdGroupResult,
  type CreateVkAdsAdPlanInput,
  type CreateVkAdsAdPlanResult,
  type CreateVkAdsLocalGeoInput,
  type CreateVkAdsRemarketingPricelistInput,
  type CreateVkAdsRemarketingCounterInput,
  type CreateVkAdsRemarketingOfflineGoalInput,
  type CreateVkAdsRemarketingUsersListInput,
  type CreateVkAdsSegmentInput,
  type CreateVkAdsSegmentRelationInput,
  type CreateVkAdsSharingKeyInput,
  type VkAdsOfferBatchOperation,
  type UpdateVkAdsLocalGeoInput,
  type UpdateVkAdsRemarketingOfflineGoalInput,
  type UpdateVkAdsSegmentInput,
  createDefaultVkAdsApiClient,
  type ListVkAdsBannersInput,
  type ListVkAdsRemarketingCountersInput,
  type ListVkAdsRemarketingInAppEventsInput,
  type ListVkAdsSegmentsInput,
  type ListVkAdsAdGroupsInput,
  type ListVkAdsAdPlansInput,
  type MassUpdateVkAdsAdGroupInput,
  type MassUpdateVkAdsAdPlanInput,
  type MassUpdateVkAdsBannerInput,
  type UpdateVkAdsAdGroupInput,
  type UpdateVkAdsAdPlanInput,
  type UpdateVkAdsBannerInput,
  type VkAdsAdPlan,
  type VkAdsAdGroup,
  type VkAdsAdGroupsPage,
  type VkAdsAdPlansPage,
  type VkAdsBanner,
  type VkAdsBannersPage,
  type VkAdsBannerRemoderationResult,
  type VkAdsCurrentUser,
  type VkAdsReferenceCollectionResource,
  type VkAdsReferenceCollectionResult,
  type VkAdsReferenceMapResource,
  type VkAdsContentUploadResult,
  type VkAdsGoalsResult,
  type VkAdsLocalGeo,
  type VkAdsLocalGeosResult,
  type VkAdsRemarketingInAppEventsResult,
  type VkAdsRemarketingCountersResult,
  type VkAdsRemarketingPricelistsResult,
  type VkAdsRemarketingOfflineGoalsResult,
  type VkAdsRemarketingUsersList,
  type VkAdsRemarketingUsersListApiVersion,
  type VkAdsRemarketingUsersListDeleteApiVersion,
  type VkAdsRemarketingUsersListsResult,
  type VkAdsSegment,
  type VkAdsSegmentRelation,
  type VkAdsSegmentsPage,
  type VkAdsSharingKey,
  type VkAdsSharingKeySource,
  type VkAdsAuditPixelCheckResult,
  type VkAdsProjectionInput,
  type VkAdsProjectionResult,
  type ListVkAdsStatisticsDayInput,
  type VkAdsStatisticsDayResult,
  type VkAdsFastStatisticsResource,
  type VkAdsFastStatisticsResult,
  type VkAdsV2GeneralStatisticsInput,
  type VkAdsV2ConversionStatisticsInput,
  type VkAdsV2StatisticsResult,
  type VkAdsOfflineConversionStatisticsInput,
  type VkAdsOfflineConversionStatisticsResult,
  type CreateVkAdsLeadFormInput,
  type UpdateVkAdsLeadFormInput,
  type ListVkAdsLeadFormsInput,
  type VkAdsLeadForm,
  type VkAdsLeadFormsPage,
  type VkAdsLeadFormImageUploadResult,
  type ExportVkAdsLeadFormLeadsInput,
  type ListVkAdsLeadsInput,
  type VkAdsLeadFormLeadsExport,
  type VkAdsLeadsPage,
  type VkAdsTestLeadResult,
  type VkAdsOfferBatchTask,
  type CreateVkAdsSurveyInput,
  type UpdateVkAdsSurveyInput,
  type ListVkAdsSurveysInput,
  type ListVkAdsRespondentsInput,
  type VkAdsSurvey,
  type VkAdsSurveysPage,
  type VkAdsRespondentsPage,
  type VkAdsSubscriptionsPage,
  type VkAdsUrl,
  type VkAdsMobileStore,
  type VkAdsMobileStoreApp,
  type VkAdsUserApiVersion,
  type VkAdsUserProfile,
  type VkAdsOrdUser,
  type VkAdsUserGeoPage,
  type VkAdsRemarketingCounterGoal,
  type CreateVkAdsRemarketingCounterGoalInput,
  type UpdateVkAdsRemarketingCounterGoalInput,
} from "./vk-ads/client.js";
import { VkAdsApiError } from "./vk-ads/errors.js";
import {
  registerVkCommunityTools,
  type VkCommunityToolDependencies,
} from "./community/tools.js";
import { VkCommunityClient } from "./community/vk-client.js";
import { CommunityResearchStore } from "./community/research-store.js";

export const SERVER_INFO = {
  name: "vk-ads-mcp",
  version: "0.3.0",
} as const;

export const CONNECTION_CHECK_TOOL = "vk_ads_connection_check";
export const OAUTH_CODE_INFO_TOOL = "vk_ads_oauth_code_info";
export const OAUTH_TOKEN_REFRESH_TOOL =
  "vk_ads_oauth_token_refresh";
export const OAUTH_CURRENT_TOKENS_DELETE_TOOL =
  "vk_ads_oauth_current_tokens_delete";
export const AD_PLANS_LIST_TOOL = "vk_ads_ad_plans_list";
export const AD_GROUPS_LIST_TOOL = "vk_ads_ad_groups_list";
export const AD_GROUP_GET_TOOL = "vk_ads_ad_group_get";
export const AD_GROUP_CREATE_TOOL = "vk_ads_ad_group_create";
export const AD_GROUP_UPDATE_TOOL = "vk_ads_ad_group_update";
export const AD_GROUP_DELETE_TOOL = "vk_ads_ad_group_delete";
export const AD_GROUPS_MASS_ACTION_TOOL =
  "vk_ads_ad_groups_mass_action";
export const BANNER_GET_TOOL = "vk_ads_banner_get";
export const BANNERS_LIST_TOOL = "vk_ads_banners_list";
export const BANNER_CREATE_TOOL = "vk_ads_banner_create";
export const BANNER_UPDATE_TOOL = "vk_ads_banner_update";
export const BANNER_DELETE_TOOL = "vk_ads_banner_delete";
export const BANNERS_MASS_ACTION_TOOL =
  "vk_ads_banners_mass_action";
export const BANNERS_REMODERATE_TOOL =
  "vk_ads_banners_remoderate";
export const CONTENT_HTML5_UPLOAD_TOOL =
  "vk_ads_content_html5_upload";
export const CONTENT_STATIC_UPLOAD_TOOL =
  "vk_ads_content_static_upload";
export const CONTENT_VIDEO_UPLOAD_TOOL =
  "vk_ads_content_video_upload";
export const REMARKETING_COUNTERS_LIST_TOOL =
  "vk_ads_remarketing_counters_list";
export const REMARKETING_COUNTER_CREATE_TOOL =
  "vk_ads_remarketing_counter_create";
export const REMARKETING_COUNTER_GET_TOOL =
  "vk_ads_remarketing_counter_get";
export const GOALS_LIST_TOOL = "vk_ads_goals_list";
export const REMARKETING_IN_APP_EVENTS_LIST_TOOL =
  "vk_ads_remarketing_in_app_events_list";
export const REMARKETING_OFFLINE_GOAL_CREATE_TOOL =
  "vk_ads_remarketing_offline_goal_create";
export const REMARKETING_OFFLINE_GOALS_LIST_TOOL =
  "vk_ads_remarketing_offline_goals_list";
export const REMARKETING_OFFLINE_GOAL_UPDATE_TOOL =
  "vk_ads_remarketing_offline_goal_update";
export const REMARKETING_OFFLINE_GOAL_DELETE_TOOL =
  "vk_ads_remarketing_offline_goal_delete";
export const REMARKETING_USERS_LISTS_LIST_TOOL =
  "vk_ads_remarketing_users_lists_list";
export const REMARKETING_USERS_LIST_GET_TOOL =
  "vk_ads_remarketing_users_list_get";
export const REMARKETING_USERS_LIST_CREATE_TOOL =
  "vk_ads_remarketing_users_list_create";
export const REMARKETING_USERS_LIST_UPDATE_TOOL =
  "vk_ads_remarketing_users_list_update";
export const REMARKETING_USERS_LIST_DELETE_TOOL =
  "vk_ads_remarketing_users_list_delete";
export const SEGMENTS_LIST_TOOL = "vk_ads_segments_list";
export const SEGMENT_GET_TOOL = "vk_ads_segment_get";
export const SEGMENT_CREATE_TOOL = "vk_ads_segment_create";
export const SEGMENT_UPDATE_TOOL = "vk_ads_segment_update";
export const SEGMENT_DELETE_TOOL = "vk_ads_segment_delete";
export const SEGMENT_RELATIONS_LIST_TOOL =
  "vk_ads_segment_relations_list";
export const SEGMENT_RELATIONS_CREATE_TOOL =
  "vk_ads_segment_relations_create";
export const SEGMENT_RELATION_UPDATE_TOOL =
  "vk_ads_segment_relation_update";
export const SEGMENT_RELATION_DELETE_TOOL =
  "vk_ads_segment_relation_delete";
export const SHARING_KEYS_LIST_TOOL =
  "vk_ads_sharing_keys_list";
export const SHARING_KEY_CREATE_TOOL =
  "vk_ads_sharing_key_create";
export const SHARING_KEY_ACTIVATE_TOOL =
  "vk_ads_sharing_key_activate";
export const SHARING_KEY_DELETE_TOOL =
  "vk_ads_sharing_key_delete";
export const AUDIT_PIXEL_CHECK_TOOL =
  "vk_ads_audit_pixel_check";
export const PROJECTION_PREDICT_TOOL =
  "vk_ads_projection_predict";
export const STATISTICS_DAY_LIST_TOOL =
  "vk_ads_statistics_day_list";
export const FAST_STATISTICS_GET_TOOL =
  "vk_ads_fast_statistics_get";
export const V2_STATISTICS_GET_TOOL =
  "vk_ads_statistics_v2_get";
export const GOAL_STATISTICS_GET_TOOL =
  "vk_ads_goal_statistics_get";
export const IN_APP_STATISTICS_GET_TOOL =
  "vk_ads_in_app_statistics_get";
export const OFFLINE_CONVERSION_STATISTICS_DAY_GET_TOOL =
  "vk_ads_offline_conversion_statistics_day_get";
export const OFFLINE_CONVERSION_STATISTICS_SUMMARY_GET_TOOL =
  "vk_ads_offline_conversion_statistics_summary_get";
export const LEAD_FORMS_LIST_TOOL = "vk_ads_lead_forms_list";
export const LEAD_FORM_LOGO_UPLOAD_TOOL =
  "vk_ads_lead_form_logo_upload";
export const LEAD_FORM_GET_TOOL = "vk_ads_lead_form_get";
export const LEAD_FORM_CREATE_TOOL = "vk_ads_lead_form_create";
export const LEAD_FORM_UPDATE_TOOL = "vk_ads_lead_form_update";
export const LEAD_FORM_COPY_TOOL = "vk_ads_lead_form_copy";
export const LEAD_FORMS_ARCHIVE_TOOL =
  "vk_ads_lead_forms_archive";
export const LEAD_FORMS_UNARCHIVE_TOOL =
  "vk_ads_lead_forms_unarchive";
export const LEADS_LIST_TOOL = "vk_ads_leads_list";
export const LEAD_FORM_LEADS_EXPORT_TOOL =
  "vk_ads_lead_form_leads_export";
export const LEAD_FORM_TEST_LEAD_SEND_TOOL =
  "vk_ads_lead_form_test_lead_send";
export const REMARKETING_PRICELISTS_LIST_TOOL =
  "vk_ads_pricelists_list";
export const REMARKETING_PRICELIST_CREATE_TOOL =
  "vk_ads_pricelist_create";
export const REMARKETING_PRICELIST_BATCH_CREATE_TOOL =
  "vk_ads_pricelist_batch_create";
export const REMARKETING_PRICELIST_BATCH_GET_TOOL =
  "vk_ads_pricelist_batch_get";
export const LOCAL_GEOS_LIST_TOOL =
  "vk_ads_local_geos_list";
export const LOCAL_GEO_CREATE_TOOL =
  "vk_ads_local_geo_create";
export const LOCAL_GEO_UPDATE_TOOL =
  "vk_ads_local_geo_update";
export const LOCAL_GEO_DELETE_TOOL =
  "vk_ads_local_geo_delete";
export const AD_PLAN_GET_TOOL = "vk_ads_ad_plan_get";
export const AD_PLAN_CREATE_TOOL = "vk_ads_ad_plan_create";
export const AD_PLAN_UPDATE_TOOL = "vk_ads_ad_plan_update";
export const AD_PLANS_MASS_ACTION_TOOL =
  "vk_ads_ad_plans_mass_action";
export const AD_REFERENCE_LIST_TOOL =
  "vk_ads_ad_reference_list";
export const MOBILE_REFERENCE_LIST_TOOL =
  "vk_ads_mobile_reference_list";
export const CURRENCIES_LIST_TOOL =
  "vk_ads_currencies_list";
export const MOBILE_APPS_LIST_TOOL =
  "vk_ads_mobile_apps_list";
export const REGIONS_LIST_TOOL =
  "vk_ads_regions_list";
export const TRANSACTION_GROUPS_LIST_TOOL =
  "vk_ads_transaction_groups_list";
export const TARGETINGS_TREE_GET_TOOL =
  "vk_ads_targetings_tree_get";
export const THROTTLING_GET_TOOL =
  "vk_ads_throttling_get";
export const SURVEYS_LIST_TOOL = "vk_ads_surveys_list";
export const SURVEY_GET_TOOL = "vk_ads_survey_get";
export const SURVEY_CREATE_TOOL = "vk_ads_survey_create";
export const SURVEY_UPDATE_TOOL = "vk_ads_survey_update";
export const SURVEY_COPY_TOOL = "vk_ads_survey_copy";
export const SURVEYS_ARCHIVE_TOOL = "vk_ads_surveys_archive";
export const SURVEYS_UNARCHIVE_TOOL =
  "vk_ads_surveys_unarchive";
export const RESPONDENTS_LIST_TOOL =
  "vk_ads_respondents_list";
export const SURVEY_RESPONDENTS_EXPORT_TOOL =
  "vk_ads_survey_respondents_export";
export const SUBSCRIPTIONS_LIST_TOOL =
  "vk_ads_subscriptions_list";
export const SUBSCRIPTION_CREATE_TOOL =
  "vk_ads_subscription_create";
export const SUBSCRIPTION_DELETE_TOOL =
  "vk_ads_subscription_delete";
export const URL_RESOLVE_TOOL = "vk_ads_url_resolve";
export const URL_CREATE_TOOL = "vk_ads_url_create";
export const URL_GET_TOOL = "vk_ads_url_get";
export const URLS_GET_TOOL = "vk_ads_urls_get";
export const MOBILE_STORE_APP_GET_TOOL =
  "vk_ads_mobile_store_app_get";
export const MOBILE_STORE_APP_REFRESH_TOOL =
  "vk_ads_mobile_store_app_refresh";
export const USER_PROFILE_GET_TOOL =
  "vk_ads_user_profile_get";
export const USER_LANGUAGE_UPDATE_TOOL =
  "vk_ads_user_language_update";
export const ORD_USER_STATUS_GET_TOOL =
  "vk_ads_ord_user_status_get";
export const ORD_USER_UPDATE_TOOL =
  "vk_ads_ord_user_update";
export const USER_GEO_LIST_TOOL = "vk_ads_user_geo_list";
export const SKAD_NETWORK_IDS_TRANSFER_TOOL =
  "vk_ads_skad_network_ids_transfer";
export const REMARKETING_COUNTER_UPDATE_TOOL =
  "vk_ads_remarketing_counter_update";
export const REMARKETING_COUNTER_DELETE_TOOL =
  "vk_ads_remarketing_counter_delete";
export const REMARKETING_COUNTER_GOALS_LIST_TOOL =
  "vk_ads_remarketing_counter_goals_list";
export const REMARKETING_COUNTER_GOAL_CREATE_TOOL =
  "vk_ads_remarketing_counter_goal_create";
export const REMARKETING_COUNTER_GOAL_UPDATE_TOOL =
  "vk_ads_remarketing_counter_goal_update";
export const REMARKETING_IN_APP_EVENT_UPDATE_TOOL =
  "vk_ads_remarketing_in_app_event_update";

type VkAdsMcpClient = {
  getCurrentUser(): Promise<VkAdsCurrentUser>;
  listReferenceData?(
    resource: VkAdsReferenceCollectionResource,
    input?: { limit?: number; offset?: number },
  ): Promise<VkAdsReferenceCollectionResult>;
  getReferenceMap?(
    resource: VkAdsReferenceMapResource,
  ): Promise<Record<string, unknown>>;
  listSurveys?(
    input?: ListVkAdsSurveysInput,
  ): Promise<VkAdsSurveysPage>;
  getSurvey?(id: number): Promise<VkAdsSurvey>;
  createSurvey?(
    input: CreateVkAdsSurveyInput,
  ): Promise<{ id: number }>;
  updateSurvey?(
    id: number,
    input: UpdateVkAdsSurveyInput,
  ): Promise<VkAdsSurvey>;
  copySurvey?(id: number, name?: string): Promise<VkAdsSurvey>;
  setSurveysArchived?(
    ids: number[],
    archived: boolean,
  ): Promise<VkAdsSurvey[]>;
  listRespondents?(
    input?: ListVkAdsRespondentsInput,
  ): Promise<VkAdsRespondentsPage>;
  exportSurveyRespondents?(
    surveyId: number,
  ): Promise<VkAdsLeadFormLeadsExport>;
  listSubscriptions?(
    input?: { limit?: number; offset?: number },
  ): Promise<VkAdsSubscriptionsPage>;
  createSubscription?(
    resource: string,
    callbackUrl: string,
  ): Promise<{ id: number }>;
  deleteSubscription?(id: number): Promise<void>;
  resolveUrl?(url: string): Promise<VkAdsUrl>;
  createUrl?(url: string): Promise<{ id: number }>;
  getUrl?(id: number): Promise<VkAdsUrl>;
  getUrls?(ids: number[]): Promise<VkAdsUrl[]>;
  getMobileStoreApp?(
    store: VkAdsMobileStore,
    identifier: string,
  ): Promise<VkAdsMobileStoreApp>;
  refreshMobileStoreApp?(
    store: VkAdsMobileStore,
    identifier: string,
  ): Promise<VkAdsMobileStoreApp>;
  getUserProfile?(
    version: VkAdsUserApiVersion,
  ): Promise<VkAdsUserProfile>;
  updateUserLanguage?(
    version: VkAdsUserApiVersion,
    language: "ru" | "en",
  ): Promise<VkAdsUserProfile>;
  getOrdUser?(): Promise<VkAdsOrdUser>;
  updateOrdUser?(input: VkAdsOrdUser): Promise<VkAdsOrdUser>;
  listUserGeo?(input?: {
    limit?: number;
    offset?: number;
    ids?: number[];
    query?: string;
  }): Promise<VkAdsUserGeoPage>;
  listMobileAppsForSkAd?(): Promise<
    Array<Record<string, unknown>>
  >;
  transferSkAdNetworkIds?(
    action: "share" | "withdraw",
    appId: number,
    count: number,
    username: string,
  ): Promise<void>;
  updateRemarketingCounter?(
    counterId: number,
    input: { name?: string; flags?: string[] },
  ): Promise<VkAdsRemarketingCountersResult["items"][number]>;
  deleteRemarketingCounter?(
    counterId: number,
    version: "v1" | "v2",
  ): Promise<void>;
  listRemarketingCounterGoals?(
    counterId: number,
  ): Promise<VkAdsRemarketingCounterGoal[]>;
  createRemarketingCounterGoal?(
    counterId: number,
    input: CreateVkAdsRemarketingCounterGoalInput,
  ): Promise<VkAdsRemarketingCounterGoal>;
  updateRemarketingCounterGoal?(
    counterId: number,
    goalId: number | string,
    input: UpdateVkAdsRemarketingCounterGoalInput,
  ): Promise<VkAdsRemarketingCounterGoal>;
  updateRemarketingInAppEventCategory?(
    appId: number,
    trackerId: number,
    eventId: number,
    categoryId: number,
  ): Promise<void>;
  listAdPlans(
    input?: ListVkAdsAdPlansInput,
  ): Promise<VkAdsAdPlansPage>;
  listAdGroups(
    input?: ListVkAdsAdGroupsInput,
  ): Promise<VkAdsAdGroupsPage>;
  getAdGroup(id: number): Promise<VkAdsAdGroup>;
  createAdGroup(
    input: CreateVkAdsAdGroupInput,
  ): Promise<CreateVkAdsAdGroupResult>;
  updateAdGroup(
    id: number,
    input: UpdateVkAdsAdGroupInput,
  ): Promise<void>;
  deleteAdGroup(id: number): Promise<void>;
  massUpdateAdGroups(
    input: MassUpdateVkAdsAdGroupInput[],
  ): Promise<void>;
  getBanner(id: number): Promise<VkAdsBanner>;
  listBanners(
    input?: ListVkAdsBannersInput,
  ): Promise<VkAdsBannersPage>;
  createBanner(
    adGroupId: number,
    input: CreateVkAdsBannerInput,
  ): Promise<CreateVkAdsBannerResult>;
  updateBanner(
    id: number,
    input: UpdateVkAdsBannerInput,
  ): Promise<void>;
  deleteBanner(id: number): Promise<void>;
  massUpdateBanners(
    input: MassUpdateVkAdsBannerInput[],
  ): Promise<void>;
  remoderateBanners(
    ids: number[],
  ): Promise<VkAdsBannerRemoderationResult[]>;
  uploadHtml5Content(
    file: Blob,
    filename: string,
  ): Promise<VkAdsContentUploadResult>;
  uploadStaticContent(
    file: Blob,
    filename: string,
    width: number,
    height: number,
  ): Promise<VkAdsContentUploadResult>;
  uploadVideoContent(
    file: Blob,
    filename: string,
    width: number,
    height: number,
  ): Promise<VkAdsContentUploadResult>;
  listRemarketingCounters(
    input?: ListVkAdsRemarketingCountersInput,
  ): Promise<VkAdsRemarketingCountersResult>;
  createRemarketingCounter?(
    input: CreateVkAdsRemarketingCounterInput,
  ): Promise<VkAdsRemarketingCountersResult["items"][number]>;
  getRemarketingCounter?(
    counterId: number,
  ): Promise<VkAdsRemarketingCountersResult["items"][number]>;
  listGoals(): Promise<VkAdsGoalsResult>;
  listRemarketingInAppEvents(
    input?: ListVkAdsRemarketingInAppEventsInput,
  ): Promise<VkAdsRemarketingInAppEventsResult>;
  listRemarketingOfflineGoals?(): Promise<VkAdsRemarketingOfflineGoalsResult>;
  createRemarketingOfflineGoal?(
    file: Blob,
    filename: string,
    input: CreateVkAdsRemarketingOfflineGoalInput,
  ): Promise<void>;
  updateRemarketingOfflineGoal?(
    id: number,
    input: UpdateVkAdsRemarketingOfflineGoalInput,
    file?: Blob,
    filename?: string,
  ): Promise<void>;
  deleteRemarketingOfflineGoal?(id: number): Promise<void>;
  listRemarketingUsersLists?(
    query?: string,
    apiVersion?: VkAdsRemarketingUsersListApiVersion,
  ): Promise<VkAdsRemarketingUsersListsResult>;
  getRemarketingUsersList?(
    id: number,
    apiVersion?: VkAdsRemarketingUsersListApiVersion,
  ): Promise<VkAdsRemarketingUsersList>;
  createRemarketingUsersList?(
    file: Blob,
    filename: string,
    input: CreateVkAdsRemarketingUsersListInput,
    apiVersion?: VkAdsRemarketingUsersListApiVersion,
  ): Promise<{ id: number }>;
  updateRemarketingUsersList?(
    id: number,
    name: string,
    apiVersion?: VkAdsRemarketingUsersListApiVersion,
  ): Promise<void>;
  deleteRemarketingUsersList?(
    id: number,
    apiVersion?: VkAdsRemarketingUsersListDeleteApiVersion,
  ): Promise<void>;
  listSegments?(
    input?: ListVkAdsSegmentsInput,
  ): Promise<VkAdsSegmentsPage>;
  getSegment?(id: number): Promise<VkAdsSegment>;
  createSegment?(
    input: CreateVkAdsSegmentInput,
  ): Promise<{ id: number }>;
  updateSegment?(
    id: number,
    input: UpdateVkAdsSegmentInput,
  ): Promise<void>;
  deleteSegment?(id: number): Promise<void>;
  listSegmentRelations?(
    segmentId: number,
  ): Promise<VkAdsSegmentRelation[]>;
  createSegmentRelations?(
    segmentId: number,
    items: CreateVkAdsSegmentRelationInput[],
  ): Promise<VkAdsSegmentRelation[]>;
  updateSegmentRelation?(
    segmentId: number,
    relationId: number,
    params: Record<string, unknown>,
  ): Promise<VkAdsSegmentRelation>;
  deleteSegmentRelation?(
    segmentId: number,
    relationId: number,
  ): Promise<void>;
  listSharingKeys?(key?: string): Promise<VkAdsSharingKey[]>;
  createSharingKey?(
    input: CreateVkAdsSharingKeyInput,
  ): Promise<VkAdsSharingKey>;
  activateSharingKey?(
    key: string,
    sources?: CreateVkAdsSharingKeyInput["sources"],
  ): Promise<{ id: number; sources: VkAdsSharingKeySource[] }>;
  deleteSharingKey?(key: string): Promise<void>;
  checkAuditPixel?(
    auditPixel: string,
  ): Promise<VkAdsAuditPixelCheckResult>;
  predictProjection?(
    input: VkAdsProjectionInput,
  ): Promise<VkAdsProjectionResult>;
  listStatisticsDay?(
    input: ListVkAdsStatisticsDayInput,
  ): Promise<VkAdsStatisticsDayResult>;
  getFastStatistics?(
    resource: VkAdsFastStatisticsResource,
    ids: number[],
  ): Promise<VkAdsFastStatisticsResult>;
  getGeneralStatistics?(
    input: VkAdsV2GeneralStatisticsInput,
  ): Promise<VkAdsV2StatisticsResult>;
  getGoalStatistics?(
    input: VkAdsV2ConversionStatisticsInput,
  ): Promise<VkAdsV2StatisticsResult>;
  getInAppStatistics?(
    input: VkAdsV2ConversionStatisticsInput,
  ): Promise<VkAdsV2StatisticsResult>;
  getOfflineConversionStatistics?(
    input: VkAdsOfflineConversionStatisticsInput,
  ): Promise<VkAdsOfflineConversionStatisticsResult>;
  listLeadForms?(
    input?: ListVkAdsLeadFormsInput,
  ): Promise<VkAdsLeadFormsPage>;
  uploadLeadFormLogo?(
    file: Blob,
    filename: string,
  ): Promise<VkAdsLeadFormImageUploadResult>;
  getLeadForm?(id: number): Promise<VkAdsLeadForm>;
  createLeadForm?(
    input: CreateVkAdsLeadFormInput,
  ): Promise<{ id: number }>;
  updateLeadForm?(
    id: number,
    input: UpdateVkAdsLeadFormInput,
  ): Promise<VkAdsLeadForm>;
  copyLeadForm?(id: number, name?: string): Promise<VkAdsLeadForm>;
  setLeadFormsArchived?(
    ids: number[],
    archived: boolean,
  ): Promise<VkAdsLeadForm[]>;
  listLeads?(input?: ListVkAdsLeadsInput): Promise<VkAdsLeadsPage>;
  exportLeadFormLeads?(
    formId: number,
    input: ExportVkAdsLeadFormLeadsInput,
  ): Promise<VkAdsLeadFormLeadsExport>;
  sendTestLead?(formId: number): Promise<VkAdsTestLeadResult>;
  listRemarketingPricelists(
    input?: {
      limit?: number;
      offset?: number;
    },
  ): Promise<VkAdsRemarketingPricelistsResult>;
  createRemarketingPricelist(
    input: CreateVkAdsRemarketingPricelistInput,
  ): Promise<{ id: number }>;
  createRemarketingPricelistBatch?(
    pricelistId: number,
    operations: VkAdsOfferBatchOperation[],
  ): Promise<Array<{ id: number; status: string }>>;
  getRemarketingPricelistBatchTask?(
    pricelistId: number,
    taskId: number,
  ): Promise<VkAdsOfferBatchTask>;
  listLocalGeos(): Promise<VkAdsLocalGeosResult>;
  createLocalGeo(
    input: CreateVkAdsLocalGeoInput,
  ): Promise<VkAdsLocalGeo>;
  updateLocalGeo(
    id: number,
    input: UpdateVkAdsLocalGeoInput,
  ): Promise<VkAdsLocalGeo>;
  deleteLocalGeo(id: number): Promise<void>;
  getAdPlan(id: number): Promise<VkAdsAdPlan>;
  createAdPlan(
    input: CreateVkAdsAdPlanInput,
  ): Promise<CreateVkAdsAdPlanResult>;
  updateAdPlan(
    id: number,
    input: UpdateVkAdsAdPlanInput,
  ): Promise<void>;
  massUpdateAdPlans(
    input: MassUpdateVkAdsAdPlanInput[],
  ): Promise<void>;
};

function providerValueContains(
  actual: unknown,
  expected: unknown,
): boolean {
  if (
    expected === null ||
    typeof expected !== "object"
  ) {
    return Object.is(actual, expected);
  }

  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) =>
        providerValueContains(actual[index], value),
      )
    );
  }

  if (
    actual === null ||
    typeof actual !== "object" ||
    Array.isArray(actual)
  ) {
    return false;
  }

  const actualRecord = actual as Record<string, unknown>;

  return Object.entries(expected).every(([key, value]) =>
    providerValueContains(actualRecord[key], value),
  );
}

function providerSectionMatches(
  actual: Record<string, unknown> | undefined,
  expected: Record<string, unknown>,
): boolean {
  if (actual === undefined) {
    return false;
  }

  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();

  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    providerValueContains(actual, expected)
  );
}

function surveyMatches(
  survey: VkAdsSurvey,
  input: UpdateVkAdsSurveyInput,
): boolean {
  const pagesWithoutTemporaryIds =
    input.pages === undefined
      ? undefined
      : input.pages.map((page) =>
          removeTemporarySurveyIds(page),
        );

  return (
    (input.name === undefined || survey.name === input.name) &&
    (input.first_screen_type === undefined ||
      survey.firstScreenType === input.first_screen_type) &&
    (input.title === undefined || survey.title === input.title) &&
    (input.description === undefined ||
      survey.description === input.description) &&
    (input.company_title === undefined ||
      survey.companyTitle === input.company_title) &&
    (input.logo_id === undefined || survey.logoId === input.logo_id) &&
    (input.gradient === undefined ||
      survey.gradient === input.gradient) &&
    (input.result_info === undefined ||
      providerValueContains(survey.resultInfo, input.result_info)) &&
    (pagesWithoutTemporaryIds === undefined ||
      providerValueContains(survey.pages, pagesWithoutTemporaryIds))
  );
}

function ordUserStatus(user: VkAdsOrdUser): {
  hasName: boolean;
  hasPhone: boolean;
  hasInn: boolean;
  hasForeignEPaymentMethod: boolean;
  hasForeignCountryCode: boolean;
  hasForeignRegistrationNumber: boolean;
  hasForeignInn: boolean;
  hasSite: boolean;
} {
  const present = (value: string | null | undefined): boolean =>
    typeof value === "string" && value.length > 0;

  return {
    hasName: present(user.name),
    hasPhone: present(user.phone),
    hasInn: present(user.inn),
    hasForeignEPaymentMethod: present(
      user.foreign_epayment_method,
    ),
    hasForeignCountryCode: present(
      user.foreign_oksm_country_code,
    ),
    hasForeignRegistrationNumber: present(
      user.foreign_registration_number,
    ),
    hasForeignInn: present(user.foreign_inn),
    hasSite: present(user.site),
  };
}

function readSkAdAvailable(
  item: Record<string, unknown>,
): number | undefined {
  const counters = item.sk_ad_network_ids;

  if (
    counters === null ||
    typeof counters !== "object" ||
    Array.isArray(counters)
  ) {
    return undefined;
  }

  const available = (counters as Record<string, unknown>).available;
  return typeof available === "number" &&
    Number.isInteger(available) &&
    available >= 0
    ? available
    : undefined;
}

function removeTemporarySurveyIds(
  value: unknown,
): unknown {
  if (Array.isArray(value)) {
    return value.map(removeTemporarySurveyIds);
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]) =>
      key === "id" &&
      typeof child === "string" &&
      child.startsWith("new_")
        ? []
        : [[key, removeTemporarySurveyIds(child)]],
    ),
  );
}

async function readAdPlansInBatches(
  client: VkAdsMcpClient,
  ids: number[],
): Promise<VkAdsAdPlan[]> {
  const campaigns: VkAdsAdPlan[] = [];

  for (let offset = 0; offset < ids.length; offset += 10) {
    const batch = ids.slice(offset, offset + 10);
    campaigns.push(
      ...(await Promise.all(
        batch.map(async (id) => await client.getAdPlan(id)),
      )),
    );
  }

  return campaigns;
}

async function readAdGroupsInBatches(
  client: VkAdsMcpClient,
  ids: number[],
): Promise<VkAdsAdGroup[]> {
  const groups: VkAdsAdGroup[] = [];

  for (let offset = 0; offset < ids.length; offset += 10) {
    const batch = ids.slice(offset, offset + 10);
    groups.push(
      ...(await Promise.all(
        batch.map(async (id) => await client.getAdGroup(id)),
      )),
    );
  }

  return groups;
}

async function readBannersInBatches(
  client: VkAdsMcpClient,
  ids: number[],
): Promise<VkAdsBanner[]> {
  const banners: VkAdsBanner[] = [];

  for (let offset = 0; offset < ids.length; offset += 10) {
    const batch = ids.slice(offset, offset + 10);
    banners.push(
      ...(await Promise.all(
        batch.map(async (id) => await client.getBanner(id)),
      )),
    );
  }

  return banners;
}

const remarketingUsersListOutputSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  status: z.string().min(1),
  type: z.string().min(1),
  base: z.number().int(),
  entriesCount: z.number().int().nonnegative(),
  idsCount: z.number().int().nonnegative(),
  matchedIdsCount: z.number().int().nonnegative().optional(),
  hasHistory: z.boolean().optional(),
});

const segmentOutputSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  passCondition: z.number().int().positive(),
  relationsCount: z.number().int().nonnegative().optional(),
});

const segmentRelationOutputSchema = z.object({
  id: z.number().int().positive(),
  objectType: z.string().min(1),
  objectId: z.number().int(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const segmentRelationInputSchema = z.object({
  objectType: z.string().min(1),
  objectId: z.number().int().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const sharingKeySourceInputSchema = z.object({
  objectType: z.string().min(1),
  objectId: z.number().int().positive(),
});

const sharingKeySourceOutputSchema = z.object({
  objectType: z.string().min(1),
  objectId: z.number().int().positive(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const sharingKeyOutputSchema = z.object({
  sharingKey: z.string().min(1),
  sources: z.array(sharingKeySourceOutputSchema),
  price: z.string().optional(),
  isMarketplace: z.boolean().optional(),
  sendEmail: z.boolean().nullable().optional(),
  paymentType: z.string().min(1).optional(),
  type: z.string().min(1).optional(),
  userCount: z.number().int().nonnegative(),
});

const auditPixelOutputSchema = z.object({
  auditPixel: z.string().url(),
  role: z.string().min(1),
});

const projectionPointOutputSchema = z.object({
  price: z.number(),
  uniqs: z.number().int().nonnegative(),
  share: z.number(),
});

const statisticsStatusSchema = z.enum([
  "all",
  "active",
  "blocked",
  "deleted",
]);
const statisticsIdListSchema = z
  .array(z.number().int().positive())
  .min(1)
  .max(200);
const statisticsMetricRecordSchema = z.record(
  z.string(),
  z.unknown(),
);
const v2StatisticsOutputSchema = {
  items: z.array(
    z.object({
      id: z.number().int().positive(),
      total: statisticsMetricRecordSchema,
      rows: z.array(statisticsMetricRecordSchema).optional(),
    }),
  ),
  total: statisticsMetricRecordSchema,
};
const statisticsResourceSchema = z.enum([
  "banners",
  "ad_groups",
  "ad_plans",
  "users",
]);
const statisticsDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/);
const conversionTypeSchema = z.enum([
  "postview",
  "postclick",
  "total",
]);
const offlineConversionStatisticsResourceSchema = z.enum([
  "users",
  "ad_groups",
  "ad_plans",
]);
const offlineConversionStatisticsOutputSchema = {
  items: v2StatisticsOutputSchema.items,
  source: z.enum(["day", "summary", "day_fallback"]),
};
const leadFormOutputSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  status: z.number().int().optional(),
  firstScreenType: z
    .enum(["compact", "long_text", "award"])
    .optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  longDescription: z.string().optional(),
  companyTitle: z.string().optional(),
  logoId: z.string().nullable().optional(),
  contactFields: z.array(z.string()).optional(),
  resultInfo: z.record(z.string(), z.unknown()).optional(),
  agreement: z.record(z.string(), z.unknown()).optional(),
  notifications: z
    .array(z.record(z.string(), z.unknown()))
    .optional(),
  pages: z.array(z.record(z.string(), z.unknown())).optional(),
  leadsCount: z.number().int().nonnegative().optional(),
});
const leadFormCreateInputShape = {
  name: z.string().min(1).max(255),
  firstScreenType: z.enum(["compact", "long_text", "award"]),
  title: z.string().min(1).max(50),
  description: z.string().min(1).max(35).optional(),
  longDescription: z.string().min(1).optional(),
  companyTitle: z.string().min(1).max(30),
  logoId: z.string().min(1),
  contactFields: z.array(z.string().min(1)).min(1),
  resultInfo: z.record(z.string(), z.unknown()),
  agreement: z.record(z.string(), z.unknown()),
  notifications: z
    .array(z.record(z.string(), z.unknown()))
    .optional(),
  pages: z
    .array(z.record(z.string(), z.unknown()))
    .min(1)
    .optional(),
};
const leadOutputSchema = z.object({
  id: z.string().min(1),
  formId: z.number().int().positive(),
  formName: z.string(),
  adPlanId: z.number().int().positive().nullable().optional(),
  adGroupId: z.number().int().positive().nullable().optional(),
  bannerId: z.number().int().positive().nullable().optional(),
  createdAt: z.string().min(1),
});
const leadDateTimeInputSchema = z.string().min(1).max(64);
const leadListFiltersShape = {
  formIds: statisticsIdListSchema.optional(),
  adPlanIds: statisticsIdListSchema.optional(),
  adGroupIds: statisticsIdListSchema.optional(),
  bannerIds: statisticsIdListSchema.optional(),
  createdAtFrom: leadDateTimeInputSchema.optional(),
  createdAtTo: leadDateTimeInputSchema.optional(),
};
const referenceCollectionOutputSchema = {
  count: z.number().int().nonnegative(),
  limit: z.number().int().positive().max(200),
  offset: z.number().int().nonnegative(),
  items: z.array(z.record(z.string(), z.unknown())),
};
const referencePaginationInputSchema = {
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().nonnegative().default(0),
};
const surveyOutputSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  status: z.number().int().optional(),
  firstScreenType: z.string().optional(),
  title: z.string().optional(),
  description: z.string().optional(),
  companyTitle: z.string().optional(),
  logoId: z.string().nullable().optional(),
  gradient: z.number().int().optional(),
  resultInfo: z.record(z.string(), z.unknown()).optional(),
  pages: z.array(z.record(z.string(), z.unknown())).optional(),
  respondentsCount: z.number().int().nonnegative().optional(),
});
const surveyCreateInputShape = {
  name: z.string().min(1).max(255),
  firstScreenType: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  companyTitle: z.string().min(1),
  resultInfo: z.record(z.string(), z.unknown()),
  pages: z.array(z.record(z.string(), z.unknown())).min(1),
  logoId: z.string().min(1),
  gradient: z.number().int(),
};
const surveyIdsSchema = z
  .array(z.number().int().positive())
  .min(1)
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, {
    message: "ID опросов не должны повторяться.",
  });
const respondentOutputSchema = z.object({
  id: z.union([z.number().int().positive(), z.string().min(1)]),
  surveyId: z.number().int().positive(),
  surveyName: z.string().optional(),
  adPlanId: z.number().int().positive().nullable().optional(),
  adGroupId: z.number().int().positive().nullable().optional(),
  bannerId: z.number().int().positive().nullable().optional(),
  createdAt: z.string().min(1),
});
const subscriptionOutputSchema = z.object({
  id: z.number().int().positive(),
  resource: z.string().min(1),
  callbackUrl: z.string().url(),
});
const vkAdsUrlOutputSchema = z.object({
  id: z.number().int().positive(),
  url: z.string().min(1),
  urlTypes: z.array(z.string()),
  hasGoals: z.boolean().optional(),
});
const advertisingUrlInputSchema = z
  .string()
  .min(1)
  .refine((value) => {
    try {
      return [
        "http:",
        "https:",
        "market:",
        "itms:",
        "itms-apps:",
      ].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, "Допустимы только абсолютные http, https, market, itms и itms-apps URL.");
const mobileStoreAppInputSchema = z
  .object({
    store: z.enum(["apple", "google"]),
    identifier: z.string().min(1).max(255),
  })
  .superRefine(({ store, identifier }, context) => {
    const valid =
      store === "apple"
        ? /^\d+$/u.test(identifier)
        : /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/u.test(identifier);

    if (!valid) {
      context.addIssue({
        code: "custom",
        path: ["identifier"],
        message:
          store === "apple"
            ? "Для App Store нужен числовой ID приложения."
            : "Для Google Play нужен package name приложения.",
      });
    }
  });
const mobileStoreAppOutputSchema = z.object({
  id: z.number().int().positive(),
  identifier: z.string().min(1),
  status: z.string().min(1),
  title: z.string(),
  contentRating: z.string().optional(),
  type: z.string().optional(),
  categoryId: z.number().int().optional(),
});
const userProfileOutputSchema = z.object({
  id: z.union([z.number().int(), z.string().min(1)]),
  status: z.string().optional(),
  language: z.string().optional(),
  currency: z.string().optional(),
  infoCurrency: z.string().optional(),
  timezone: z.number().int().optional(),
  country: z.number().int().optional(),
  types: z.array(z.string()).optional(),
});
const ordUserStatusOutputSchema = z.object({
  hasName: z.boolean(),
  hasPhone: z.boolean(),
  hasInn: z.boolean(),
  hasForeignEPaymentMethod: z.boolean(),
  hasForeignCountryCode: z.boolean(),
  hasForeignRegistrationNumber: z.boolean(),
  hasForeignInn: z.boolean(),
  hasSite: z.boolean(),
});
const ordUserUpdateInputSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    phone: z.string().min(1).max(64).optional(),
    inn: z.string().min(1).max(64).optional(),
    foreignEPaymentMethod: z.string().min(1).max(255).optional(),
    foreignCountryCode: z.string().min(1).max(16).optional(),
    foreignRegistrationNumber: z.string().min(1).max(255).optional(),
    foreignInn: z.string().min(1).max(255).optional(),
    site: z.string().url().optional(),
  })
  .refine(
    (value) =>
      Object.values(value).some((field) => field !== undefined),
    "Укажите хотя бы одно поле ОРД.",
  );
const userGeoOutputSchema = z.object({
  id: z.number().int(),
  name: z.string(),
});
const remarketingCounterOutputSchema = z.object({
  id: z.number().int().positive(),
  counterId: z.number().int().positive(),
  name: z.string(),
  status: z.enum(["active", "blocked", "deleted"]),
  systemStatus: z.enum(["active", "blocked", "deleted"]),
  working: z.boolean().nullable(),
  flags: z.array(z.string()),
});
const remarketingCounterGoalOutputSchema = z.object({
  id: z
    .union([z.number().int().positive(), z.string().min(1)])
    .optional(),
  substr: z.string().nullable().optional(),
  value: z.number().finite().nullable().optional(),
  name: z.string(),
  condition: z.string().optional(),
  goalType: z.string().optional(),
});
const remarketingCounterGoalCreateInputSchema = z.object({
  substr: z.string().min(1).optional(),
  value: z.number().finite().optional(),
  name: z.string().min(1),
  condition: z.string().min(1).optional(),
  goalType: z.string().min(1).optional(),
});

export function createVkAdsMcpServer(
  vkAdsClient: VkAdsMcpClient = createDefaultVkAdsApiClient(),
  auditLog: VkAdsAuditSink = new JsonLinesVkAdsAuditLog(),
  oauthOperations: VkAdsOAuthOperations =
    createDefaultVkAdsOAuthOperations(),
  communityDependencies?: VkCommunityToolDependencies,
): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    OAUTH_CODE_INFO_TOOL,
    {
      title: "Проверить authorization code VK Рекламы",
      description:
        "Проверяет одноразовый authorization code через OAuth API и возвращает только типы аккаунта, без ID, username, кода и секретов.",
      inputSchema: {
        code: z.string().min(1).max(4096),
      },
      outputSchema: {
        recognized: z.literal(true),
        userTypes: z.array(z.string().min(1)),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ code }) => {
      const info =
        await oauthOperations.inspectAuthorizationCode(code);

      return {
        content: [
          {
            type: "text",
            text: "Authorization code распознан.",
          },
        ],
        structuredContent: {
          recognized: true as const,
          userTypes: info.userTypes,
        },
      };
    },
  );

  server.registerTool(
    OAUTH_CURRENT_TOKENS_DELETE_TOOL,
    {
      title: "Удалить все токены текущего аккаунта VK Рекламы",
      description:
        "Удаляет все OAuth-токены текущего настроенного аккаунта, атомарно очищает локальные токены и подтверждает восстановление авторизации новым токеном.",
      inputSchema: {
        confirmation: z.literal(
          "DELETE_ALL_CURRENT_VK_ADS_TOKENS",
        ),
      },
      outputSchema: {
        deleted: z.literal(true),
        reauthenticated: z.literal(true),
        auditRecorded: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async () => {
      await auditLog.ensureReady();

      try {
        await oauthOperations.deleteCurrentUserTokens();
      } catch (error) {
        await auditLog.record({
          operation: "oauth.current_tokens.delete",
          outcome: "failed",
        });
        throw error;
      }

      try {
        await vkAdsClient.getCurrentUser();
      } catch (error) {
        await auditLog.record({
          operation: "oauth.current_tokens.delete",
          outcome: "verification_failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "oauth.current_tokens.delete",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Токены удалены; новая авторизация подтверждена.",
          },
        ],
        structuredContent: {
          deleted: true as const,
          reauthenticated: true as const,
          auditRecorded: true,
        },
      };
    },
  );

  server.registerTool(
    OAUTH_TOKEN_REFRESH_TOOL,
    {
      title: "Обновить токен VK Рекламы",
      description:
        "По явному запросу обновляет текущую пару access/refresh token, сохраняет её атомарно и проверяет новую авторизацию. Если refresh token уже отозван, используйте vk_ads_oauth_current_tokens_delete.",
      inputSchema: {},
      outputSchema: {
        refreshed: z.literal(true),
        verified: z.literal(true),
        expiresAt: z.string().datetime(),
        auditRecorded: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async () => {
      if (oauthOperations.refreshCurrentTokens === undefined) {
        throw new VkAdsApiError(
          "OAuth token refresh is unavailable.",
          "oauth_refresh_unavailable",
        );
      }

      await auditLog.ensureReady();
      let expiresAt: number;

      try {
        ({ expiresAt } =
          await oauthOperations.refreshCurrentTokens());
        await vkAdsClient.getCurrentUser();
      } catch (error) {
        await auditLog.record({
          operation: "oauth.current_tokens.refresh",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "oauth.current_tokens.refresh",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Токен обновлён; новая авторизация подтверждена.",
          },
        ],
        structuredContent: {
          refreshed: true as const,
          verified: true as const,
          expiresAt: new Date(expiresAt).toISOString(),
          auditRecorded: true,
        },
      };
    },
  );

  server.registerTool(
    CONNECTION_CHECK_TOOL,
    {
      title: "Проверить подключение к VK Рекламе",
      description:
        "Проверяет авторизацию и возвращает безопасную сводку текущего пользователя VK Рекламы.",
      inputSchema: {},
      outputSchema: {
        connected: z.literal(true),
        apiVersion: z.literal("v3"),
        user: z.object({
          id: z.union([z.number().int(), z.string().min(1)]),
          status: z.string().optional(),
          currency: z.string().optional(),
          types: z.array(z.string()).optional(),
        }),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const user = await vkAdsClient.getCurrentUser();
      const structuredContent = {
        connected: true as const,
        apiVersion: "v3" as const,
        user,
      };

      return {
        content: [
          {
            type: "text",
            text: "Подключение к VK Рекламе работает.",
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    REMARKETING_COUNTERS_LIST_TOOL,
    {
      title: "Получить счётчики ремаркетинга VK Рекламы",
      description:
        "Возвращает доступные аккаунту счётчики Top.Mail.Ru и поддерживает официальные фильтры по ID счётчика и домену.",
      inputSchema: {
        counterId: z.number().int().positive().optional(),
        counterIds: z
          .array(z.number().int().positive())
          .min(1)
          .optional(),
        domain: z.string().min(1).optional(),
        domains: z.array(z.string().min(1)).min(1).optional(),
      },
      outputSchema: {
        items: z.array(
          z.object({
            id: z.number().int().positive(),
            counterId: z.number().int(),
            name: z.string(),
            status: z.enum(["active", "blocked", "deleted"]),
            systemStatus: z.enum([
              "active",
              "blocked",
              "deleted",
            ]),
            working: z.boolean().nullable(),
            flags: z.array(z.string()),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const counters = await vkAdsClient.listRemarketingCounters({
        ...(input.counterId === undefined
          ? {}
          : { counterId: input.counterId }),
        ...(input.counterIds === undefined
          ? {}
          : { counterIds: input.counterIds }),
        ...(input.domain === undefined
          ? {}
          : { domain: input.domain }),
        ...(input.domains === undefined
          ? {}
          : { domains: input.domains }),
      });
      const structuredContent = {
        items: counters.items,
      };

      return {
        content: [
          {
            type: "text",
            text: `Получено счётчиков ремаркетинга: ${counters.items.length}.`,
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    REMARKETING_COUNTER_CREATE_TOOL,
    {
      title: "Создать или подключить счётчик VK Рекламы",
      description:
        "Создаёт новый счётчик Top.Mail.Ru либо подключает доступный существующий счётчик, затем перечитывает его. Пароль и email не возвращаются и не записываются в audit.",
      inputSchema: {
        mode: z.enum(["new", "existing"]),
        name: z.string().min(1),
        url: z.url().optional(),
        email: z.email().optional(),
        password: z.string().min(1).optional(),
        counterId: z.number().int().positive().optional(),
        flags: z.array(z.string().min(1)).optional(),
      },
      outputSchema: {
        created: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        counter: z.object({
          id: z.number().int().positive(),
          counterId: z.number().int().positive(),
          name: z.string(),
          status: z.enum(["active", "blocked", "deleted"]),
          systemStatus: z.enum([
            "active",
            "blocked",
            "deleted",
          ]),
          working: z.boolean().nullable(),
          flags: z.array(z.string()),
        }),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      mode,
      name,
      url,
      email,
      password,
      counterId,
      flags,
    }) => {
      const newModeValid =
        mode === "new" &&
        url !== undefined &&
        email !== undefined &&
        password !== undefined &&
        counterId === undefined &&
        flags === undefined;
      const existingModeValid =
        mode === "existing" &&
        counterId !== undefined &&
        url === undefined &&
        email === undefined &&
        password === undefined;

      if (!newModeValid && !existingModeValid) {
        throw new VkAdsApiError(
          "Counter fields do not match the selected mode.",
          "invalid_remarketing_counter_mode",
        );
      }

      const createCounter =
        vkAdsClient.createRemarketingCounter;

      if (createCounter === undefined) {
        throw new VkAdsApiError(
          "Remarketing counter creation capability is unavailable.",
          "remarketing_counter_client_unavailable",
        );
      }

      const input: CreateVkAdsRemarketingCounterInput =
        mode === "new"
          ? {
              name,
              url: url!,
              email: email!,
              password: password!,
            }
          : {
              counter_id: counterId!,
              name,
              ...(flags === undefined ? {} : { flags }),
            };

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      let created: VkAdsRemarketingCountersResult["items"][number];

      try {
        created = await createCounter.call(vkAdsClient, input);
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.counters.create",
          outcome: "failed",
        });
        throw error;
      }

      const reread = (
        await vkAdsClient.listRemarketingCounters({
          counterId: created.counterId,
        })
      ).items.find(
        (counter) =>
          counter.id === created.id &&
          counter.counterId === created.counterId,
      );
      const verified =
        reread !== undefined &&
        reread.name === name &&
        (mode === "new" ||
          flags === undefined ||
          flags.every((flag) => reread.flags.includes(flag)));

      if (!verified) {
        await auditLog.record({
          operation: "remarketing.counters.create",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Created remarketing counter could not be verified by provider reread.",
          "remarketing_counter_verification_failed",
        );
      }

      await auditLog.record({
        operation: "remarketing.counters.create",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Счётчик ремаркетинга создан или подключён и проверен повторным чтением.",
          },
        ],
        structuredContent: {
          created: true as const,
          verified: true as const,
          auditRecorded: true,
          counter: reread,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_COUNTER_GET_TOOL,
    {
      title: "Получить счётчик ремаркетинга VK Рекламы",
      description:
        "Возвращает один доступный счётчик Top.Mail.Ru по его counter_id без приватных данных владельца.",
      inputSchema: {
        counterId: z.number().int().positive(),
      },
      outputSchema: {
        counter: z.object({
          id: z.number().int().positive(),
          counterId: z.number().int().positive(),
          name: z.string(),
          status: z.enum(["active", "blocked", "deleted"]),
          systemStatus: z.enum([
            "active",
            "blocked",
            "deleted",
          ]),
          working: z.boolean().nullable(),
          flags: z.array(z.string()),
        }),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ counterId }) => {
      const getCounter =
        vkAdsClient.getRemarketingCounter;

      if (getCounter === undefined) {
        throw new VkAdsApiError(
          "Remarketing counter read capability is unavailable.",
          "remarketing_counter_client_unavailable",
        );
      }

      const counter = await getCounter.call(
        vkAdsClient,
        counterId,
      );

      return {
        content: [
          {
            type: "text",
            text: "Счётчик ремаркетинга получен.",
          },
        ],
        structuredContent: {
          counter,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_COUNTER_UPDATE_TOOL,
    {
      title: "Изменить счётчик ремаркетинга VK Рекламы",
      description:
        "Изменяет название или флаги счётчика и подтверждает результат повторным чтением.",
      inputSchema: {
        counterId: z.number().int().positive(),
        changes: z
          .object({
            name: z.string().min(1).optional(),
            flags: z.array(z.string().min(1)).optional(),
          })
          .refine(
            (changes) =>
              changes.name !== undefined ||
              changes.flags !== undefined,
            "Укажите хотя бы одно изменение.",
          ),
      },
      outputSchema: {
        updated: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        counter: remarketingCounterOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ counterId, changes }) => {
      const getCounter = vkAdsClient.getRemarketingCounter;
      const updateCounter = vkAdsClient.updateRemarketingCounter;

      if (getCounter === undefined || updateCounter === undefined) {
        throw new VkAdsApiError(
          "Remarketing counter client is unavailable.",
          "remarketing_counter_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await getCounter.call(vkAdsClient, counterId);
      let counter: VkAdsRemarketingCountersResult["items"][number];
      const request = {
        ...(changes.name === undefined
          ? {}
          : { name: changes.name }),
        ...(changes.flags === undefined
          ? {}
          : { flags: changes.flags }),
      };

      try {
        await updateCounter.call(vkAdsClient, counterId, request);
        counter = await getCounter.call(vkAdsClient, counterId);

        if (
          (changes.name !== undefined &&
            counter.name !== changes.name) ||
          (changes.flags !== undefined &&
            (counter.flags.length !== changes.flags.length ||
              changes.flags.some(
                (flag) => !counter.flags.includes(flag),
              )))
        ) {
          throw new VkAdsApiError(
            "Updated counter could not be verified.",
            "remarketing_counter_verification_failed",
          );
        }
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.counters.update",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "remarketing.counters.update",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Счётчик изменён и проверен.",
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true as const,
          auditRecorded: true,
          counter,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_COUNTER_DELETE_TOOL,
    {
      title: "Удалить счётчик ремаркетинга VK Рекламы",
      description:
        "Удаляет доступный счётчик через выбранную версию API и подтверждает его отсутствие списком v2.",
      inputSchema: {
        counterId: z.number().int().positive(),
        version: z.enum(["v1", "v2"]).default("v2"),
      },
      outputSchema: {
        deleted: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        counterId: z.number().int().positive(),
        version: z.enum(["v1", "v2"]),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ counterId, version }) => {
      const getCounter = vkAdsClient.getRemarketingCounter;
      const deleteCounter = vkAdsClient.deleteRemarketingCounter;

      if (getCounter === undefined || deleteCounter === undefined) {
        throw new VkAdsApiError(
          "Remarketing counter client is unavailable.",
          "remarketing_counter_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await getCounter.call(vkAdsClient, counterId);

      try {
        await deleteCounter.call(vkAdsClient, counterId, version);
        const remaining =
          await vkAdsClient.listRemarketingCounters({ counterId });

        if (
          remaining.items.some(
            (counter) =>
              counter.counterId === counterId &&
              counter.status !== "deleted",
          )
        ) {
          throw new VkAdsApiError(
            "Deleted counter is still available.",
            "remarketing_counter_verification_failed",
          );
        }
      } catch (error) {
        await auditLog.record({
          operation: `remarketing.counters.${version}.delete`,
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: `remarketing.counters.${version}.delete`,
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Счётчик удалён, отсутствие подтверждено.",
          },
        ],
        structuredContent: {
          deleted: true as const,
          verified: true as const,
          auditRecorded: true,
          counterId,
          version,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_COUNTER_GOALS_LIST_TOOL,
    {
      title: "Получить цели счётчика Top.Mail.Ru",
      description:
        "Возвращает цели доступного счётчика ремаркетинга.",
      inputSchema: {
        counterId: z.number().int().positive(),
      },
      outputSchema: {
        items: z.array(remarketingCounterGoalOutputSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ counterId }) => {
      const getCounter = vkAdsClient.getRemarketingCounter;
      const listGoals = vkAdsClient.listRemarketingCounterGoals;

      if (getCounter === undefined || listGoals === undefined) {
        throw new VkAdsApiError(
          "Counter-goal client is unavailable.",
          "remarketing_counter_goal_client_unavailable",
        );
      }

      await getCounter.call(vkAdsClient, counterId);
      const items = await listGoals.call(vkAdsClient, counterId);

      return {
        content: [
          {
            type: "text",
            text: `Получено целей счётчика: ${items.length}.`,
          },
        ],
        structuredContent: { items },
      };
    },
  );

  server.registerTool(
    REMARKETING_COUNTER_GOAL_CREATE_TOOL,
    {
      title: "Создать цель счётчика Top.Mail.Ru",
      description:
        "Создаёт цель доступного счётчика и подтверждает появление в списке.",
      inputSchema: {
        counterId: z.number().int().positive(),
        goal: remarketingCounterGoalCreateInputSchema,
      },
      outputSchema: {
        created: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        goal: remarketingCounterGoalOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ counterId, goal }) => {
      const getCounter = vkAdsClient.getRemarketingCounter;
      const listGoals = vkAdsClient.listRemarketingCounterGoals;
      const createGoal = vkAdsClient.createRemarketingCounterGoal;

      if (
        getCounter === undefined ||
        listGoals === undefined ||
        createGoal === undefined
      ) {
        throw new VkAdsApiError(
          "Counter-goal client is unavailable.",
          "remarketing_counter_goal_client_unavailable",
        );
      }

      const request: CreateVkAdsRemarketingCounterGoalInput = {
        name: goal.name,
        ...(goal.substr === undefined
          ? {}
          : { substr: goal.substr }),
        ...(goal.value === undefined ? {} : { value: goal.value }),
        ...(goal.condition === undefined
          ? {}
          : { condition: goal.condition }),
        ...(goal.goalType === undefined
          ? {}
          : { goal_type: goal.goalType }),
      };
      await auditLog.ensureReady();
      await getCounter.call(vkAdsClient, counterId);
      const before = await listGoals.call(vkAdsClient, counterId);
      let created: VkAdsRemarketingCounterGoal;

      try {
        created = await createGoal.call(
          vkAdsClient,
          counterId,
          request,
        );
        const after = await listGoals.call(vkAdsClient, counterId);
        const matches = after.filter(
          (candidate) =>
            candidate.name === request.name &&
            (request.substr === undefined ||
              candidate.substr === request.substr) &&
            (request.value === undefined ||
              candidate.value === request.value) &&
            (request.condition === undefined ||
              candidate.condition === request.condition) &&
            (request.goal_type === undefined ||
              candidate.goalType === request.goal_type),
        );

        if (
          after.length <= before.length ||
          matches.length === 0
        ) {
          throw new VkAdsApiError(
            "Created counter goal could not be verified.",
            "remarketing_counter_goal_verification_failed",
          );
        }
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.counter_goals.create",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "remarketing.counter_goals.create",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Цель счётчика создана и проверена.",
          },
        ],
        structuredContent: {
          created: true as const,
          verified: true as const,
          auditRecorded: true,
          goal: created,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_COUNTER_GOAL_UPDATE_TOOL,
    {
      title: "Изменить цель счётчика Top.Mail.Ru",
      description:
        "Изменяет цель доступного счётчика и подтверждает результат повторным чтением списка.",
      inputSchema: {
        counterId: z.number().int().positive(),
        goalId: z.union([
          z.number().int().positive(),
          z.string().min(1),
        ]),
        changes: z
          .object({
            value: z.number().finite().optional(),
            name: z.string().min(1).optional(),
            goalType: z.string().min(1).optional(),
          })
          .refine(
            (changes) =>
              Object.values(changes).some(
                (value) => value !== undefined,
              ),
            "Укажите хотя бы одно изменение.",
          ),
      },
      outputSchema: {
        updated: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        goal: remarketingCounterGoalOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ counterId, goalId, changes }) => {
      const getCounter = vkAdsClient.getRemarketingCounter;
      const listGoals = vkAdsClient.listRemarketingCounterGoals;
      const updateGoal = vkAdsClient.updateRemarketingCounterGoal;

      if (
        getCounter === undefined ||
        listGoals === undefined ||
        updateGoal === undefined
      ) {
        throw new VkAdsApiError(
          "Counter-goal client is unavailable.",
          "remarketing_counter_goal_client_unavailable",
        );
      }

      const request: UpdateVkAdsRemarketingCounterGoalInput = {
        ...(changes.value === undefined
          ? {}
          : { value: changes.value }),
        ...(changes.name === undefined
          ? {}
          : { name: changes.name }),
        ...(changes.goalType === undefined
          ? {}
          : { goal_type: changes.goalType }),
      };
      await auditLog.ensureReady();
      await getCounter.call(vkAdsClient, counterId);
      const before = await listGoals.call(vkAdsClient, counterId);

      if (
        !before.some(
          (goal) => String(goal.id) === String(goalId),
        )
      ) {
        throw new VkAdsApiError(
          "Counter goal was not found.",
          "unknown_remarketing_counter_goal",
          404,
        );
      }

      let updated: VkAdsRemarketingCounterGoal;

      try {
        await updateGoal.call(
          vkAdsClient,
          counterId,
          goalId,
          request,
        );
        const after = await listGoals.call(vkAdsClient, counterId);
        const reread = after.find(
          (goal) => String(goal.id) === String(goalId),
        );

        if (
          reread === undefined ||
          (request.value !== undefined &&
            reread.value !== request.value) ||
          (request.name !== undefined &&
            reread.name !== request.name) ||
          (request.goal_type !== undefined &&
            reread.goalType !== request.goal_type)
        ) {
          throw new VkAdsApiError(
            "Updated counter goal could not be verified.",
            "remarketing_counter_goal_verification_failed",
          );
        }

        updated = reread;
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.counter_goals.update",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "remarketing.counter_goals.update",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Цель счётчика изменена и проверена.",
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true as const,
          auditRecorded: true,
          goal: updated,
        },
      };
    },
  );

  server.registerTool(
    GOALS_LIST_TOOL,
    {
      title: "Получить доступные цели VK Рекламы",
      description:
        "Возвращает сгруппированный по типам список целей, доступных аккаунту для таргетинга и статистики.",
      inputSchema: {},
      outputSchema: {
        categories: z.record(
          z.string(),
          z.array(
            z.object({
              goal: z.string().min(1),
              description: z.string(),
              id: z.number().int().optional(),
              counterId: z.number().int().optional(),
              counterName: z.string().optional(),
            }),
          ),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const goals = await vkAdsClient.listGoals();
      const structuredContent = {
        categories: goals.categories,
      };
      const goalCount = Object.values(goals.categories).reduce(
        (total, categoryGoals) => total + categoryGoals.length,
        0,
      );

      return {
        content: [
          {
            type: "text",
            text: `Получено доступных целей: ${goalCount}.`,
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    REMARKETING_IN_APP_EVENTS_LIST_TOOL,
    {
      title: "Получить события приложений VK Рекламы",
      description:
        "Возвращает доступные для аудиторий мобильные приложения, их трекеры и события без URL и необработанных полей провайдера.",
      inputSchema: {
        limit: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional(),
        urlObjectId: z.string().min(1).optional(),
      },
      outputSchema: {
        count: z.number().int().nonnegative(),
        offset: z.number().int().nonnegative(),
        items: z.array(
          z.object({
            appId: z.number().int().positive(),
            appName: z.string(),
            platform: z.string().min(1),
            status: z.string().min(1),
            trackers: z.array(
              z.object({
                id: z.number().int().positive(),
                name: z.string(),
                events: z.array(
                  z.object({
                    id: z.number().int().positive(),
                    name: z.string(),
                    categoryId: z
                      .number()
                      .int()
                      .positive()
                      .optional(),
                  }),
                ),
              }),
            ),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const result = await vkAdsClient.listRemarketingInAppEvents({
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.offset === undefined
          ? {}
          : { offset: input.offset }),
        ...(input.urlObjectId === undefined
          ? {}
          : { urlObjectId: input.urlObjectId }),
      });
      const eventCount = result.items.reduce(
        (total, source) =>
          total +
          source.trackers.reduce(
            (trackerTotal, tracker) =>
              trackerTotal + tracker.events.length,
            0,
          ),
        0,
      );
      const structuredContent = {
        count: result.count,
        offset: result.offset,
        items: result.items,
      };

      return {
        content: [
          {
            type: "text",
            text: `Получено событий мобильных приложений: ${eventCount}.`,
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    REMARKETING_IN_APP_EVENT_UPDATE_TOOL,
    {
      title: "Изменить категорию события мобильного приложения",
      description:
        "Изменяет категорию доступного in-app события и подтверждает её повторным чтением.",
      inputSchema: {
        appId: z.number().int().positive(),
        trackerId: z.number().int().positive(),
        eventId: z.number().int().positive(),
        categoryId: z.number().int().positive(),
      },
      outputSchema: {
        updated: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ appId, trackerId, eventId, categoryId }) => {
      const updateEvent =
        vkAdsClient.updateRemarketingInAppEventCategory;

      if (updateEvent === undefined) {
        throw new VkAdsApiError(
          "In-app event update client is unavailable.",
          "remarketing_in_app_event_client_unavailable",
        );
      }

      const findEvent = (
        result: VkAdsRemarketingInAppEventsResult,
      ) =>
        result.items
          .find((source) => source.appId === appId)
          ?.trackers.find((tracker) => tracker.id === trackerId)
          ?.events.find((event) => event.id === eventId);
      await auditLog.ensureReady();
      const before = await vkAdsClient.listRemarketingInAppEvents({
        limit: 50,
        offset: 0,
      });

      if (findEvent(before) === undefined) {
        throw new VkAdsApiError(
          "In-app event was not found.",
          "unknown_remarketing_in_app_event",
          404,
        );
      }

      try {
        await updateEvent.call(
          vkAdsClient,
          appId,
          trackerId,
          eventId,
          categoryId,
        );
        const after =
          await vkAdsClient.listRemarketingInAppEvents({
            limit: 50,
            offset: 0,
          });

        if (findEvent(after)?.categoryId !== categoryId) {
          throw new VkAdsApiError(
            "Updated in-app event could not be verified.",
            "remarketing_in_app_event_verification_failed",
          );
        }
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.in_app_events.update",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "remarketing.in_app_events.update",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Категория события изменена и проверена.",
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true as const,
          auditRecorded: true,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_OFFLINE_GOALS_LIST_TOOL,
    {
      title: "Получить офлайн-цели VK Рекламы",
      description:
        "Возвращает безопасный список загруженных офлайн-конверсий с типом, периодом атрибуции и статусом обработки.",
      inputSchema: {},
      outputSchema: {
        items: z.array(
          z.object({
            id: z.number().int().positive(),
            name: z.string(),
            type: z.enum(["email", "phone"]),
            attributionPeriod: z.number().int().positive(),
            loadStatus: z.string().min(1).optional(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const listOfflineGoals =
        vkAdsClient.listRemarketingOfflineGoals;

      if (listOfflineGoals === undefined) {
        throw new VkAdsApiError(
          "Remarketing offline-goal capability is unavailable.",
          "remarketing_offline_goal_client_unavailable",
        );
      }

      const result = await listOfflineGoals.call(vkAdsClient);

      return {
        content: [
          {
            type: "text",
            text: `Получено офлайн-целей: ${result.items.length}.`,
          },
        ],
        structuredContent: {
          items: result.items,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_OFFLINE_GOAL_CREATE_TOOL,
    {
      title: "Создать офлайн-цель VK Рекламы",
      description:
        "Загружает локальный файл email-адресов или телефонов в новый список офлайн-конверсий, затем перечитывает коллекцию и проверяет созданный объект. Файл и его содержимое не возвращаются и не записываются в audit.",
      inputSchema: {
        filePath: z
          .string()
          .min(1)
          .refine((value) => isAbsolute(value), {
            message:
              "Путь к файлу офлайн-конверсий должен быть абсолютным.",
          }),
        name: z.string().min(1),
        type: z.enum(["email", "phone"]),
        attributionPeriod: z.number().int().positive(),
      },
      outputSchema: {
        created: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        offlineGoal: z.object({
          id: z.number().int().positive(),
          name: z.string(),
          type: z.enum(["email", "phone"]),
          attributionPeriod: z.number().int().positive(),
          loadStatus: z.string().min(1).optional(),
        }),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      filePath,
      name,
      type,
      attributionPeriod,
    }) => {
      const fileInfo = await lstat(filePath);

      if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
        throw new VkAdsApiError(
          "The offline conversions source must be a regular non-symlink file.",
          "invalid_offline_goal_file",
        );
      }

      const listOfflineGoals =
        vkAdsClient.listRemarketingOfflineGoals;
      const createOfflineGoal =
        vkAdsClient.createRemarketingOfflineGoal;

      if (
        listOfflineGoals === undefined ||
        createOfflineGoal === undefined
      ) {
        throw new VkAdsApiError(
          "Remarketing offline-goal capability is unavailable.",
          "remarketing_offline_goal_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const before = await listOfflineGoals.call(vkAdsClient);
      const existingIds = new Set(
        before.items.map((goal) => goal.id),
      );
      const file = await openAsBlob(filePath, {
        type: "text/plain",
      });
      const input: CreateVkAdsRemarketingOfflineGoalInput = {
        name,
        type,
        attribution_period: attributionPeriod,
      };

      try {
        await createOfflineGoal.call(
          vkAdsClient,
          file,
          basename(filePath),
          input,
        );
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.offline_goals.create",
          outcome: "failed",
        });
        throw error;
      }

      const reread = (
        await listOfflineGoals.call(vkAdsClient)
      ).items.find(
        (goal) =>
          !existingIds.has(goal.id) &&
          goal.name === name &&
          goal.type === type &&
          goal.attributionPeriod === attributionPeriod,
      );

      if (reread === undefined) {
        await auditLog.record({
          operation: "remarketing.offline_goals.create",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Created remarketing offline goal could not be verified by provider reread.",
          "remarketing_offline_goal_verification_failed",
        );
      }

      await auditLog.record({
        operation: "remarketing.offline_goals.create",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Офлайн-цель создана и проверена повторным чтением.",
          },
        ],
        structuredContent: {
          created: true as const,
          verified: true as const,
          auditRecorded: true,
          offlineGoal: reread,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_OFFLINE_GOAL_UPDATE_TOOL,
    {
      title: "Изменить офлайн-цель VK Рекламы",
      description:
        "Изменяет название списка офлайн-конверсий и/или дозагружает CSV, затем перечитывает объект. Файл и его содержимое не возвращаются и не записываются в audit.",
      inputSchema: {
        id: z.number().int().positive(),
        name: z.string().min(1).optional(),
        filePath: z
          .string()
          .min(1)
          .refine((value) => isAbsolute(value), {
            message:
              "Путь к файлу офлайн-конверсий должен быть абсолютным.",
          })
          .optional(),
      },
      outputSchema: {
        updated: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        offlineGoal: z.object({
          id: z.number().int().positive(),
          name: z.string(),
          type: z.enum(["email", "phone"]),
          attributionPeriod: z.number().int().positive(),
          loadStatus: z.string().min(1).optional(),
        }),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ id, name, filePath }) => {
      if (name === undefined && filePath === undefined) {
        throw new VkAdsApiError(
          "Offline-goal update requires name or filePath.",
          "empty_offline_goal_update",
        );
      }

      let file: Blob | undefined;
      let filename: string | undefined;

      if (filePath !== undefined) {
        const fileInfo = await lstat(filePath);

        if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
          throw new VkAdsApiError(
            "The offline conversions source must be a regular non-symlink file.",
            "invalid_offline_goal_file",
          );
        }

        file = await openAsBlob(filePath, {
          type: "text/csv",
        });
        filename = basename(filePath);
      }

      const listOfflineGoals =
        vkAdsClient.listRemarketingOfflineGoals;
      const updateOfflineGoal =
        vkAdsClient.updateRemarketingOfflineGoal;

      if (
        listOfflineGoals === undefined ||
        updateOfflineGoal === undefined
      ) {
        throw new VkAdsApiError(
          "Remarketing offline-goal capability is unavailable.",
          "remarketing_offline_goal_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const before = (
        await listOfflineGoals.call(vkAdsClient)
      ).items.find((goal) => goal.id === id);

      if (before === undefined) {
        throw new VkAdsApiError(
          "Remarketing offline goal does not exist.",
          "remarketing_offline_goal_not_found",
        );
      }

      try {
        await updateOfflineGoal.call(
          vkAdsClient,
          id,
          name === undefined ? {} : { name },
          file,
          filename,
        );
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.offline_goals.update",
          outcome: "failed",
        });
        throw error;
      }

      const reread = (
        await listOfflineGoals.call(vkAdsClient)
      ).items.find((goal) => goal.id === id);
      const verified =
        reread !== undefined &&
        (name === undefined || reread.name === name);

      if (!verified) {
        await auditLog.record({
          operation: "remarketing.offline_goals.update",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Updated remarketing offline goal could not be verified by provider reread.",
          "remarketing_offline_goal_verification_failed",
        );
      }

      await auditLog.record({
        operation: "remarketing.offline_goals.update",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Офлайн-цель изменена и проверена повторным чтением.",
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true as const,
          auditRecorded: true,
          offlineGoal: reread,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_OFFLINE_GOAL_DELETE_TOOL,
    {
      title: "Удалить офлайн-цель VK Рекламы",
      description:
        "Удаляет один список офлайн-конверсий и подтверждает его отсутствие повторным чтением.",
      inputSchema: {
        id: z.number().int().positive(),
      },
      outputSchema: {
        deleted: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      const listOfflineGoals =
        vkAdsClient.listRemarketingOfflineGoals;
      const deleteOfflineGoal =
        vkAdsClient.deleteRemarketingOfflineGoal;

      if (
        listOfflineGoals === undefined ||
        deleteOfflineGoal === undefined
      ) {
        throw new VkAdsApiError(
          "Remarketing offline-goal capability is unavailable.",
          "remarketing_offline_goal_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const before = (
        await listOfflineGoals.call(vkAdsClient)
      ).items.find((goal) => goal.id === id);

      if (before === undefined) {
        throw new VkAdsApiError(
          "Remarketing offline goal does not exist.",
          "remarketing_offline_goal_not_found",
        );
      }

      try {
        await deleteOfflineGoal.call(vkAdsClient, id);
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.offline_goals.delete",
          outcome: "failed",
        });
        throw error;
      }

      const stillExists = (
        await listOfflineGoals.call(vkAdsClient)
      ).items.some((goal) => goal.id === id);

      if (stillExists) {
        await auditLog.record({
          operation: "remarketing.offline_goals.delete",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Deleted remarketing offline goal is still present.",
          "remarketing_offline_goal_verification_failed",
        );
      }

      await auditLog.record({
        operation: "remarketing.offline_goals.delete",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Офлайн-цель удалена; отсутствие подтверждено.",
          },
        ],
        structuredContent: {
          deleted: true as const,
          verified: true as const,
          auditRecorded: true,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_USERS_LISTS_LIST_TOOL,
    {
      title: "Получить списки пользователей VK Рекламы",
      description:
        "Возвращает безопасный список загруженных пользовательских аудиторий через актуальный API v3.",
      inputSchema: {
        query: z.string().max(255).optional(),
      },
      outputSchema: {
        items: z.array(remarketingUsersListOutputSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query }) => {
      const listUsersLists =
        vkAdsClient.listRemarketingUsersLists;

      if (listUsersLists === undefined) {
        throw new VkAdsApiError(
          "Remarketing users-list capability is unavailable.",
          "remarketing_users_list_client_unavailable",
        );
      }

      const result = await listUsersLists.call(
        vkAdsClient,
        query,
      );

      return {
        content: [
          {
            type: "text",
            text: `Получено пользовательских списков: ${result.items.length}.`,
          },
        ],
        structuredContent: {
          items: result.items,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_USERS_LIST_GET_TOOL,
    {
      title: "Получить список пользователей VK Рекламы",
      description:
        "Возвращает один загруженный пользовательский список по ID через актуальный API v3.",
      inputSchema: {
        id: z.number().int().positive(),
      },
      outputSchema: {
        usersList: remarketingUsersListOutputSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      const getUsersList =
        vkAdsClient.getRemarketingUsersList;

      if (getUsersList === undefined) {
        throw new VkAdsApiError(
          "Remarketing users-list capability is unavailable.",
          "remarketing_users_list_client_unavailable",
        );
      }

      const usersList = await getUsersList.call(
        vkAdsClient,
        id,
      );

      return {
        content: [
          {
            type: "text",
            text: "Пользовательский список получен.",
          },
        ],
        structuredContent: {
          usersList,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_USERS_LIST_CREATE_TOOL,
    {
      title: "Создать список пользователей VK Рекламы",
      description:
        "Загружает локальный файл идентификаторов в новый пользовательский список, затем перечитывает и проверяет его. Путь и содержимое файла не возвращаются и не записываются в audit.",
      inputSchema: {
        filePath: z
          .string()
          .min(1)
          .refine((value) => isAbsolute(value), {
            message:
              "Путь к файлу пользовательского списка должен быть абсолютным.",
          }),
        name: z.string().min(1),
        type: z.enum([
          "ok",
          "mm",
          "phones",
          "emails",
          "device_id",
          "android_id",
          "advertising_id",
          "idfa",
          "dmp_id",
          "dmp_top",
          "vk",
          "mac",
          "mparticle",
          "human",
        ]),
        base: z
          .number()
          .int()
          .refine((value) => value !== 0, {
            message: "base must contain a non-zero source-list ID.",
          })
          .optional(),
      },
      outputSchema: {
        created: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        usersList: remarketingUsersListOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ filePath, name, type, base }) => {
      const fileInfo = await lstat(filePath);

      if (
        !fileInfo.isFile() ||
        fileInfo.isSymbolicLink() ||
        fileInfo.size === 0 ||
        fileInfo.size > 128 * 1024 * 1024
      ) {
        throw new VkAdsApiError(
          "The users-list source must be a non-empty regular non-symlink file no larger than 128 MiB.",
          "invalid_remarketing_users_list_file",
        );
      }

      const createUsersList =
        vkAdsClient.createRemarketingUsersList;
      const getUsersList =
        vkAdsClient.getRemarketingUsersList;

      if (
        createUsersList === undefined ||
        getUsersList === undefined
      ) {
        throw new VkAdsApiError(
          "Remarketing users-list capability is unavailable.",
          "remarketing_users_list_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const file = await openAsBlob(filePath, {
        type: "text/plain",
      });
      const input: CreateVkAdsRemarketingUsersListInput = {
        name,
        type,
        ...(base === undefined ? {} : { base }),
      };
      let created: { id: number };

      try {
        created = await createUsersList.call(
          vkAdsClient,
          file,
          basename(filePath),
          input,
        );
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.users_lists.create",
          outcome: "failed",
        });
        throw error;
      }

      const reread = await getUsersList.call(
        vkAdsClient,
        created.id,
      );
      const verified =
        reread.id === created.id &&
        reread.name === name &&
        reread.type === type &&
        (base === undefined || reread.base === base);

      if (!verified) {
        await auditLog.record({
          operation: "remarketing.users_lists.create",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Created remarketing users list could not be verified by provider reread.",
          "remarketing_users_list_verification_failed",
        );
      }

      await auditLog.record({
        operation: "remarketing.users_lists.create",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Пользовательский список создан и проверен повторным чтением.",
          },
        ],
        structuredContent: {
          created: true as const,
          verified: true as const,
          auditRecorded: true,
          usersList: reread,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_USERS_LIST_UPDATE_TOOL,
    {
      title: "Переименовать список пользователей VK Рекламы",
      description:
        "Изменяет имя пользовательского списка через актуальный API v3 и проверяет результат повторным чтением.",
      inputSchema: {
        id: z.number().int().positive(),
        name: z.string().min(1),
      },
      outputSchema: {
        updated: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        usersList: remarketingUsersListOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id, name }) => {
      const getUsersList =
        vkAdsClient.getRemarketingUsersList;
      const updateUsersList =
        vkAdsClient.updateRemarketingUsersList;

      if (
        getUsersList === undefined ||
        updateUsersList === undefined
      ) {
        throw new VkAdsApiError(
          "Remarketing users-list capability is unavailable.",
          "remarketing_users_list_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      await getUsersList.call(vkAdsClient, id);

      try {
        await updateUsersList.call(
          vkAdsClient,
          id,
          name,
        );
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.users_lists.update",
          outcome: "failed",
        });
        throw error;
      }

      const reread = await getUsersList.call(
        vkAdsClient,
        id,
      );

      if (reread.name !== name) {
        await auditLog.record({
          operation: "remarketing.users_lists.update",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Updated remarketing users list could not be verified by provider reread.",
          "remarketing_users_list_verification_failed",
        );
      }

      await auditLog.record({
        operation: "remarketing.users_lists.update",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Пользовательский список переименован и проверен повторным чтением.",
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true as const,
          auditRecorded: true,
          usersList: reread,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_USERS_LIST_DELETE_TOOL,
    {
      title: "Удалить список пользователей VK Рекламы",
      description:
        "Удаляет пользовательский список через актуальный API v3 и подтверждает отсутствие повторным чтением коллекции.",
      inputSchema: {
        id: z.number().int().positive(),
      },
      outputSchema: {
        deleted: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      const listUsersLists =
        vkAdsClient.listRemarketingUsersLists;
      const deleteUsersList =
        vkAdsClient.deleteRemarketingUsersList;

      if (
        listUsersLists === undefined ||
        deleteUsersList === undefined
      ) {
        throw new VkAdsApiError(
          "Remarketing users-list capability is unavailable.",
          "remarketing_users_list_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const before = await listUsersLists.call(vkAdsClient);

      if (!before.items.some((item) => item.id === id)) {
        throw new VkAdsApiError(
          "Remarketing users list does not exist.",
          "remarketing_users_list_not_found",
        );
      }

      try {
        await deleteUsersList.call(
          vkAdsClient,
          id,
        );
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.users_lists.delete",
          outcome: "failed",
        });
        throw error;
      }

      const after = await listUsersLists.call(vkAdsClient);

      if (after.items.some((item) => item.id === id)) {
        await auditLog.record({
          operation: "remarketing.users_lists.delete",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Deleted remarketing users list is still present.",
          "remarketing_users_list_verification_failed",
        );
      }

      await auditLog.record({
        operation: "remarketing.users_lists.delete",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Пользовательский список удалён; отсутствие подтверждено.",
          },
        ],
        structuredContent: {
          deleted: true as const,
          verified: true as const,
          auditRecorded: true,
        },
      };
    },
  );

  server.registerTool(
    SEGMENTS_LIST_TOOL,
    {
      title: "Получить сегменты VK Рекламы",
      description:
        "Возвращает страницу составных сегментов ремаркетинга через API v2.",
      inputSchema: {
        limit: z.number().int().positive().max(100).optional(),
        offset: z.number().int().nonnegative().optional(),
        id: z.number().int().positive().optional(),
        ids: z.array(z.number().int().positive()).min(1).optional(),
        name: z.string().min(1).optional(),
        nameStartsWith: z.string().min(1).optional(),
      },
      outputSchema: {
        count: z.number().int().nonnegative(),
        offset: z.number().int().nonnegative(),
        items: z.array(segmentOutputSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      limit,
      offset,
      id,
      ids,
      name,
      nameStartsWith,
    }) => {
      const listSegments = vkAdsClient.listSegments;

      if (listSegments === undefined) {
        throw new VkAdsApiError(
          "Segment capability is unavailable.",
          "segment_client_unavailable",
        );
      }

      const result = await listSegments.call(vkAdsClient, {
        ...(limit === undefined ? {} : { limit }),
        ...(offset === undefined ? {} : { offset }),
        ...(id === undefined ? {} : { id }),
        ...(ids === undefined ? {} : { ids }),
        ...(name === undefined ? {} : { name }),
        ...(nameStartsWith === undefined
          ? {}
          : { nameStartsWith }),
      });

      return {
        content: [
          {
            type: "text",
            text: `Получено сегментов: ${result.items.length}.`,
          },
        ],
        structuredContent: {
          count: result.count,
          offset: result.offset,
          items: result.items,
        },
      };
    },
  );

  server.registerTool(
    SEGMENT_GET_TOOL,
    {
      title: "Получить сегмент VK Рекламы",
      description:
        "Возвращает один составной сегмент ремаркетинга по ID.",
      inputSchema: {
        id: z.number().int().positive(),
      },
      outputSchema: {
        segment: segmentOutputSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      const getSegment = vkAdsClient.getSegment;

      if (getSegment === undefined) {
        throw new VkAdsApiError(
          "Segment capability is unavailable.",
          "segment_client_unavailable",
        );
      }

      const segment = await getSegment.call(vkAdsClient, id);

      return {
        content: [{ type: "text", text: "Сегмент получен." }],
        structuredContent: { segment },
      };
    },
  );

  server.registerTool(
    SEGMENT_CREATE_TOOL,
    {
      title: "Создать сегмент VK Рекламы",
      description:
        "Создаёт составной сегмент с отношениями и проверяет результат повторным чтением.",
      inputSchema: {
        name: z.string().min(1),
        passCondition: z.number().int().positive(),
        relations: z.array(segmentRelationInputSchema).min(1),
      },
      outputSchema: {
        created: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        segment: segmentOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ name, passCondition, relations }) => {
      if (passCondition > relations.length) {
        throw new VkAdsApiError(
          "passCondition cannot exceed relations count.",
          "invalid_segment_pass_condition",
        );
      }

      const createSegment = vkAdsClient.createSegment;
      const getSegment = vkAdsClient.getSegment;

      if (
        createSegment === undefined ||
        getSegment === undefined
      ) {
        throw new VkAdsApiError(
          "Segment capability is unavailable.",
          "segment_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const providerRelations = relations.map((relation) => ({
        object_type: relation.objectType,
        ...(relation.objectId === undefined
          ? {}
          : { object_id: relation.objectId }),
        ...(relation.params === undefined
          ? {}
          : { params: relation.params }),
      }));
      let created: { id: number };

      try {
        created = await createSegment.call(vkAdsClient, {
          name,
          pass_condition: passCondition,
          relations: providerRelations,
        });
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.segments.create",
          outcome: "failed",
        });
        throw error;
      }

      const reread = await getSegment.call(
        vkAdsClient,
        created.id,
      );

      if (
        reread.name !== name ||
        reread.passCondition !== passCondition
      ) {
        await auditLog.record({
          operation: "remarketing.segments.create",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Created segment could not be verified by provider reread.",
          "segment_verification_failed",
        );
      }

      await auditLog.record({
        operation: "remarketing.segments.create",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Сегмент создан и проверен повторным чтением.",
          },
        ],
        structuredContent: {
          created: true as const,
          verified: true as const,
          auditRecorded: true,
          segment: reread,
        },
      };
    },
  );

  server.registerTool(
    SEGMENT_UPDATE_TOOL,
    {
      title: "Изменить сегмент VK Рекламы",
      description:
        "Изменяет имя или условие составного сегмента и проверяет результат повторным чтением.",
      inputSchema: {
        id: z.number().int().positive(),
        name: z.string().min(1).optional(),
        passCondition: z.number().int().positive().optional(),
      },
      outputSchema: {
        updated: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        segment: segmentOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id, name, passCondition }) => {
      if (name === undefined && passCondition === undefined) {
        throw new VkAdsApiError(
          "At least one segment field must be provided.",
          "empty_segment_update",
        );
      }

      const getSegment = vkAdsClient.getSegment;
      const updateSegment = vkAdsClient.updateSegment;

      if (
        getSegment === undefined ||
        updateSegment === undefined
      ) {
        throw new VkAdsApiError(
          "Segment capability is unavailable.",
          "segment_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      await getSegment.call(vkAdsClient, id);
      const input: UpdateVkAdsSegmentInput = {
        ...(name === undefined ? {} : { name }),
        ...(passCondition === undefined
          ? {}
          : { pass_condition: passCondition }),
      };

      try {
        await updateSegment.call(vkAdsClient, id, input);
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.segments.update",
          outcome: "failed",
        });
        throw error;
      }

      const reread = await getSegment.call(vkAdsClient, id);

      if (
        (name !== undefined && reread.name !== name) ||
        (passCondition !== undefined &&
          reread.passCondition !== passCondition)
      ) {
        await auditLog.record({
          operation: "remarketing.segments.update",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Updated segment could not be verified by provider reread.",
          "segment_verification_failed",
        );
      }

      await auditLog.record({
        operation: "remarketing.segments.update",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Сегмент изменён и проверен повторным чтением.",
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true as const,
          auditRecorded: true,
          segment: reread,
        },
      };
    },
  );

  server.registerTool(
    SEGMENT_DELETE_TOOL,
    {
      title: "Удалить сегмент VK Рекламы",
      description:
        "Удаляет составной сегмент и подтверждает отсутствие повторным чтением коллекции.",
      inputSchema: {
        id: z.number().int().positive(),
      },
      outputSchema: {
        deleted: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      const getSegment = vkAdsClient.getSegment;
      const deleteSegment = vkAdsClient.deleteSegment;
      const listSegments = vkAdsClient.listSegments;

      if (
        getSegment === undefined ||
        deleteSegment === undefined ||
        listSegments === undefined
      ) {
        throw new VkAdsApiError(
          "Segment capability is unavailable.",
          "segment_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      await getSegment.call(vkAdsClient, id);

      try {
        await deleteSegment.call(vkAdsClient, id);
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.segments.delete",
          outcome: "failed",
        });
        throw error;
      }

      const after = await listSegments.call(vkAdsClient, { id });

      if (after.items.some((segment) => segment.id === id)) {
        await auditLog.record({
          operation: "remarketing.segments.delete",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Deleted segment is still present.",
          "segment_verification_failed",
        );
      }

      await auditLog.record({
        operation: "remarketing.segments.delete",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Сегмент удалён; отсутствие подтверждено.",
          },
        ],
        structuredContent: {
          deleted: true as const,
          verified: true as const,
          auditRecorded: true,
        },
      };
    },
  );

  server.registerTool(
    SEGMENT_RELATIONS_LIST_TOOL,
    {
      title: "Получить связи сегмента VK Рекламы",
      description:
        "Возвращает все отношения, из которых составлен сегмент ремаркетинга.",
      inputSchema: {
        segmentId: z.number().int().positive(),
      },
      outputSchema: {
        items: z.array(segmentRelationOutputSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ segmentId }) => {
      const getSegment = vkAdsClient.getSegment;
      const listRelations = vkAdsClient.listSegmentRelations;

      if (
        getSegment === undefined ||
        listRelations === undefined
      ) {
        throw new VkAdsApiError(
          "Segment-relation capability is unavailable.",
          "segment_relation_client_unavailable",
        );
      }

      await getSegment.call(vkAdsClient, segmentId);
      const items = await listRelations.call(
        vkAdsClient,
        segmentId,
      );

      return {
        content: [
          {
            type: "text",
            text: `Получено связей сегмента: ${items.length}.`,
          },
        ],
        structuredContent: { items },
      };
    },
  );

  server.registerTool(
    SEGMENT_RELATIONS_CREATE_TOOL,
    {
      title: "Добавить связи сегмента VK Рекламы",
      description:
        "Добавляет одну или несколько связей сегмента и проверяет их повторным чтением.",
      inputSchema: {
        segmentId: z.number().int().positive(),
        items: z.array(segmentRelationInputSchema).min(1),
      },
      outputSchema: {
        created: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        items: z.array(segmentRelationOutputSchema),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ segmentId, items }) => {
      const getSegment = vkAdsClient.getSegment;
      const createRelations =
        vkAdsClient.createSegmentRelations;
      const listRelations = vkAdsClient.listSegmentRelations;

      if (
        getSegment === undefined ||
        createRelations === undefined ||
        listRelations === undefined
      ) {
        throw new VkAdsApiError(
          "Segment-relation capability is unavailable.",
          "segment_relation_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      await getSegment.call(vkAdsClient, segmentId);
      const before = await listRelations.call(
        vkAdsClient,
        segmentId,
      );
      const beforeIds = new Set(
        before.map((relation) => relation.id),
      );
      const providerItems = items.map((item) => ({
        object_type: item.objectType,
        ...(item.objectId === undefined
          ? {}
          : { object_id: item.objectId }),
        ...(item.params === undefined
          ? {}
          : { params: item.params }),
      }));
      try {
        await createRelations.call(
          vkAdsClient,
          segmentId,
          providerItems,
        );
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.segment_relations.create",
          outcome: "failed",
        });
        throw error;
      }

      const reread = await listRelations.call(
        vkAdsClient,
        segmentId,
      );
      const newlyAdded = reread.filter(
        (relation) => !beforeIds.has(relation.id),
      );
      const verified =
        newlyAdded.length === items.length &&
        items.every((item) =>
          newlyAdded.some(
            (relation) =>
              relation.objectType === item.objectType &&
              (item.objectId === undefined ||
                relation.objectId === item.objectId) &&
              (item.params === undefined ||
                providerValueContains(
                  relation.params,
                  item.params,
                )),
          ),
        );

      if (!verified) {
        await auditLog.record({
          operation: "remarketing.segment_relations.create",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Created segment relations could not be verified by provider reread.",
          "segment_relation_verification_failed",
        );
      }

      await auditLog.record({
        operation: "remarketing.segment_relations.create",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Связи сегмента добавлены и проверены повторным чтением.",
          },
        ],
        structuredContent: {
          created: true as const,
          verified: true as const,
          auditRecorded: true,
          items: newlyAdded,
        },
      };
    },
  );

  server.registerTool(
    SEGMENT_RELATION_UPDATE_TOOL,
    {
      title: "Изменить связь сегмента VK Рекламы",
      description:
        "Изменяет параметры одной связи сегмента и проверяет результат повторным чтением.",
      inputSchema: {
        segmentId: z.number().int().positive(),
        relationId: z.number().int().positive(),
        params: z.record(z.string(), z.unknown()).refine(
          (value) => Object.keys(value).length > 0,
          { message: "params must not be empty." },
        ),
      },
      outputSchema: {
        updated: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        relation: segmentRelationOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ segmentId, relationId, params }) => {
      const getSegment = vkAdsClient.getSegment;
      const listRelations = vkAdsClient.listSegmentRelations;
      const updateRelation =
        vkAdsClient.updateSegmentRelation;

      if (
        getSegment === undefined ||
        listRelations === undefined ||
        updateRelation === undefined
      ) {
        throw new VkAdsApiError(
          "Segment-relation capability is unavailable.",
          "segment_relation_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      await getSegment.call(vkAdsClient, segmentId);
      const before = await listRelations.call(
        vkAdsClient,
        segmentId,
      );

      if (!before.some((relation) => relation.id === relationId)) {
        throw new VkAdsApiError(
          "Segment relation does not exist.",
          "segment_relation_not_found",
        );
      }

      try {
        await updateRelation.call(
          vkAdsClient,
          segmentId,
          relationId,
          params,
        );
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.segment_relations.update",
          outcome: "failed",
        });
        throw error;
      }

      const reread = (
        await listRelations.call(vkAdsClient, segmentId)
      ).find((relation) => relation.id === relationId);

      if (
        reread === undefined ||
        !providerValueContains(reread.params, params)
      ) {
        await auditLog.record({
          operation: "remarketing.segment_relations.update",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Updated segment relation could not be verified by provider reread.",
          "segment_relation_verification_failed",
        );
      }

      await auditLog.record({
        operation: "remarketing.segment_relations.update",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Связь сегмента изменена и проверена повторным чтением.",
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true as const,
          auditRecorded: true,
          relation: reread,
        },
      };
    },
  );

  server.registerTool(
    SEGMENT_RELATION_DELETE_TOOL,
    {
      title: "Удалить связь сегмента VK Рекламы",
      description:
        "Удаляет одну связь сегмента и подтверждает отсутствие повторным чтением.",
      inputSchema: {
        segmentId: z.number().int().positive(),
        relationId: z.number().int().positive(),
      },
      outputSchema: {
        deleted: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ segmentId, relationId }) => {
      const getSegment = vkAdsClient.getSegment;
      const listRelations = vkAdsClient.listSegmentRelations;
      const deleteRelation =
        vkAdsClient.deleteSegmentRelation;

      if (
        getSegment === undefined ||
        listRelations === undefined ||
        deleteRelation === undefined
      ) {
        throw new VkAdsApiError(
          "Segment-relation capability is unavailable.",
          "segment_relation_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      await getSegment.call(vkAdsClient, segmentId);
      const before = await listRelations.call(
        vkAdsClient,
        segmentId,
      );

      if (!before.some((relation) => relation.id === relationId)) {
        throw new VkAdsApiError(
          "Segment relation does not exist.",
          "segment_relation_not_found",
        );
      }

      try {
        await deleteRelation.call(
          vkAdsClient,
          segmentId,
          relationId,
        );
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.segment_relations.delete",
          outcome: "failed",
        });
        throw error;
      }

      const after = await listRelations.call(
        vkAdsClient,
        segmentId,
      );

      if (after.some((relation) => relation.id === relationId)) {
        await auditLog.record({
          operation: "remarketing.segment_relations.delete",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Deleted segment relation is still present.",
          "segment_relation_verification_failed",
        );
      }

      await auditLog.record({
        operation: "remarketing.segment_relations.delete",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Связь сегмента удалена; отсутствие подтверждено.",
          },
        ],
        structuredContent: {
          deleted: true as const,
          verified: true as const,
          auditRecorded: true,
        },
      };
    },
  );

  server.registerTool(
    SHARING_KEYS_LIST_TOOL,
    {
      title: "Получить ключи доступа VK Рекламы",
      description:
        "Возвращает созданные владельцем ключи доступа к источникам данных без usernames и URL активации.",
      inputSchema: {
        key: z.string().min(1).max(255).optional(),
      },
      outputSchema: {
        items: z.array(sharingKeyOutputSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ key }) => {
      const listSharingKeys = vkAdsClient.listSharingKeys;

      if (listSharingKeys === undefined) {
        throw new VkAdsApiError(
          "Sharing-key capability is unavailable.",
          "sharing_key_client_unavailable",
        );
      }

      const items = await listSharingKeys.call(
        vkAdsClient,
        key,
      );

      return {
        content: [
          {
            type: "text",
            text: `Получено ключей доступа: ${items.length}.`,
          },
        ],
        structuredContent: { items },
      };
    },
  );

  server.registerTool(
    SHARING_KEY_CREATE_TOOL,
    {
      title: "Создать ключ доступа VK Рекламы",
      description:
        "Создаёт ключ доступа к указанным источникам данных и проверяет его повторным чтением.",
      inputSchema: {
        sources: z.array(sharingKeySourceInputSchema).min(1),
        sendEmail: z.boolean().optional(),
        users: z
          .array(
            z.object({
              username: z.string().min(1).max(255),
            }),
          )
          .optional(),
        isMarketplace: z.boolean().optional(),
        paymentType: z.string().min(1).optional(),
        price: z.string().min(1).optional(),
      },
      outputSchema: {
        created: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        sharingKey: sharingKeyOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      sources,
      sendEmail,
      users,
      isMarketplace,
      paymentType,
      price,
    }) => {
      const createSharingKey = vkAdsClient.createSharingKey;
      const listSharingKeys = vkAdsClient.listSharingKeys;

      if (
        createSharingKey === undefined ||
        listSharingKeys === undefined
      ) {
        throw new VkAdsApiError(
          "Sharing-key capability is unavailable.",
          "sharing_key_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const providerSources = sources.map((source) => ({
        object_type: source.objectType,
        object_id: source.objectId,
      }));
      const input: CreateVkAdsSharingKeyInput = {
        sources: providerSources,
        ...(sendEmail === undefined
          ? {}
          : { send_email: sendEmail }),
        ...(users === undefined ? {} : { users }),
        ...(isMarketplace === undefined
          ? {}
          : { is_marketplace: isMarketplace }),
        ...(paymentType === undefined
          ? {}
          : { payment_type: paymentType }),
        ...(price === undefined ? {} : { price }),
      };
      let created: VkAdsSharingKey;

      try {
        created = await createSharingKey.call(
          vkAdsClient,
          input,
        );
      } catch (error) {
        await auditLog.record({
          operation: "sharing_keys.create",
          outcome: "failed",
        });
        throw error;
      }

      const reread = (
        await listSharingKeys.call(
          vkAdsClient,
          created.sharingKey,
        )
      ).find(
        (item) => item.sharingKey === created.sharingKey,
      );
      const verified =
        reread !== undefined &&
        sources.every((source) =>
          reread.sources.some(
            (actual) =>
              actual.objectType === source.objectType &&
              actual.objectId === source.objectId,
          ),
        );

      if (!verified) {
        await auditLog.record({
          operation: "sharing_keys.create",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Created sharing key could not be verified by provider reread.",
          "sharing_key_verification_failed",
        );
      }

      await auditLog.record({
        operation: "sharing_keys.create",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Ключ доступа создан и проверен повторным чтением.",
          },
        ],
        structuredContent: {
          created: true as const,
          verified: true as const,
          auditRecorded: true,
          sharingKey: reread,
        },
      };
    },
  );

  server.registerTool(
    SHARING_KEY_ACTIVATE_TOOL,
    {
      title: "Активировать ключ доступа VK Рекламы",
      description:
        "Активирует чужой ключ доступа полностью или для выбранных источников. Владелец не может активировать собственный ключ.",
      inputSchema: {
        key: z.string().min(1).max(255),
        sources: z.array(sharingKeySourceInputSchema).min(1).optional(),
      },
      outputSchema: {
        activated: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        sources: z.array(sharingKeySourceOutputSchema),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ key, sources }) => {
      const activateSharingKey =
        vkAdsClient.activateSharingKey;

      if (activateSharingKey === undefined) {
        throw new VkAdsApiError(
          "Sharing-key activation capability is unavailable.",
          "sharing_key_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const providerSources = sources?.map((source) => ({
        object_type: source.objectType,
        object_id: source.objectId,
      }));
      let activated: {
        id: number;
        sources: VkAdsSharingKeySource[];
      };

      try {
        activated = await activateSharingKey.call(
          vkAdsClient,
          key,
          providerSources,
        );
      } catch (error) {
        await auditLog.record({
          operation: "sharing_keys.activate",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "sharing_keys.activate",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Ключ доступа активирован; ответ VK проверен.",
          },
        ],
        structuredContent: {
          activated: true as const,
          verified: true as const,
          auditRecorded: true,
          sources: activated.sources,
        },
      };
    },
  );

  server.registerTool(
    SHARING_KEY_DELETE_TOOL,
    {
      title: "Удалить ключ доступа VK Рекламы",
      description:
        "Удаляет принадлежащий текущему пользователю ключ и подтверждает его отсутствие.",
      inputSchema: {
        key: z.string().min(1).max(255),
      },
      outputSchema: {
        deleted: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ key }) => {
      const listSharingKeys = vkAdsClient.listSharingKeys;
      const deleteSharingKey = vkAdsClient.deleteSharingKey;

      if (
        listSharingKeys === undefined ||
        deleteSharingKey === undefined
      ) {
        throw new VkAdsApiError(
          "Sharing-key capability is unavailable.",
          "sharing_key_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const before = await listSharingKeys.call(
        vkAdsClient,
        key,
      );

      if (!before.some((item) => item.sharingKey === key)) {
        throw new VkAdsApiError(
          "Sharing key does not exist or is not owned by the current user.",
          "sharing_key_not_found",
        );
      }

      try {
        await deleteSharingKey.call(vkAdsClient, key);
      } catch (error) {
        await auditLog.record({
          operation: "sharing_keys.delete",
          outcome: "failed",
        });
        throw error;
      }

      const after = await listSharingKeys.call(
        vkAdsClient,
        key,
      );

      if (after.some((item) => item.sharingKey === key)) {
        await auditLog.record({
          operation: "sharing_keys.delete",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Deleted sharing key is still present.",
          "sharing_key_verification_failed",
        );
      }

      await auditLog.record({
        operation: "sharing_keys.delete",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Ключ доступа удалён; отсутствие подтверждено.",
          },
        ],
        structuredContent: {
          deleted: true as const,
          verified: true as const,
          auditRecorded: true,
        },
      };
    },
  );

  server.registerTool(
    AUDIT_PIXEL_CHECK_TOOL,
    {
      title: "Проверить аудит-пиксель VK Рекламы",
      description:
        "Проверяет URL аудит-пикселя и возвращает варианты, сформированные VK Рекламой.",
      inputSchema: {
        auditPixel: z.string().url(),
      },
      outputSchema: {
        auditPixel: z.string().url(),
        generatedAuditPixels: z.array(auditPixelOutputSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ auditPixel }) => {
      const checkAuditPixel = vkAdsClient.checkAuditPixel;

      if (checkAuditPixel === undefined) {
        throw new VkAdsApiError(
          "Audit-pixel capability is unavailable.",
          "audit_pixel_client_unavailable",
        );
      }

      const result = await checkAuditPixel.call(
        vkAdsClient,
        auditPixel,
      );

      return {
        content: [
          {
            type: "text",
            text: `Аудит-пиксель проверен; сформировано вариантов: ${result.generatedAuditPixels.length}.`,
          },
        ],
        structuredContent: {
          auditPixel: result.auditPixel,
          generatedAuditPixels: result.generatedAuditPixels,
        },
      };
    },
  );

  server.registerTool(
    PROJECTION_PREDICT_TOOL,
    {
      title: "Получить прогноз VK Рекламы",
      description:
        "Возвращает прогноз цены, охвата, CTR и CR для кампании либо пакетов и таргетингов.",
      inputSchema: {
        campaignId: z.number().int().positive().optional(),
        packageIds: z
          .array(z.number().int().positive())
          .min(1)
          .optional(),
        targetings: z
          .record(z.string(), z.unknown())
          .refine(
            (value) =>
              Array.isArray(value.pads) &&
              value.pads.length > 0 &&
              value.pads.every(
                (item) =>
                  typeof item === "number" &&
                  Number.isInteger(item) &&
                  item > 0,
              ),
            "targetings.pads must contain positive integer IDs.",
          ),
      },
      outputSchema: {
        crCtr: z.array(
          z.object({
            packageId: z.number().int().positive(),
            histogramId: z.number().int().positive(),
            avgCr: z.number().nullable(),
            avgCtr: z.number(),
          }),
        ),
        histograms: z.array(
          z.object({
            id: z.number().int().positive(),
            points: z.array(projectionPointOutputSchema),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ campaignId, packageIds, targetings }) => {
      if ((campaignId === undefined) === (packageIds === undefined)) {
        throw new VkAdsApiError(
          "Provide exactly one of campaignId or packageIds.",
          "projection_input_invalid",
        );
      }

      const predictProjection = vkAdsClient.predictProjection;

      if (predictProjection === undefined) {
        throw new VkAdsApiError(
          "Projection capability is unavailable.",
          "projection_client_unavailable",
        );
      }

      const input: VkAdsProjectionInput =
        campaignId === undefined
          ? {
              targetings,
              package_ids: packageIds!,
            }
          : {
              targetings,
              campaign_id: campaignId,
            };
      const result = await predictProjection.call(
        vkAdsClient,
        input,
      );

      return {
        content: [
          {
            type: "text",
            text: `Прогноз получен; гистограмм: ${result.histograms.length}.`,
          },
        ],
        structuredContent: {
          crCtr: result.crCtr,
          histograms: result.histograms,
        },
      };
    },
  );

  server.registerTool(
    STATISTICS_DAY_LIST_TOOL,
    {
      title: "Получить дневную статистику VK Рекламы",
      description:
        "Возвращает пагинированную статистику API v3 по объявлениям, группам, кампаниям или аккаунтам.",
      inputSchema: {
        resource: z.enum([
          "banners",
          "ad_groups",
          "ad_plans",
          "users",
        ]),
        dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        dateTo: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        ids: statisticsIdListSchema.optional(),
        excludedIds: statisticsIdListSchema.optional(),
        fields: z.array(z.string().min(1)).min(1).optional(),
        attribution: z.enum(["conversion", "impression"]).optional(),
        bannerStatuses: z
          .array(statisticsStatusSchema)
          .min(1)
          .optional(),
        excludedBannerStatuses: z
          .array(statisticsStatusSchema)
          .min(1)
          .optional(),
        adGroupStatuses: z
          .array(statisticsStatusSchema)
          .min(1)
          .optional(),
        excludedAdGroupStatuses: z
          .array(statisticsStatusSchema)
          .min(1)
          .optional(),
        adGroupIds: statisticsIdListSchema.optional(),
        excludedAdGroupIds: statisticsIdListSchema.optional(),
        packageIds: statisticsIdListSchema.optional(),
        excludedPackageIds: statisticsIdListSchema.optional(),
        sortBy: z.string().min(1).optional(),
        direction: z.enum(["asc", "desc"]).optional(),
        limit: z.number().int().min(1).max(250).optional(),
        offset: z.number().int().nonnegative().optional(),
      },
      outputSchema: {
        items: z.array(
          z.object({
            id: z.number().int().positive(),
            userId: z.number().int().positive().optional(),
            total: statisticsMetricRecordSchema,
          }),
        ),
        total: statisticsMetricRecordSchema,
        limit: z.number().int().positive(),
        offset: z.number().int().nonnegative(),
        count: z.number().int().nonnegative(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      resource,
      dateFrom,
      dateTo,
      ids,
      excludedIds,
      fields,
      attribution,
      bannerStatuses,
      excludedBannerStatuses,
      adGroupStatuses,
      excludedAdGroupStatuses,
      adGroupIds,
      excludedAdGroupIds,
      packageIds,
      excludedPackageIds,
      sortBy,
      direction,
      limit,
      offset,
    }) => {
      if (
        dateTo !== undefined &&
        Date.parse(dateTo) < Date.parse(dateFrom)
      ) {
        throw new VkAdsApiError(
          "dateTo must not be earlier than dateFrom.",
          "statistics_period_invalid",
        );
      }

      const listStatisticsDay = vkAdsClient.listStatisticsDay;

      if (listStatisticsDay === undefined) {
        throw new VkAdsApiError(
          "Statistics capability is unavailable.",
          "statistics_client_unavailable",
        );
      }

      const input: ListVkAdsStatisticsDayInput = {
        resource,
        date_from: dateFrom,
        ...(dateTo === undefined ? {} : { date_to: dateTo }),
        ...(ids === undefined ? {} : { ids }),
        ...(excludedIds === undefined
          ? {}
          : { excluded_ids: excludedIds }),
        ...(fields === undefined ? {} : { fields }),
        ...(attribution === undefined ? {} : { attribution }),
        ...(bannerStatuses === undefined
          ? {}
          : { banner_statuses: bannerStatuses }),
        ...(excludedBannerStatuses === undefined
          ? {}
          : { excluded_banner_statuses: excludedBannerStatuses }),
        ...(adGroupStatuses === undefined
          ? {}
          : { ad_group_statuses: adGroupStatuses }),
        ...(excludedAdGroupStatuses === undefined
          ? {}
          : {
              excluded_ad_group_statuses:
                excludedAdGroupStatuses,
            }),
        ...(adGroupIds === undefined
          ? {}
          : { ad_group_ids: adGroupIds }),
        ...(excludedAdGroupIds === undefined
          ? {}
          : { excluded_ad_group_ids: excludedAdGroupIds }),
        ...(packageIds === undefined
          ? {}
          : { package_ids: packageIds }),
        ...(excludedPackageIds === undefined
          ? {}
          : { excluded_package_ids: excludedPackageIds }),
        ...(sortBy === undefined ? {} : { sort_by: sortBy }),
        ...(direction === undefined ? {} : { direction }),
        ...(limit === undefined ? {} : { limit }),
        ...(offset === undefined ? {} : { offset }),
      };
      const result = await listStatisticsDay.call(
        vkAdsClient,
        input,
      );

      return {
        content: [
          {
            type: "text",
            text: `Получена статистика: ${result.items.length} объектов.`,
          },
        ],
        structuredContent: {
          items: result.items,
          total: result.total,
          limit: result.limit,
          offset: result.offset,
          count: result.count,
        },
      };
    },
  );

  server.registerTool(
    FAST_STATISTICS_GET_TOOL,
    {
      title: "Получить быструю статистику VK Рекламы",
      description:
        "Возвращает необработанные поминутные показы и клики за последние 60 минут.",
      inputSchema: {
        resource: z.enum([
          "banners",
          "campaigns",
          "ad_plans",
          "users",
        ]),
        ids: statisticsIdListSchema,
      },
      outputSchema: {
        lastSeen: z.object({
          timestamp: z.number().int().nonnegative(),
          string: z.string(),
          ago: z.number().int().nonnegative(),
        }),
        items: z.array(
          z.object({
            id: z.string().min(1),
            timestamp: z.number().int().nonnegative(),
            clicks: z.array(z.number()),
            shows: z.array(z.number()),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ resource, ids }) => {
      const getFastStatistics = vkAdsClient.getFastStatistics;

      if (getFastStatistics === undefined) {
        throw new VkAdsApiError(
          "Fast-statistics capability is unavailable.",
          "fast_statistics_client_unavailable",
        );
      }

      const result = await getFastStatistics.call(
        vkAdsClient,
        resource,
        ids,
      );

      return {
        content: [
          {
            type: "text",
            text: `Получена быстрая статистика: ${result.items.length} объектов.`,
          },
        ],
        structuredContent: {
          lastSeen: result.lastSeen,
          items: result.items,
        },
      };
    },
  );

  server.registerTool(
    V2_STATISTICS_GET_TOOL,
    {
      title: "Получить статистику VK Рекламы API v2",
      description:
        "Возвращает дневную или суммарную статистику по объявлениям, группам, кампаниям или аккаунтам.",
      inputSchema: {
        resource: statisticsResourceSchema,
        granularity: z.enum(["day", "summary"]),
        dateFrom: statisticsDateSchema,
        dateTo: statisticsDateSchema,
        ids: statisticsIdListSchema,
        metrics: z.array(z.string().min(1)).min(1).optional(),
        attribution: z.enum(["conversion", "impression"]).optional(),
      },
      outputSchema: v2StatisticsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      resource,
      granularity,
      dateFrom,
      dateTo,
      ids,
      metrics,
      attribution,
    }) => {
      if (Date.parse(dateTo) < Date.parse(dateFrom)) {
        throw new VkAdsApiError(
          "dateTo must not be earlier than dateFrom.",
          "statistics_period_invalid",
        );
      }

      const getGeneralStatistics =
        vkAdsClient.getGeneralStatistics;

      if (getGeneralStatistics === undefined) {
        throw new VkAdsApiError(
          "V2 statistics capability is unavailable.",
          "statistics_client_unavailable",
        );
      }

      const result = await getGeneralStatistics.call(
        vkAdsClient,
        {
          resource,
          granularity,
          date_from: dateFrom,
          date_to: dateTo,
          ids,
          ...(metrics === undefined ? {} : { metrics }),
          ...(attribution === undefined ? {} : { attribution }),
        },
      );

      return {
        content: [
          {
            type: "text",
            text: `Получена статистика API v2: ${result.items.length} объектов.`,
          },
        ],
        structuredContent: {
          items: result.items,
          total: result.total,
        },
      };
    },
  );

  server.registerTool(
    GOAL_STATISTICS_GET_TOOL,
    {
      title: "Получить статистику целей VK Рекламы",
      description:
        "Возвращает дневную статистику конверсий Top.Mail.Ru и мобильных установок.",
      inputSchema: {
        resource: statisticsResourceSchema,
        dateFrom: statisticsDateSchema,
        dateTo: statisticsDateSchema,
        ids: statisticsIdListSchema,
        attribution: z.enum(["conversion", "impression"]).optional(),
        conversionTypes: z
          .array(conversionTypeSchema)
          .min(1)
          .optional(),
      },
      outputSchema: v2StatisticsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      resource,
      dateFrom,
      dateTo,
      ids,
      attribution,
      conversionTypes,
    }) => {
      if (Date.parse(dateTo) < Date.parse(dateFrom)) {
        throw new VkAdsApiError(
          "dateTo must not be earlier than dateFrom.",
          "statistics_period_invalid",
        );
      }

      const getGoalStatistics = vkAdsClient.getGoalStatistics;

      if (getGoalStatistics === undefined) {
        throw new VkAdsApiError(
          "Goal-statistics capability is unavailable.",
          "statistics_client_unavailable",
        );
      }

      const result = await getGoalStatistics.call(vkAdsClient, {
        resource,
        date_from: dateFrom,
        date_to: dateTo,
        ids,
        ...(attribution === undefined ? {} : { attribution }),
        ...(conversionTypes === undefined
          ? {}
          : { conversion_types: conversionTypes }),
      });

      return {
        content: [
          {
            type: "text",
            text: `Получена статистика целей: ${result.items.length} объектов.`,
          },
        ],
        structuredContent: {
          items: result.items,
          total: result.total,
        },
      };
    },
  );

  server.registerTool(
    IN_APP_STATISTICS_GET_TOOL,
    {
      title: "Получить статистику событий приложений VK Рекламы",
      description:
        "Возвращает дневную статистику событий мобильных приложений, атрибутированных рекламе.",
      inputSchema: {
        resource: statisticsResourceSchema,
        dateFrom: statisticsDateSchema,
        dateTo: statisticsDateSchema,
        ids: statisticsIdListSchema,
        attribution: z.enum(["conversion", "impression"]).optional(),
        conversionTypes: z
          .array(conversionTypeSchema)
          .min(1)
          .optional(),
      },
      outputSchema: v2StatisticsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      resource,
      dateFrom,
      dateTo,
      ids,
      attribution,
      conversionTypes,
    }) => {
      if (Date.parse(dateTo) < Date.parse(dateFrom)) {
        throw new VkAdsApiError(
          "dateTo must not be earlier than dateFrom.",
          "statistics_period_invalid",
        );
      }

      const getInAppStatistics = vkAdsClient.getInAppStatistics;

      if (getInAppStatistics === undefined) {
        throw new VkAdsApiError(
          "In-app statistics capability is unavailable.",
          "statistics_client_unavailable",
        );
      }

      const result = await getInAppStatistics.call(vkAdsClient, {
        resource,
        date_from: dateFrom,
        date_to: dateTo,
        ids,
        ...(attribution === undefined ? {} : { attribution }),
        ...(conversionTypes === undefined
          ? {}
          : { conversion_types: conversionTypes }),
      });

      return {
        content: [
          {
            type: "text",
            text: `Получена статистика событий приложений: ${result.items.length} объектов.`,
          },
        ],
        structuredContent: {
          items: result.items,
          total: result.total,
        },
      };
    },
  );

  const registerOfflineConversionStatisticsTool = (
    name:
      | typeof OFFLINE_CONVERSION_STATISTICS_DAY_GET_TOOL
      | typeof OFFLINE_CONVERSION_STATISTICS_SUMMARY_GET_TOOL,
    granularity: "day" | "summary",
  ): void => {
    server.registerTool(
      name,
      {
        title:
          granularity === "day"
            ? "Получить дневную статистику офлайн-конверсий"
            : "Получить суммарную статистику офлайн-конверсий",
        description:
          "Возвращает статистику событий из списков офлайн-конверсий по аккаунтам, группам или кампаниям.",
        inputSchema: {
          resource: offlineConversionStatisticsResourceSchema,
          dateFrom: statisticsDateSchema,
          dateTo: statisticsDateSchema,
          ids: statisticsIdListSchema,
        },
        outputSchema: offlineConversionStatisticsOutputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ resource, dateFrom, dateTo, ids }) => {
        if (Date.parse(dateTo) < Date.parse(dateFrom)) {
          throw new VkAdsApiError(
            "dateTo must not be earlier than dateFrom.",
            "statistics_period_invalid",
          );
        }

        const getOfflineConversionStatistics =
          vkAdsClient.getOfflineConversionStatistics;

        if (getOfflineConversionStatistics === undefined) {
          throw new VkAdsApiError(
            "Offline-conversion statistics capability is unavailable.",
            "statistics_client_unavailable",
          );
        }

        const result = await getOfflineConversionStatistics.call(
          vkAdsClient,
          {
            resource,
            granularity,
            date_from: dateFrom,
            date_to: dateTo,
            ids,
          },
        );

        return {
          content: [
            {
              type: "text",
              text:
                result.source === "day_fallback"
                  ? `Получена итоговая статистика офлайн-конверсий через временный fallback day.json: ${result.items.length} объектов.`
                  : `Получена статистика офлайн-конверсий: ${result.items.length} объектов.`,
            },
          ],
          structuredContent: {
            items: result.items,
            source: result.source,
          },
        };
      },
    );
  };

  registerOfflineConversionStatisticsTool(
    OFFLINE_CONVERSION_STATISTICS_DAY_GET_TOOL,
    "day",
  );
  registerOfflineConversionStatisticsTool(
    OFFLINE_CONVERSION_STATISTICS_SUMMARY_GET_TOOL,
    "summary",
  );

  server.registerTool(
    LEAD_FORM_LOGO_UPLOAD_TOOL,
    {
      title: "Загрузить логотип лид-формы VK Рекламы",
      description:
        "Загружает локальный JPG или PNG как обязательный логотип лид-формы.",
      inputSchema: {
        filePath: z
          .string()
          .min(1)
          .refine((value) => isAbsolute(value), {
            message: "Путь к изображению должен быть абсолютным.",
          }),
      },
      outputSchema: {
        uploaded: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        id: z.string().min(1),
        variants: z.array(z.string().min(1)).min(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ filePath }) => {
      const extension = extname(filePath).toLowerCase();
      const contentType =
        extension === ".png"
          ? "image/png"
          : extension === ".jpg" || extension === ".jpeg"
            ? "image/jpeg"
            : undefined;

      if (contentType === undefined) {
        throw new VkAdsApiError(
          "The lead-form logo must be a JPG or PNG image.",
          "invalid_lead_form_logo",
        );
      }

      const fileInfo = await lstat(filePath);

      if (
        !fileInfo.isFile() ||
        fileInfo.isSymbolicLink() ||
        fileInfo.size > 5 * 1024 * 1024
      ) {
        throw new VkAdsApiError(
          "The lead-form logo must be a regular non-symlink file no larger than 5 MB.",
          "invalid_lead_form_logo",
        );
      }

      const uploadLeadFormLogo = vkAdsClient.uploadLeadFormLogo;

      if (uploadLeadFormLogo === undefined) {
        throw new VkAdsApiError(
          "Lead-form logo capability is unavailable.",
          "lead_form_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const file = await openAsBlob(filePath, { type: contentType });
      let uploaded: VkAdsLeadFormImageUploadResult;

      try {
        uploaded = await uploadLeadFormLogo.call(
          vkAdsClient,
          file,
          basename(filePath),
        );
      } catch (error) {
        await auditLog.record({
          operation: "lead_forms.logo.upload",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "lead_forms.logo.upload",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Логотип лид-формы загружен; ответ VK Рекламы проверен.",
          },
        ],
        structuredContent: {
          uploaded: true as const,
          verified: true as const,
          auditRecorded: true,
          id: uploaded.id,
          variants: uploaded.variants,
        },
      };
    },
  );

  server.registerTool(
    LEAD_FORMS_LIST_TOOL,
    {
      title: "Получить лид-формы VK Рекламы",
      description:
        "Возвращает страницу лид-форм с официальными фильтрами, поиском и сортировкой.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().nonnegative().optional(),
        adPlanIds: statisticsIdListSchema.optional(),
        adGroupIds: statisticsIdListSchema.optional(),
        bannerIds: statisticsIdListSchema.optional(),
        query: z.string().min(1).max(255).optional(),
        sorting: z.array(z.string().min(1)).min(1).optional(),
        includeActiveAdPlanIds: z.boolean().optional(),
      },
      outputSchema: {
        count: z.number().int().nonnegative(),
        offset: z.number().int().nonnegative(),
        limit: z.number().int().positive(),
        items: z.array(leadFormOutputSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      limit,
      offset,
      adPlanIds,
      adGroupIds,
      bannerIds,
      query,
      sorting,
      includeActiveAdPlanIds,
    }) => {
      const listLeadForms = vkAdsClient.listLeadForms;

      if (listLeadForms === undefined) {
        throw new VkAdsApiError(
          "Lead-form capability is unavailable.",
          "lead_form_client_unavailable",
        );
      }

      const result = await listLeadForms.call(vkAdsClient, {
        ...(limit === undefined ? {} : { limit }),
        ...(offset === undefined ? {} : { offset }),
        ...(adPlanIds === undefined ? {} : { adPlanIds }),
        ...(adGroupIds === undefined ? {} : { adGroupIds }),
        ...(bannerIds === undefined ? {} : { bannerIds }),
        ...(query === undefined ? {} : { query }),
        ...(sorting === undefined ? {} : { sorting }),
        ...(includeActiveAdPlanIds === undefined
          ? {}
          : { includeActiveAdPlanIds }),
      });

      return {
        content: [
          {
            type: "text",
            text: `Получено лид-форм: ${result.items.length}.`,
          },
        ],
        structuredContent: {
          count: result.count,
          offset: result.offset,
          limit: result.limit,
          items: result.items,
        },
      };
    },
  );

  server.registerTool(
    LEAD_FORM_GET_TOOL,
    {
      title: "Получить лид-форму VK Рекламы",
      description: "Возвращает одну лид-форму по ID.",
      inputSchema: {
        id: z.number().int().positive(),
      },
      outputSchema: {
        form: leadFormOutputSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      const getLeadForm = vkAdsClient.getLeadForm;

      if (getLeadForm === undefined) {
        throw new VkAdsApiError(
          "Lead-form capability is unavailable.",
          "lead_form_client_unavailable",
        );
      }

      const form = await getLeadForm.call(vkAdsClient, id);

      return {
        content: [{ type: "text", text: "Лид-форма получена." }],
        structuredContent: { form },
      };
    },
  );

  server.registerTool(
    LEAD_FORM_CREATE_TOOL,
    {
      title: "Создать лид-форму VK Рекламы",
      description:
        "Создаёт лид-форму и подтверждает результат повторным чтением.",
      inputSchema: leadFormCreateInputShape,
      outputSchema: {
        created: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        form: leadFormOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      name,
      firstScreenType,
      title,
      description,
      longDescription,
      companyTitle,
      logoId,
      contactFields,
      resultInfo,
      agreement,
      notifications,
      pages,
    }) => {
      const createLeadForm = vkAdsClient.createLeadForm;
      const getLeadForm = vkAdsClient.getLeadForm;

      if (createLeadForm === undefined || getLeadForm === undefined) {
        throw new VkAdsApiError(
          "Lead-form capability is unavailable.",
          "lead_form_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const providerInput: CreateVkAdsLeadFormInput = {
        name,
        first_screen_type: firstScreenType,
        title,
        company_title: companyTitle,
        logo_id: logoId,
        contact_fields: contactFields,
        result_info: resultInfo,
        agreement,
        ...(description === undefined ? {} : { description }),
        ...(longDescription === undefined
          ? {}
          : { long_description: longDescription }),
        ...(notifications === undefined ? {} : { notifications }),
        ...(pages === undefined ? {} : { pages }),
      };
      let created: { id: number };

      try {
        created = await createLeadForm.call(
          vkAdsClient,
          providerInput,
        );
      } catch (error) {
        await auditLog.record({
          operation: "lead_forms.create",
          outcome: "failed",
        });
        throw error;
      }

      const reread = await getLeadForm.call(
        vkAdsClient,
        created.id,
      );

      if (reread.name !== name) {
        await auditLog.record({
          operation: "lead_forms.create",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Created lead form could not be verified.",
          "lead_form_verification_failed",
        );
      }

      await auditLog.record({
        operation: "lead_forms.create",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Лид-форма создана и проверена повторным чтением.",
          },
        ],
        structuredContent: {
          created: true as const,
          verified: true as const,
          auditRecorded: true,
          form: reread,
        },
      };
    },
  );

  server.registerTool(
    LEAD_FORM_UPDATE_TOOL,
    {
      title: "Изменить лид-форму VK Рекламы",
      description:
        "Частично изменяет лид-форму и проверяет сохранённое состояние.",
      inputSchema: {
        id: z.number().int().positive(),
        name: z.string().min(1).max(255).optional(),
        firstScreenType: z
          .enum(["compact", "long_text", "award"])
          .optional(),
        title: z.string().min(1).max(50).optional(),
        description: z.string().min(1).max(35).optional(),
        longDescription: z.string().min(1).optional(),
        companyTitle: z.string().min(1).max(30).optional(),
        logoId: z.string().min(1).optional(),
        contactFields: z
          .array(z.string().min(1))
          .min(1)
          .optional(),
        resultInfo: z
          .record(z.string(), z.unknown())
          .optional(),
        agreement: z.record(z.string(), z.unknown()).optional(),
        notifications: z
          .array(z.record(z.string(), z.unknown()))
          .optional(),
        pages: z
          .array(z.record(z.string(), z.unknown()))
          .min(1)
          .optional(),
      },
      outputSchema: {
        updated: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        form: leadFormOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      id,
      name,
      firstScreenType,
      title,
      description,
      longDescription,
      companyTitle,
      logoId,
      contactFields,
      resultInfo,
      agreement,
      notifications,
      pages,
    }) => {
      const updateLeadForm = vkAdsClient.updateLeadForm;
      const getLeadForm = vkAdsClient.getLeadForm;
      const fields = {
        name,
        firstScreenType,
        title,
        description,
        longDescription,
        companyTitle,
        logoId,
        contactFields,
        resultInfo,
        agreement,
        notifications,
        pages,
      };

      if (Object.values(fields).every((value) => value === undefined)) {
        throw new VkAdsApiError(
          "At least one lead-form field is required.",
          "lead_form_update_empty",
        );
      }

      if (updateLeadForm === undefined || getLeadForm === undefined) {
        throw new VkAdsApiError(
          "Lead-form capability is unavailable.",
          "lead_form_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await getLeadForm.call(vkAdsClient, id);
      const providerInput: UpdateVkAdsLeadFormInput = {
        ...(name === undefined ? {} : { name }),
        ...(firstScreenType === undefined
          ? {}
          : { first_screen_type: firstScreenType }),
        ...(title === undefined ? {} : { title }),
        ...(description === undefined ? {} : { description }),
        ...(longDescription === undefined
          ? {}
          : { long_description: longDescription }),
        ...(companyTitle === undefined
          ? {}
          : { company_title: companyTitle }),
        ...(logoId === undefined ? {} : { logo_id: logoId }),
        ...(contactFields === undefined
          ? {}
          : { contact_fields: contactFields }),
        ...(resultInfo === undefined
          ? {}
          : { result_info: resultInfo }),
        ...(agreement === undefined ? {} : { agreement }),
        ...(notifications === undefined ? {} : { notifications }),
        ...(pages === undefined ? {} : { pages }),
      };

      try {
        await updateLeadForm.call(vkAdsClient, id, providerInput);
      } catch (error) {
        await auditLog.record({
          operation: "lead_forms.update",
          outcome: "failed",
        });
        throw error;
      }

      const reread = await getLeadForm.call(vkAdsClient, id);
      const verified =
        (name === undefined || reread.name === name) &&
        (firstScreenType === undefined ||
          reread.firstScreenType === firstScreenType) &&
        (title === undefined || reread.title === title) &&
        (description === undefined ||
          reread.description === description) &&
        (longDescription === undefined ||
          reread.longDescription === longDescription) &&
        (companyTitle === undefined ||
          reread.companyTitle === companyTitle) &&
        (logoId === undefined || reread.logoId === logoId) &&
        (contactFields === undefined ||
          JSON.stringify(reread.contactFields) ===
            JSON.stringify(contactFields)) &&
        (resultInfo === undefined ||
          JSON.stringify(reread.resultInfo) ===
            JSON.stringify(resultInfo)) &&
        (agreement === undefined ||
          JSON.stringify(reread.agreement) ===
            JSON.stringify(agreement)) &&
        (notifications === undefined ||
          JSON.stringify(reread.notifications) ===
            JSON.stringify(notifications)) &&
        (pages === undefined ||
          JSON.stringify(reread.pages) === JSON.stringify(pages));

      if (!verified) {
        await auditLog.record({
          operation: "lead_forms.update",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Updated lead form could not be verified.",
          "lead_form_verification_failed",
        );
      }

      await auditLog.record({
        operation: "lead_forms.update",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Лид-форма изменена и проверена.",
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true as const,
          auditRecorded: true,
          form: reread,
        },
      };
    },
  );

  server.registerTool(
    LEAD_FORM_COPY_TOOL,
    {
      title: "Копировать лид-форму VK Рекламы",
      description:
        "Создаёт полную копию лид-формы и проверяет её чтением.",
      inputSchema: {
        id: z.number().int().positive(),
        name: z.string().min(1).max(255).optional(),
      },
      outputSchema: {
        copied: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        form: leadFormOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ id, name }) => {
      const copyLeadForm = vkAdsClient.copyLeadForm;
      const getLeadForm = vkAdsClient.getLeadForm;

      if (copyLeadForm === undefined || getLeadForm === undefined) {
        throw new VkAdsApiError(
          "Lead-form capability is unavailable.",
          "lead_form_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await getLeadForm.call(vkAdsClient, id);
      let copied: VkAdsLeadForm;

      try {
        copied = await copyLeadForm.call(vkAdsClient, id, name);
      } catch (error) {
        await auditLog.record({
          operation: "lead_forms.copy",
          outcome: "failed",
        });
        throw error;
      }

      const reread = await getLeadForm.call(
        vkAdsClient,
        copied.id,
      );

      if (
        reread.id === id ||
        (name !== undefined && reread.name !== name)
      ) {
        await auditLog.record({
          operation: "lead_forms.copy",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Copied lead form could not be verified.",
          "lead_form_verification_failed",
        );
      }

      await auditLog.record({
        operation: "lead_forms.copy",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Лид-форма скопирована и проверена.",
          },
        ],
        structuredContent: {
          copied: true as const,
          verified: true as const,
          auditRecorded: true,
          form: reread,
        },
      };
    },
  );

  const registerLeadFormsArchiveTool = (
    name:
      | typeof LEAD_FORMS_ARCHIVE_TOOL
      | typeof LEAD_FORMS_UNARCHIVE_TOOL,
    archived: boolean,
  ): void => {
    server.registerTool(
      name,
      {
        title: archived
          ? "Архивировать лид-формы VK Рекламы"
          : "Вернуть лид-формы из архива VK Рекламы",
        description:
          "Изменяет архивный статус одной или нескольких лид-форм и проверяет каждую повторным чтением.",
        inputSchema: {
          ids: statisticsIdListSchema,
        },
        outputSchema: {
          updated: z.literal(true),
          verified: z.literal(true),
          auditRecorded: z.boolean(),
          forms: z.array(leadFormOutputSchema),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: archived,
          idempotentHint: false,
          openWorldHint: true,
        },
      },
      async ({ ids }) => {
        const setLeadFormsArchived =
          vkAdsClient.setLeadFormsArchived;
        const getLeadForm = vkAdsClient.getLeadForm;

        if (
          setLeadFormsArchived === undefined ||
          getLeadForm === undefined
        ) {
          throw new VkAdsApiError(
            "Lead-form capability is unavailable.",
            "lead_form_client_unavailable",
          );
        }

        await auditLog.ensureReady();
        await Promise.all(
          ids.map(async (id) => await getLeadForm.call(vkAdsClient, id)),
        );

        try {
          await setLeadFormsArchived.call(
            vkAdsClient,
            ids,
            archived,
          );
        } catch (error) {
          await auditLog.record({
            operation: archived
              ? "lead_forms.archive"
              : "lead_forms.unarchive",
            outcome: "failed",
          });
          throw error;
        }

        const forms = await Promise.all(
          ids.map(async (id) => await getLeadForm.call(vkAdsClient, id)),
        );
        const expectedStatus = archived ? 2 : 1;

        if (
          forms.some((form) => form.status !== expectedStatus)
        ) {
          await auditLog.record({
            operation: archived
              ? "lead_forms.archive"
              : "lead_forms.unarchive",
            outcome: "verification_failed",
          });
          throw new VkAdsApiError(
            "Lead-form archival state could not be verified.",
            "lead_form_verification_failed",
          );
        }

        await auditLog.record({
          operation: archived
            ? "lead_forms.archive"
            : "lead_forms.unarchive",
          outcome: "success",
        });

        return {
          content: [
            {
              type: "text",
              text: archived
                ? "Лид-формы архивированы и проверены."
                : "Лид-формы восстановлены и проверены.",
            },
          ],
          structuredContent: {
            updated: true as const,
            verified: true as const,
            auditRecorded: true,
            forms,
          },
        };
      },
    );
  };

  registerLeadFormsArchiveTool(LEAD_FORMS_ARCHIVE_TOOL, true);
  registerLeadFormsArchiveTool(LEAD_FORMS_UNARCHIVE_TOOL, false);

  server.registerTool(
    LEADS_LIST_TOOL,
    {
      title: "Получить лиды VK Рекламы",
      description:
        "Возвращает безопасную страницу метаданных лидов без контактных данных и ответов.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().nonnegative().optional(),
        ...leadListFiltersShape,
      },
      outputSchema: {
        count: z.number().int().nonnegative(),
        offset: z.number().int().nonnegative(),
        limit: z.number().int().nonnegative(),
        items: z.array(leadOutputSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({
      limit,
      offset,
      formIds,
      adPlanIds,
      adGroupIds,
      bannerIds,
      createdAtFrom,
      createdAtTo,
    }) => {
      const listLeads = vkAdsClient.listLeads;

      if (listLeads === undefined) {
        throw new VkAdsApiError(
          "Lead capability is unavailable.",
          "lead_client_unavailable",
        );
      }

      if (
        createdAtFrom !== undefined &&
        createdAtTo !== undefined &&
        Date.parse(createdAtTo) < Date.parse(createdAtFrom)
      ) {
        throw new VkAdsApiError(
          "createdAtTo must not be earlier than createdAtFrom.",
          "invalid_lead_date_range",
        );
      }

      const result = await listLeads.call(vkAdsClient, {
        ...(limit === undefined ? {} : { limit }),
        ...(offset === undefined ? {} : { offset }),
        ...(formIds === undefined ? {} : { formIds }),
        ...(adPlanIds === undefined ? {} : { adPlanIds }),
        ...(adGroupIds === undefined ? {} : { adGroupIds }),
        ...(bannerIds === undefined ? {} : { bannerIds }),
        ...(createdAtFrom === undefined ? {} : { createdAtFrom }),
        ...(createdAtTo === undefined ? {} : { createdAtTo }),
      });

      return {
        content: [
          {
            type: "text",
            text: `Получено лидов: ${result.items.length}.`,
          },
        ],
        structuredContent: {
          count: result.count,
          offset: result.offset,
          limit: result.limit,
          items: result.items,
        },
      };
    },
  );

  server.registerTool(
    LEAD_FORM_LEADS_EXPORT_TOOL,
    {
      title: "Экспортировать лиды формы VK Рекламы",
      description:
        "Сохраняет CSV или XLSX с персональными данными лидов в новый локальный файл; содержимое и путь не возвращаются через MCP.",
      inputSchema: {
        formId: z.number().int().positive(),
        format: z.enum(["csv", "xlsx"]),
        outputPath: z
          .string()
          .min(1)
          .refine((value) => isAbsolute(value), {
            message: "Путь экспорта должен быть абсолютным.",
          }),
        adPlanIds: statisticsIdListSchema.optional(),
        adGroupIds: statisticsIdListSchema.optional(),
        bannerIds: statisticsIdListSchema.optional(),
        createdAtFrom: leadDateTimeInputSchema.optional(),
        createdAtTo: leadDateTimeInputSchema.optional(),
      },
      outputSchema: {
        saved: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        format: z.enum(["csv", "xlsx"]),
        bytes: z.number().int().positive(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      formId,
      format,
      outputPath,
      adPlanIds,
      adGroupIds,
      bannerIds,
      createdAtFrom,
      createdAtTo,
    }) => {
      const exportLeadFormLeads = vkAdsClient.exportLeadFormLeads;
      const getLeadForm = vkAdsClient.getLeadForm;

      if (
        exportLeadFormLeads === undefined ||
        getLeadForm === undefined
      ) {
        throw new VkAdsApiError(
          "Lead export capability is unavailable.",
          "lead_client_unavailable",
        );
      }

      if (extname(outputPath).toLowerCase() !== `.${format}`) {
        throw new VkAdsApiError(
          "The output extension must match the export format.",
          "invalid_lead_export_path",
        );
      }

      if (
        createdAtFrom !== undefined &&
        createdAtTo !== undefined &&
        Date.parse(createdAtTo) < Date.parse(createdAtFrom)
      ) {
        throw new VkAdsApiError(
          "createdAtTo must not be earlier than createdAtFrom.",
          "invalid_lead_date_range",
        );
      }

      await auditLog.ensureReady();
      await getLeadForm.call(vkAdsClient, formId);
      let exported: VkAdsLeadFormLeadsExport;

      try {
        exported = await exportLeadFormLeads.call(vkAdsClient, formId, {
          format,
          ...(adPlanIds === undefined ? {} : { adPlanIds }),
          ...(adGroupIds === undefined ? {} : { adGroupIds }),
          ...(bannerIds === undefined ? {} : { bannerIds }),
          ...(createdAtFrom === undefined ? {} : { createdAtFrom }),
          ...(createdAtTo === undefined ? {} : { createdAtTo }),
        });

        if (
          format === "xlsx" &&
          (exported.bytes[0] !== 0x50 || exported.bytes[1] !== 0x4b)
        ) {
          throw new VkAdsApiError(
            "VK Ads returned an invalid XLSX export.",
            "invalid_api_response",
          );
        }

        await writeFile(outputPath, exported.bytes, {
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        await auditLog.record({
          operation: "lead_forms.leads.export",
          outcome: "failed",
        });
        throw error;
      }

      const savedFile = await lstat(outputPath);

      if (
        !savedFile.isFile() ||
        savedFile.isSymbolicLink() ||
        savedFile.size !== exported.bytes.byteLength
      ) {
        await auditLog.record({
          operation: "lead_forms.leads.export",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Saved lead export could not be verified.",
          "lead_export_verification_failed",
        );
      }

      await auditLog.record({
        operation: "lead_forms.leads.export",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Экспорт лидов сохранён и проверен.",
          },
        ],
        structuredContent: {
          saved: true as const,
          verified: true as const,
          auditRecorded: true,
          format,
          bytes: exported.bytes.byteLength,
        },
      };
    },
  );

  server.registerTool(
    LEAD_FORM_TEST_LEAD_SEND_TOOL,
    {
      title: "Отправить тестовый лид VK Рекламы",
      description:
        "Отправляет тестовый лид для существующей формы и требует подтверждения обработки от VK Рекламы.",
      inputSchema: {
        formId: z.number().int().positive(),
      },
      outputSchema: {
        sent: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        secondsBeforeNextSending: z.number().int().nonnegative(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ formId }) => {
      const sendTestLead = vkAdsClient.sendTestLead;
      const getLeadForm = vkAdsClient.getLeadForm;

      if (sendTestLead === undefined || getLeadForm === undefined) {
        throw new VkAdsApiError(
          "Test-lead capability is unavailable.",
          "lead_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await getLeadForm.call(vkAdsClient, formId);
      let result: VkAdsTestLeadResult;

      try {
        result = await sendTestLead.call(vkAdsClient, formId);
      } catch (error) {
        await auditLog.record({
          operation: "lead_forms.test_lead.send",
          outcome: "failed",
        });
        throw error;
      }

      if (!result.processed) {
        await auditLog.record({
          operation: "lead_forms.test_lead.send",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "VK Ads did not process the test lead.",
          "test_lead_not_processed",
        );
      }

      await auditLog.record({
        operation: "lead_forms.test_lead.send",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Тестовый лид отправлен и подтверждён VK Рекламой.",
          },
        ],
        structuredContent: {
          sent: true as const,
          verified: true as const,
          auditRecorded: true,
          secondsBeforeNextSending: result.secondsBeforeNextSending,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_PRICELISTS_LIST_TOOL,
    {
      title: "Получить прайс-листы VK Рекламы",
      description:
        "Возвращает безопасную страницу прайс-листов для динамической рекламы без URL источников и учётных данных.",
      inputSchema: {
        limit: z
          .number()
          .int()
          .positive()
          .max(50)
          .optional(),
        offset: z.number().int().nonnegative().optional(),
      },
      outputSchema: {
        count: z.number().int().nonnegative(),
        offset: z.number().int().nonnegative(),
        items: z.array(
          z.object({
            id: z.number().int().positive(),
            name: z.string(),
            status: z.string().min(1).optional(),
            sourceType: z.string().min(1).optional(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const request: {
        limit?: number;
        offset?: number;
      } = {};

      if (input.limit !== undefined) {
        request.limit = input.limit;
      }

      if (input.offset !== undefined) {
        request.offset = input.offset;
      }

      const result =
        await vkAdsClient.listRemarketingPricelists(request);
      const structuredContent = {
        count: result.count,
        offset: result.offset,
        items: result.items,
      };

      return {
        content: [
          {
            type: "text",
            text: `Получено прайс-листов: ${result.items.length} из ${result.count}.`,
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    REMARKETING_PRICELIST_CREATE_TOOL,
    {
      title: "Создать прайс-лист VK Рекламы",
      description:
        "Создаёт прайс-лист для динамической рекламы из API, URL, Ozon или Wildberries, затем перечитывает список и проверяет объект. Credentials не возвращаются и не записываются в audit.",
      inputSchema: {
        name: z.string().min(1),
        status: z
          .enum(["active", "blocked"])
          .default("active"),
        sourceType: z.enum([
          "api",
          "url",
          "ozon_api",
          "wildberries",
        ]),
        exportUrl: z.url().optional(),
        removeUtmTags: z.boolean().optional(),
        refreshPeriod: z.number().int().min(1).optional(),
        credentials: z
          .object({
            clientId: z.string().min(1).optional(),
            apiKey: z.string().min(1).optional(),
          })
          .optional(),
      },
      outputSchema: {
        created: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        pricelist: z.object({
          id: z.number().int().positive(),
          name: z.string(),
          status: z.string().min(1).optional(),
          sourceType: z.string().min(1).optional(),
        }),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({
      name,
      status,
      sourceType,
      exportUrl,
      removeUtmTags,
      refreshPeriod,
      credentials,
    }) => {
      const requiresExportUrl = sourceType !== "api";
      const requiresOzonCredentials =
        sourceType === "ozon_api";
      const requiresWildberriesCredentials =
        sourceType === "wildberries";
      const validCredentials =
        (!requiresOzonCredentials ||
          (credentials?.clientId !== undefined &&
            credentials.apiKey !== undefined)) &&
        (!requiresWildberriesCredentials ||
          credentials?.apiKey !== undefined);

      if (
        (requiresExportUrl && exportUrl === undefined) ||
        (!requiresExportUrl && exportUrl !== undefined) ||
        !validCredentials
      ) {
        throw new VkAdsApiError(
          "Pricelist source fields do not match sourceType.",
          "invalid_pricelist_source",
        );
      }

      const input: CreateVkAdsRemarketingPricelistInput = {
        name,
        status,
        source_type: sourceType,
        ...(exportUrl !== undefined
          ? { export_url: exportUrl }
          : {}),
        ...(removeUtmTags !== undefined
          ? { remove_utm_tags: removeUtmTags }
          : {}),
        ...(refreshPeriod !== undefined
          ? { refresh_period: refreshPeriod }
          : {}),
        ...(credentials !== undefined
          ? {
              credentials: {
                ...(credentials.clientId !== undefined
                  ? { client_id: credentials.clientId }
                  : {}),
                ...(credentials.apiKey !== undefined
                  ? { api_key: credentials.apiKey }
                  : {}),
              },
            }
          : {}),
      };

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      let created: { id: number };

      try {
        created =
          await vkAdsClient.createRemarketingPricelist(input);
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.pricelists.create",
          outcome: "failed",
        });
        throw error;
      }

      const reread = (
        await vkAdsClient.listRemarketingPricelists({
          limit: 50,
          offset: 0,
        })
      ).items.find(
        (pricelist) => pricelist.id === created.id,
      );
      const verified =
        reread !== undefined &&
        reread.name === name &&
        (reread.status === undefined ||
          reread.status === status) &&
        (reread.sourceType === undefined ||
          reread.sourceType === sourceType);

      if (!verified) {
        await auditLog.record({
          operation: "remarketing.pricelists.create",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Created pricelist could not be verified by provider reread.",
          "pricelist_verification_failed",
        );
      }

      await auditLog.record({
        operation: "remarketing.pricelists.create",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Прайс-лист создан и проверен повторным чтением.",
          },
        ],
        structuredContent: {
          created: true as const,
          verified: true as const,
          auditRecorded: true,
          pricelist: reread,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_PRICELIST_BATCH_CREATE_TOOL,
    {
      title: "Обновить товары прайс-листа VK Рекламы",
      description:
        "Ставит NDJSON-задачу на полную замену, создание или удаление товаров в API-прайс-листе, затем перечитывает каждую созданную задачу. Возвращает только безопасные статусы и счётчики ошибок.",
      inputSchema: {
        pricelistId: z.number().int().positive(),
        operations: z
          .array(
            z.discriminatedUnion("method", [
              z.object({
                method: z.literal("PUT"),
                data: z
                  .record(z.string(), z.unknown())
                  .refine(
                    (data) =>
                      typeof data.id === "string" &&
                      data.id.length > 0,
                    "PUT data must contain a non-empty string id.",
                  ),
              }),
              z.object({
                method: z.literal("DELETE"),
                data: z
                  .object({
                    id: z.string().min(1),
                  })
                  .strict(),
              }),
            ]),
          )
          .min(1),
      },
      outputSchema: {
        accepted: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        operationCount: z.number().int().positive(),
        tasks: z
          .array(
            z.object({
              id: z.number().int().positive(),
              status: z.string().min(1),
              errorCount: z.number().int().nonnegative(),
              feedFailureCount: z.number().int().nonnegative(),
              offerErrorCount: z.number().int().nonnegative(),
              offerWarningCount: z.number().int().nonnegative(),
            }),
          )
          .min(1),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ pricelistId, operations }) => {
      const ndjson = operations
        .map((operation) => JSON.stringify(operation))
        .join("\n");

      if (Buffer.byteLength(ndjson, "utf8") > 200 * 1024 * 1024) {
        throw new VkAdsApiError(
          "Offer batch exceeds the provider's 200 MB limit.",
          "offer_batch_too_large",
        );
      }

      const request: VkAdsOfferBatchOperation[] = operations.map(
        (operation) => {
          if (operation.method === "DELETE") {
            return {
              method: "DELETE",
              data: {
                id: operation.data.id,
              },
            };
          }

          return {
            method: "PUT",
            data: {
              ...operation.data,
              id: operation.data.id as string,
            },
          };
        },
      );

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      let offset = 0;
      let pricelist:
        | VkAdsRemarketingPricelistsResult["items"][number]
        | undefined;

      do {
        const page =
          await vkAdsClient.listRemarketingPricelists({
            limit: 50,
            offset,
          });
        pricelist = page.items.find(
          (item) => item.id === pricelistId,
        );

        if (
          pricelist !== undefined ||
          page.items.length === 0 ||
          offset + page.items.length >= page.count
        ) {
          break;
        }

        offset += page.items.length;
      } while (pricelist === undefined);

      if (pricelist === undefined) {
        throw new VkAdsApiError(
          "Pricelist does not exist or is not accessible.",
          "pricelist_not_found",
        );
      }

      if (
        pricelist.sourceType !== undefined &&
        pricelist.sourceType !== "api"
      ) {
        throw new VkAdsApiError(
          "Offer batches require a pricelist with sourceType api.",
          "pricelist_source_not_api",
        );
      }

      const createBatch =
        vkAdsClient.createRemarketingPricelistBatch;
      const getBatchTask =
        vkAdsClient.getRemarketingPricelistBatchTask;

      if (
        createBatch === undefined ||
        getBatchTask === undefined
      ) {
        throw new VkAdsApiError(
          "Offer batch client capability is unavailable.",
          "offer_batch_client_unavailable",
        );
      }

      let createdTasks: Array<{
        id: number;
        status: string;
      }>;

      try {
        createdTasks = await createBatch.call(
          vkAdsClient,
          pricelistId,
          request,
        );
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.pricelists.batch.create",
          outcome: "failed",
        });
        throw error;
      }

      let tasks: VkAdsOfferBatchTask[];

      try {
        tasks = await Promise.all(
          createdTasks.map(
            async (task) =>
              await getBatchTask.call(
                vkAdsClient,
                pricelistId,
                task.id,
              ),
          ),
        );
      } catch (error) {
        await auditLog.record({
          operation: "remarketing.pricelists.batch.create",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Created offer batch tasks could not be verified by provider reread.",
          "offer_batch_verification_failed",
        );
      }

      const verified =
        tasks.length === createdTasks.length &&
        tasks.every(
          (task, index) =>
            task.id === createdTasks[index]?.id,
        );

      if (!verified) {
        await auditLog.record({
          operation: "remarketing.pricelists.batch.create",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Created offer batch tasks could not be verified by provider reread.",
          "offer_batch_verification_failed",
        );
      }

      await auditLog.record({
        operation: "remarketing.pricelists.batch.create",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: `Пакет из ${operations.length} операций принят; задач проверено: ${tasks.length}.`,
          },
        ],
        structuredContent: {
          accepted: true as const,
          verified: true as const,
          auditRecorded: true,
          operationCount: operations.length,
          tasks,
        },
      };
    },
  );

  server.registerTool(
    REMARKETING_PRICELIST_BATCH_GET_TOOL,
    {
      title: "Получить задачу товаров прайс-листа VK Рекламы",
      description:
        "Возвращает безопасный статус пакетной задачи API-прайс-листа и агрегированные счётчики ошибок без товарных данных и частных примеров ошибок.",
      inputSchema: {
        pricelistId: z.number().int().positive(),
        taskId: z.number().int().positive(),
      },
      outputSchema: {
        task: z.object({
          id: z.number().int().positive(),
          status: z.string().min(1),
          errorCount: z.number().int().nonnegative(),
          feedFailureCount: z.number().int().nonnegative(),
          offerErrorCount: z.number().int().nonnegative(),
          offerWarningCount: z.number().int().nonnegative(),
        }),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ pricelistId, taskId }) => {
      const getBatchTask =
        vkAdsClient.getRemarketingPricelistBatchTask;

      if (getBatchTask === undefined) {
        throw new VkAdsApiError(
          "Offer batch client capability is unavailable.",
          "offer_batch_client_unavailable",
        );
      }

      const task = await getBatchTask.call(
        vkAdsClient,
        pricelistId,
        taskId,
      );

      return {
        content: [
          {
            type: "text",
            text: `Статус пакетной задачи: ${task.status}; ошибок: ${task.errorCount}.`,
          },
        ],
        structuredContent: {
          task,
        },
      };
    },
  );

  server.registerTool(
    LOCAL_GEOS_LIST_TOOL,
    {
      title: "Получить локальные геосегменты VK Рекламы",
      description:
        "Возвращает списки локальной географии с названиями, координатами, радиусами и подписями регионов.",
      inputSchema: {},
      outputSchema: {
        items: z.array(
          z.object({
            id: z.number().int().positive(),
            name: z.string(),
            regions: z.array(
              z.object({
                lat: z.number().finite(),
                lng: z.number().finite(),
                radius: z.number().int().positive(),
                label: z.string(),
                address: z.string(),
              }),
            ),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const result = await vkAdsClient.listLocalGeos();
      const structuredContent = {
        items: result.items,
      };

      return {
        content: [
          {
            type: "text",
            text: `Получено списков локальной географии: ${result.items.length}.`,
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    LOCAL_GEO_CREATE_TOOL,
    {
      title: "Создать локальный геосегмент VK Рекламы",
      description:
        "Создаёт обычный список локальной географии, затем перечитывает коллекцию и проверяет созданный объект.",
      inputSchema: {
        name: z.string().min(1),
        regions: z
          .array(
            z.object({
              lat: z.number().finite().min(-90).max(90),
              lng: z.number().finite().min(-180).max(180),
              radius: z.number().int().positive(),
              label: z.string(),
              address: z.string(),
            }),
          )
          .min(1),
      },
      outputSchema: {
        created: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        localGeo: z.object({
          id: z.number().int().positive(),
          name: z.string(),
          regions: z.array(
            z.object({
              lat: z.number().finite(),
              lng: z.number().finite(),
              radius: z.number().int().positive(),
              label: z.string(),
              address: z.string(),
            }),
          ),
        }),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ name, regions }) => {
      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const input: CreateVkAdsLocalGeoInput = {
        name,
        regions,
      };
      let created: VkAdsLocalGeo;

      try {
        created = await vkAdsClient.createLocalGeo(input);
      } catch (error) {
        await auditLog.record({
          operation: "local_geo.create",
          outcome: "failed",
        });
        throw error;
      }

      const reread = (await vkAdsClient.listLocalGeos()).items.find(
        (localGeo) => localGeo.id === created.id,
      );
      const verified =
        reread !== undefined &&
        reread.name === name &&
        reread.regions.length === regions.length &&
        reread.regions.every((region, index) => {
          const expected = regions[index];

          return (
            expected !== undefined &&
            region.lat === expected.lat &&
            region.lng === expected.lng &&
            region.radius === expected.radius &&
            region.label === expected.label &&
            region.address === expected.address
          );
        });

      if (!verified) {
        await auditLog.record({
          operation: "local_geo.create",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Created local geo could not be verified by provider reread.",
          "local_geo_verification_failed",
        );
      }

      await auditLog.record({
        operation: "local_geo.create",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Список локальной географии создан и проверен повторным чтением.",
          },
        ],
        structuredContent: {
          created: true as const,
          verified: true as const,
          auditRecorded: true,
          localGeo: reread,
        },
      };
    },
  );

  server.registerTool(
    LOCAL_GEO_UPDATE_TOOL,
    {
      title: "Изменить локальный геосегмент VK Рекламы",
      description:
        "Изменяет название и регионы существующего списка локальной географии, затем перечитывает коллекцию и проверяет результат.",
      inputSchema: {
        id: z.number().int().positive(),
        name: z.string().min(1),
        regions: z
          .array(
            z.object({
              lat: z.number().finite().min(-90).max(90),
              lng: z.number().finite().min(-180).max(180),
              radius: z.number().int().positive(),
              label: z.string(),
              address: z.string(),
            }),
          )
          .min(1),
      },
      outputSchema: {
        updated: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        localGeo: z.object({
          id: z.number().int().positive(),
          name: z.string(),
          regions: z.array(
            z.object({
              lat: z.number().finite(),
              lng: z.number().finite(),
              radius: z.number().int().positive(),
              label: z.string(),
              address: z.string(),
            }),
          ),
        }),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id, name, regions }) => {
      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const before = (
        await vkAdsClient.listLocalGeos()
      ).items.find((localGeo) => localGeo.id === id);

      if (before === undefined) {
        await auditLog.record({
          operation: "local_geo.update",
          outcome: "failed",
        });
        throw new VkAdsApiError(
          "Local geo was not found during update preflight.",
          "local_geo_not_found",
        );
      }

      const input: UpdateVkAdsLocalGeoInput = {
        name,
        regions,
      };

      try {
        await vkAdsClient.updateLocalGeo(id, input);
      } catch (error) {
        await auditLog.record({
          operation: "local_geo.update",
          outcome: "failed",
        });
        throw error;
      }

      const reread = (
        await vkAdsClient.listLocalGeos()
      ).items.find((localGeo) => localGeo.id === id);
      const verified =
        reread !== undefined &&
        reread.name === name &&
        reread.regions.length === regions.length &&
        reread.regions.every((region, index) => {
          const expected = regions[index];

          return (
            expected !== undefined &&
            region.lat === expected.lat &&
            region.lng === expected.lng &&
            region.radius === expected.radius &&
            region.label === expected.label &&
            region.address === expected.address
          );
        });

      if (!verified) {
        await auditLog.record({
          operation: "local_geo.update",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Updated local geo could not be verified by provider reread.",
          "local_geo_verification_failed",
        );
      }

      await auditLog.record({
        operation: "local_geo.update",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Список локальной географии изменён и проверен повторным чтением.",
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true as const,
          auditRecorded: true,
          localGeo: reread,
        },
      };
    },
  );

  server.registerTool(
    LOCAL_GEO_DELETE_TOOL,
    {
      title: "Удалить локальный геосегмент VK Рекламы",
      description:
        "Удаляет один список локальной географии после проверки цели и подтверждает отсутствие повторным чтением.",
      inputSchema: {
        id: z.number().int().positive(),
      },
      outputSchema: {
        deleted: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        id: z.number().int().positive(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const before = (await vkAdsClient.listLocalGeos()).items.find(
        (localGeo) => localGeo.id === id,
      );

      if (before === undefined) {
        await auditLog.record({
          operation: "local_geo.delete",
          outcome: "failed",
        });
        throw new VkAdsApiError(
          "Local geo was not found during delete preflight.",
          "local_geo_not_found",
        );
      }

      try {
        await vkAdsClient.deleteLocalGeo(id);
      } catch (error) {
        await auditLog.record({
          operation: "local_geo.delete",
          outcome: "failed",
        });
        throw error;
      }

      const stillExists = (
        await vkAdsClient.listLocalGeos()
      ).items.some((localGeo) => localGeo.id === id);

      if (stillExists) {
        await auditLog.record({
          operation: "local_geo.delete",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Deleted local geo is still present after provider reread.",
          "local_geo_verification_failed",
        );
      }

      await auditLog.record({
        operation: "local_geo.delete",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Список локальной географии удалён; отсутствие подтверждено повторным чтением.",
          },
        ],
        structuredContent: {
          deleted: true as const,
          verified: true as const,
          auditRecorded: true,
          id,
        },
      };
    },
  );

  server.registerTool(
    AD_PLANS_LIST_TOOL,
    {
      title: "Получить рекламные кампании VK Рекламы",
      description:
        "Возвращает страницу рекламных кампаний VK Рекламы. Поддерживает limit, offset и фильтр по статусу.",
      inputSchema: {
        limit: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional(),
        status: z.enum(["active", "blocked", "deleted"]).optional(),
      },
      outputSchema: {
        count: z.number().int().nonnegative(),
        offset: z.number().int().nonnegative(),
        items: z.array(
          z.object({
            id: z.number().int().positive(),
            name: z.string(),
            status: z.enum(["active", "blocked", "deleted"]),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const request: ListVkAdsAdPlansInput = {};

      if (input.limit !== undefined) {
        request.limit = input.limit;
      }

      if (input.offset !== undefined) {
        request.offset = input.offset;
      }

      if (input.status !== undefined) {
        request.status = input.status;
      }

      const page = await vkAdsClient.listAdPlans(request);
      const structuredContent = {
        count: page.count,
        offset: page.offset,
        items: page.items,
      };

      return {
        content: [
          {
            type: "text",
            text: `Получено кампаний: ${page.items.length} из ${page.count}.`,
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    AD_PLAN_GET_TOOL,
    {
      title: "Получить рекламную кампанию VK Рекламы",
      description:
        "Возвращает одну рекламную кампанию VK Рекламы по её ID.",
      inputSchema: {
        id: z.number().int().positive(),
      },
      outputSchema: {
        id: z.number().int().positive(),
        name: z.string(),
        status: z.enum(["active", "blocked", "deleted"]),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      const campaign = await vkAdsClient.getAdPlan(id);
      const structuredContent = {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
      };

      return {
        content: [
          {
            type: "text",
            text: "Рекламная кампания получена.",
          },
        ],
        structuredContent,
      };
    },
  );

  const adGroupStatusSchema = z.enum([
    "active",
    "blocked",
    "deleted",
  ]);
  const adGroupSortingSchema = z.enum([
    "id",
    "-id",
    "name",
    "-name",
    "status",
    "-status",
  ]);

  server.registerTool(
    AD_GROUPS_LIST_TOOL,
    {
      title: "Получить группы объявлений VK Рекламы",
      description:
        "Возвращает страницу групп объявлений VK Рекламы с пагинацией, документированными фильтрами и сортировкой.",
      inputSchema: {
        limit: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional(),
        id: z.number().int().positive().optional(),
        ids: z
          .array(z.number().int().positive())
          .min(1)
          .optional(),
        status: adGroupStatusSchema.optional(),
        statusNot: adGroupStatusSchema.optional(),
        statuses: z
          .array(adGroupStatusSchema)
          .min(1)
          .max(3)
          .optional(),
        lastUpdatedLt: z.string().min(1).optional(),
        lastUpdatedLte: z.string().min(1).optional(),
        lastUpdatedGt: z.string().min(1).optional(),
        lastUpdatedGte: z.string().min(1).optional(),
        sorting: z
          .array(adGroupSortingSchema)
          .min(1)
          .max(6)
          .optional(),
      },
      outputSchema: {
        count: z.number().int().nonnegative(),
        offset: z.number().int().nonnegative(),
        items: z.array(
          z.object({
            id: z.number().int().positive(),
            name: z.string(),
            status: adGroupStatusSchema,
            adPlanId: z.number().int().nonnegative(),
            packageId: z.number().int(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const request: ListVkAdsAdGroupsInput = {};
      const optionalKeys = [
        "limit",
        "offset",
        "id",
        "ids",
        "status",
        "statusNot",
        "statuses",
        "lastUpdatedLt",
        "lastUpdatedLte",
        "lastUpdatedGt",
        "lastUpdatedGte",
        "sorting",
      ] as const;

      for (const key of optionalKeys) {
        const value = input[key];

        if (value !== undefined) {
          Object.assign(request, { [key]: value });
        }
      }

      const page = await vkAdsClient.listAdGroups(request);

      return {
        content: [
          {
            type: "text",
            text: `Получено групп объявлений: ${page.items.length} из ${page.count}.`,
          },
        ],
        structuredContent: {
          count: page.count,
          offset: page.offset,
          items: page.items,
        },
      };
    },
  );

  server.registerTool(
    AD_GROUP_GET_TOOL,
    {
      title: "Получить группу объявлений VK Рекламы",
      description:
        "Возвращает одну группу объявлений VK Рекламы по её ID.",
      inputSchema: {
        id: z.number().int().positive(),
      },
      outputSchema: {
        id: z.number().int().positive(),
        name: z.string(),
        status: adGroupStatusSchema,
        adPlanId: z.number().int().nonnegative(),
        packageId: z.number().int(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      const group = await vkAdsClient.getAdGroup(id);
      const structuredContent = {
        id: group.id,
        name: group.name,
        status: group.status,
        adPlanId: group.adPlanId,
        packageId: group.packageId,
      };

      return {
        content: [
          {
            type: "text",
            text: "Группа объявлений получена.",
          },
        ],
        structuredContent,
      };
    },
  );

  server.registerTool(
    BANNERS_LIST_TOOL,
    {
      title: "Получить рекламные объявления VK Рекламы",
      description:
        "Возвращает страницу объявлений с пагинацией и официальными фильтрами по объявлению, группе, статусу, обновлению, URL и тексту.",
      inputSchema: {
        limit: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional(),
        id: z.number().int().positive().optional(),
        ids: z
          .array(z.number().int().positive())
          .min(1)
          .optional(),
        adGroupId: z.number().int().positive().optional(),
        adGroupIds: z
          .array(z.number().int().positive())
          .min(1)
          .optional(),
        adGroupStatus: adGroupStatusSchema.optional(),
        adGroupStatusNot: adGroupStatusSchema.optional(),
        adGroupStatuses: z
          .array(adGroupStatusSchema)
          .min(1)
          .max(3)
          .optional(),
        status: adGroupStatusSchema.optional(),
        statusNot: adGroupStatusSchema.optional(),
        statuses: z
          .array(adGroupStatusSchema)
          .min(1)
          .max(3)
          .optional(),
        updatedLt: z.string().min(1).optional(),
        updatedLte: z.string().min(1).optional(),
        updatedGt: z.string().min(1).optional(),
        updatedGte: z.string().min(1).optional(),
        url: z.string().min(1).optional(),
        textblock: z.string().min(1).optional(),
      },
      outputSchema: {
        count: z.number().int().nonnegative(),
        offset: z.number().int().nonnegative(),
        items: z.array(
          z.object({
            id: z.number().int().positive(),
            adGroupId: z.number().int().positive(),
            name: z.string().optional(),
            status: adGroupStatusSchema.optional(),
            moderationStatus: z
              .enum(["pending", "allowed", "banned"])
              .optional(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const request: ListVkAdsBannersInput = {};
      const optionalKeys = [
        "limit",
        "offset",
        "id",
        "ids",
        "adGroupId",
        "adGroupIds",
        "adGroupStatus",
        "adGroupStatusNot",
        "adGroupStatuses",
        "status",
        "statusNot",
        "statuses",
        "updatedLt",
        "updatedLte",
        "updatedGt",
        "updatedGte",
        "url",
        "textblock",
      ] as const;

      for (const key of optionalKeys) {
        const value = input[key];

        if (value !== undefined) {
          Object.assign(request, { [key]: value });
        }
      }

      const page = await vkAdsClient.listBanners(request);

      return {
        content: [
          {
            type: "text",
            text: `Получено объявлений: ${page.items.length} из ${page.count}.`,
          },
        ],
        structuredContent: {
          count: page.count,
          offset: page.offset,
          items: page.items,
        },
      };
    },
  );

  server.registerTool(
    BANNER_GET_TOOL,
    {
      title: "Получить рекламное объявление VK Рекламы",
      description:
        "Возвращает безопасную нормализованную сводку одного рекламного объявления по ID.",
      inputSchema: {
        id: z.number().int().positive(),
      },
      outputSchema: {
        id: z.number().int().positive(),
        adGroupId: z.number().int().positive(),
        name: z.string().optional(),
        status: z
          .enum(["active", "blocked", "deleted"])
          .optional(),
        moderationStatus: z
          .enum(["pending", "allowed", "banned"])
          .optional(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      const banner = await vkAdsClient.getBanner(id);
      const structuredContent = {
        id: banner.id,
        adGroupId: banner.adGroupId,
        ...(banner.name !== undefined
          ? { name: banner.name }
          : {}),
        ...(banner.status !== undefined
          ? { status: banner.status }
          : {}),
        ...(banner.moderationStatus !== undefined
          ? { moderationStatus: banner.moderationStatus }
          : {}),
      };

      return {
        content: [
          {
            type: "text",
            text: "Рекламное объявление получено.",
          },
        ],
        structuredContent,
      };
    },
  );

  const bannerSectionSchema = z.record(
    z.string(),
    z.unknown(),
  );

  server.registerTool(
    BANNER_CREATE_TOOL,
    {
      title: "Создать рекламное объявление VK Рекламы",
      description:
        "Создаёт объявление в существующей группе по разрешённой её пакетом схеме, затем перечитывает и проверяет результат.",
      inputSchema: z
        .object({
          adGroupId: z.number().int().positive(),
          name: z.string().min(1).optional(),
          status: z
            .enum(["active", "blocked", "deleted"])
            .optional(),
          content: bannerSectionSchema.optional(),
          textblocks: bannerSectionSchema.optional(),
          urls: bannerSectionSchema.optional(),
        })
        .refine(
          ({ adGroupId: _adGroupId, ...banner }) =>
            Object.values(banner).some(
              (value) => value !== undefined,
            ),
          {
            message:
              "Укажите хотя бы одно записываемое поле объявления.",
          },
        ),
      outputSchema: {
        created: z.literal(true),
        verified: z.boolean(),
        auditRecorded: z.boolean(),
        id: z.number().int().positive(),
        banner: z
          .object({
            id: z.number().int().positive(),
            adGroupId: z.number().int().positive(),
            name: z.string().optional(),
            status: z
              .enum(["active", "blocked", "deleted"])
              .optional(),
            moderationStatus: z
              .enum(["pending", "allowed", "banned"])
              .optional(),
          })
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ adGroupId, ...bannerInput }) => {
      const request: CreateVkAdsBannerInput = {
        ...(bannerInput.name !== undefined
          ? { name: bannerInput.name }
          : {}),
        ...(bannerInput.status !== undefined
          ? { status: bannerInput.status }
          : {}),
        ...(bannerInput.content !== undefined
          ? { content: bannerInput.content }
          : {}),
        ...(bannerInput.textblocks !== undefined
          ? { textblocks: bannerInput.textblocks }
          : {}),
        ...(bannerInput.urls !== undefined
          ? { urls: bannerInput.urls }
          : {}),
      };

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      await vkAdsClient.getAdGroup(adGroupId);

      let created: CreateVkAdsBannerResult;

      try {
        created = await vkAdsClient.createBanner(
          adGroupId,
          request,
        );
      } catch (error) {
        await auditLog.record({
          operation: "banners.create",
          outcome: "failed",
        });
        throw error;
      }

      let banner: VkAdsBanner;

      try {
        banner = await vkAdsClient.getBanner(created.id);
      } catch {
        await auditLog.record({
          operation: "banners.create",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Объявление создано, но контрольное чтение не удалось.",
            },
          ],
          structuredContent: {
            created: true as const,
            verified: false,
            auditRecorded: true,
            id: created.id,
          },
        };
      }

      const verified =
        banner.adGroupId === adGroupId &&
        (request.name === undefined ||
          banner.name === request.name) &&
        (request.status === undefined ||
          banner.status === request.status) &&
        (request.content === undefined ||
          providerSectionMatches(
            banner.content,
            request.content,
          )) &&
        (request.textblocks === undefined ||
          providerSectionMatches(
            banner.textblocks,
            request.textblocks,
          )) &&
        (request.urls === undefined ||
          providerSectionMatches(
            banner.urls,
            request.urls,
          ));

      if (!verified) {
        await auditLog.record({
          operation: "banners.create",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "VK Реклама создала объявление, но контрольное чтение не подтвердило его поля.",
            },
          ],
          structuredContent: {
            created: true as const,
            verified: false,
            auditRecorded: true,
            id: created.id,
          },
        };
      }

      await auditLog.record({
        operation: "banners.create",
        outcome: "success",
      });

      const safeBanner = {
        id: banner.id,
        adGroupId: banner.adGroupId,
        ...(banner.name !== undefined
          ? { name: banner.name }
          : {}),
        ...(banner.status !== undefined
          ? { status: banner.status }
          : {}),
        ...(banner.moderationStatus !== undefined
          ? { moderationStatus: banner.moderationStatus }
          : {}),
      };

      return {
        content: [
          {
            type: "text",
            text: "Рекламное объявление создано и проверено.",
          },
        ],
        structuredContent: {
          created: true as const,
          verified: true,
          auditRecorded: true,
          id: created.id,
          banner: safeBanner,
        },
      };
    },
  );

  server.registerTool(
    BANNER_UPDATE_TOOL,
    {
      title: "Обновить рекламное объявление VK Рекламы",
      description:
        "Частично обновляет объявление и проверяет результат повторным чтением. Передача content, textblocks или urls полностью заменяет соответствующую секцию.",
      inputSchema: z
        .object({
          id: z.number().int().positive(),
          name: z.string().min(1).optional(),
          status: z
            .enum(["active", "blocked", "deleted"])
            .optional(),
          content: bannerSectionSchema.optional(),
          textblocks: bannerSectionSchema.optional(),
          urls: bannerSectionSchema.optional(),
        })
        .refine(
          ({ id: _id, ...changes }) =>
            Object.values(changes).some(
              (value) => value !== undefined,
            ),
          {
            message:
              "Укажите хотя бы одно изменяемое поле объявления.",
          },
        ),
      outputSchema: {
        updated: z.literal(true),
        verified: z.boolean(),
        auditRecorded: z.boolean(),
        id: z.number().int().positive(),
        banner: z
          .object({
            id: z.number().int().positive(),
            adGroupId: z.number().int().positive(),
            name: z.string().optional(),
            status: z
              .enum(["active", "blocked", "deleted"])
              .optional(),
            moderationStatus: z
              .enum(["pending", "allowed", "banned"])
              .optional(),
          })
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ id, ...changes }) => {
      const request: UpdateVkAdsBannerInput = {
        ...(changes.name !== undefined
          ? { name: changes.name }
          : {}),
        ...(changes.status !== undefined
          ? { status: changes.status }
          : {}),
        ...(changes.content !== undefined
          ? { content: changes.content }
          : {}),
        ...(changes.textblocks !== undefined
          ? { textblocks: changes.textblocks }
          : {}),
        ...(changes.urls !== undefined
          ? { urls: changes.urls }
          : {}),
      };

      await auditLog.ensureReady();
      await vkAdsClient.getBanner(id);

      try {
        await vkAdsClient.updateBanner(id, request);
      } catch (error) {
        await auditLog.record({
          operation: "banners.update",
          outcome: "failed",
        });
        throw error;
      }

      let banner: VkAdsBanner;

      try {
        banner = await vkAdsClient.getBanner(id);
      } catch {
        await auditLog.record({
          operation: "banners.update",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Объявление обновлено, но контрольное чтение не удалось.",
            },
          ],
          structuredContent: {
            updated: true as const,
            verified: false,
            auditRecorded: true,
            id,
          },
        };
      }

      const verified =
        (request.name === undefined ||
          banner.name === request.name) &&
        (request.status === undefined ||
          banner.status === request.status) &&
        (request.content === undefined ||
          providerSectionMatches(
            banner.content,
            request.content,
          )) &&
        (request.textblocks === undefined ||
          providerSectionMatches(
            banner.textblocks,
            request.textblocks,
          )) &&
        (request.urls === undefined ||
          providerSectionMatches(
            banner.urls,
            request.urls,
          ));

      if (!verified) {
        await auditLog.record({
          operation: "banners.update",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "VK Реклама приняла обновление, но контрольное чтение не подтвердило запрошенные значения.",
            },
          ],
          structuredContent: {
            updated: true as const,
            verified: false,
            auditRecorded: true,
            id,
          },
        };
      }

      await auditLog.record({
        operation: "banners.update",
        outcome: "success",
      });

      const safeBanner = {
        id: banner.id,
        adGroupId: banner.adGroupId,
        ...(banner.name !== undefined
          ? { name: banner.name }
          : {}),
        ...(banner.status !== undefined
          ? { status: banner.status }
          : {}),
        ...(banner.moderationStatus !== undefined
          ? { moderationStatus: banner.moderationStatus }
          : {}),
      };

      return {
        content: [
          {
            type: "text",
            text: "Рекламное объявление обновлено и проверено.",
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true,
          auditRecorded: true,
          id,
          banner: safeBanner,
        },
      };
    },
  );

  server.registerTool(
    BANNER_DELETE_TOOL,
    {
      title: "Удалить рекламное объявление VK Рекламы",
      description:
        "Удаляет одно рекламное объявление по ID и подтверждает статус deleted повторным чтением.",
      inputSchema: {
        id: z.number().int().positive(),
      },
      outputSchema: {
        deleted: z.literal(true),
        verified: z.boolean(),
        auditRecorded: z.boolean(),
        id: z.number().int().positive(),
        banner: z
          .object({
            id: z.number().int().positive(),
            adGroupId: z.number().int().positive(),
            name: z.string().optional(),
            status: z.literal("deleted"),
            moderationStatus: z
              .enum(["pending", "allowed", "banned"])
              .optional(),
          })
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      await auditLog.ensureReady();
      await vkAdsClient.getBanner(id);

      try {
        await vkAdsClient.deleteBanner(id);
      } catch (error) {
        await auditLog.record({
          operation: "banners.delete",
          outcome: "failed",
        });
        throw error;
      }

      let banner: VkAdsBanner;

      try {
        banner = await vkAdsClient.getBanner(id);
      } catch {
        await auditLog.record({
          operation: "banners.delete",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Объявление удалено, но контрольное чтение не удалось.",
            },
          ],
          structuredContent: {
            deleted: true as const,
            verified: false,
            auditRecorded: true,
            id,
          },
        };
      }

      if (banner.status !== "deleted") {
        await auditLog.record({
          operation: "banners.delete",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "VK Реклама приняла удаление, но объявление не получило статус deleted.",
            },
          ],
          structuredContent: {
            deleted: true as const,
            verified: false,
            auditRecorded: true,
            id,
          },
        };
      }

      await auditLog.record({
        operation: "banners.delete",
        outcome: "success",
      });

      const safeBanner = {
        id: banner.id,
        adGroupId: banner.adGroupId,
        ...(banner.name !== undefined
          ? { name: banner.name }
          : {}),
        status: "deleted" as const,
        ...(banner.moderationStatus !== undefined
          ? { moderationStatus: banner.moderationStatus }
          : {}),
      };

      return {
        content: [
          {
            type: "text",
            text: "Рекламное объявление удалено и проверено.",
          },
        ],
        structuredContent: {
          deleted: true as const,
          verified: true,
          auditRecorded: true,
          id,
          banner: safeBanner,
        },
      };
    },
  );

  const bannerStatusSchema = z.enum([
    "active",
    "blocked",
    "deleted",
  ]);

  server.registerTool(
    BANNERS_MASS_ACTION_TOOL,
    {
      title: "Массово изменить статусы объявлений VK Рекламы",
      description:
        "Транзакционно изменяет status у одного–200 объявлений, предварительно и повторно читает каждую цель и записывает обезличенный audit.",
      inputSchema: {
        changes: z
          .array(
            z.object({
              id: z.number().int().positive(),
              status: bannerStatusSchema,
            }),
          )
          .min(1)
          .max(200)
          .refine(
            (items) =>
              new Set(items.map((item) => item.id)).size ===
              items.length,
            {
              message:
                "Каждый ID объявления должен встречаться один раз.",
            },
          ),
      },
      outputSchema: {
        updated: z.literal(true),
        verified: z.boolean(),
        auditRecorded: z.boolean(),
        requestedCount: z.number().int().positive().max(200),
        banners: z
          .array(
            z.object({
              id: z.number().int().positive(),
              adGroupId: z.number().int().positive(),
              name: z.string().optional(),
              status: bannerStatusSchema,
              moderationStatus: z
                .enum(["pending", "allowed", "banned"])
                .optional(),
            }),
          )
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ changes }) => {
      const ids = changes.map((change) => change.id);
      const request: MassUpdateVkAdsBannerInput[] =
        changes.map((change) => ({
          id: change.id,
          status: change.status,
        }));

      await auditLog.ensureReady();
      await readBannersInBatches(vkAdsClient, ids);

      try {
        await vkAdsClient.massUpdateBanners(request);
      } catch (error) {
        await auditLog.record({
          operation: "banners.mass_action",
          outcome: "failed",
        });
        throw error;
      }

      let banners: VkAdsBanner[];

      try {
        banners = await readBannersInBatches(vkAdsClient, ids);
      } catch {
        await auditLog.record({
          operation: "banners.mass_action",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Массовое изменение принято, но контрольное чтение всех объявлений не удалось.",
            },
          ],
          structuredContent: {
            updated: true as const,
            verified: false,
            auditRecorded: true,
            requestedCount: changes.length,
          },
        };
      }

      const expectedStatuses = new Map(
        changes.map((change) => [change.id, change.status]),
      );
      const valuesMatch = banners.every(
        (banner) =>
          banner.status === expectedStatuses.get(banner.id),
      );

      if (!valuesMatch) {
        await auditLog.record({
          operation: "banners.mass_action",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "VK Реклама приняла массовое изменение, но контрольные статусы не совпали.",
            },
          ],
          structuredContent: {
            updated: true as const,
            verified: false,
            auditRecorded: true,
            requestedCount: changes.length,
          },
        };
      }

      await auditLog.record({
        operation: "banners.mass_action",
        outcome: "success",
      });

      const safeBanners = banners.map((banner) => ({
        id: banner.id,
        adGroupId: banner.adGroupId,
        ...(banner.name !== undefined
          ? { name: banner.name }
          : {}),
        status: banner.status!,
        ...(banner.moderationStatus !== undefined
          ? { moderationStatus: banner.moderationStatus }
          : {}),
      }));

      return {
        content: [
          {
            type: "text",
            text: `Статусы объявлений массово изменены и проверены: ${safeBanners.length}.`,
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true,
          auditRecorded: true,
          requestedCount: changes.length,
          banners: safeBanners,
        },
      };
    },
  );

  server.registerTool(
    BANNERS_REMODERATE_TOOL,
    {
      title: "Отправить объявления VK Рекламы на перемодерацию",
      description:
        "Отправляет один или несколько баннеров на перемодерацию, возвращает индивидуальный результат VK Рекламы и повторно читает каждую цель.",
      inputSchema: {
        ids: z
          .array(z.number().int().positive())
          .min(1)
          .refine(
            (items) => new Set(items).size === items.length,
            {
              message:
                "Каждый ID объявления должен встречаться один раз.",
            },
          ),
      },
      outputSchema: {
        requested: z.literal(true),
        verified: z.boolean(),
        auditRecorded: z.boolean(),
        requestedCount: z.number().int().positive(),
        allRemoderated: z.boolean(),
        results: z
          .array(
            z.object({
              id: z.number().int().positive(),
              remoderated: z.boolean(),
            }),
          )
          .optional(),
        banners: z
          .array(
            z.object({
              id: z.number().int().positive(),
              adGroupId: z.number().int().positive(),
              name: z.string().optional(),
              status: bannerStatusSchema.optional(),
              moderationStatus: z
                .enum(["pending", "allowed", "banned"])
                .optional(),
            }),
          )
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ ids }) => {
      await auditLog.ensureReady();
      await readBannersInBatches(vkAdsClient, ids);

      let results: VkAdsBannerRemoderationResult[];

      try {
        results = await vkAdsClient.remoderateBanners(ids);
      } catch (error) {
        await auditLog.record({
          operation: "banners.remoderate",
          outcome: "failed",
        });
        throw error;
      }

      const returnedIds = new Set(
        results.map((result) => result.id),
      );
      const completeResponse =
        results.length === ids.length &&
        ids.every((id) => returnedIds.has(id));

      if (!completeResponse) {
        await auditLog.record({
          operation: "banners.remoderate",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "VK Реклама вернула неполный результат перемодерации.",
            },
          ],
          structuredContent: {
            requested: true as const,
            verified: false,
            auditRecorded: true,
            requestedCount: ids.length,
            allRemoderated: false,
            results,
          },
        };
      }

      let banners: VkAdsBanner[];

      try {
        banners = await readBannersInBatches(vkAdsClient, ids);
      } catch {
        await auditLog.record({
          operation: "banners.remoderate",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Запрос перемодерации выполнен, но контрольное чтение всех объявлений не удалось.",
            },
          ],
          structuredContent: {
            requested: true as const,
            verified: false,
            auditRecorded: true,
            requestedCount: ids.length,
            allRemoderated: results.every(
              (result) => result.remoderated,
            ),
            results,
          },
        };
      }

      await auditLog.record({
        operation: "banners.remoderate",
        outcome: "success",
      });

      const safeBanners = banners.map((banner) => ({
        id: banner.id,
        adGroupId: banner.adGroupId,
        ...(banner.name !== undefined
          ? { name: banner.name }
          : {}),
        ...(banner.status !== undefined
          ? { status: banner.status }
          : {}),
        ...(banner.moderationStatus !== undefined
          ? { moderationStatus: banner.moderationStatus }
          : {}),
      }));
      const allRemoderated = results.every(
        (result) => result.remoderated,
      );

      return {
        content: [
          {
            type: "text",
            text: `Результаты перемодерации получены: ${results.filter((result) => result.remoderated).length} из ${results.length}.`,
          },
        ],
        structuredContent: {
          requested: true as const,
          verified: true,
          auditRecorded: true,
          requestedCount: ids.length,
          allRemoderated,
          results,
          banners: safeBanners,
        },
      };
    },
  );

  const decimalInputSchema = z.union([
    z.number().finite(),
    z.string().regex(/^-?(?:\d+|\d+\.\d+|\.\d+)$/u),
  ]);
  const optionalAdPlanFieldsSchema = {
    name: z.string().min(1).optional(),
    campaigns: z
      .array(z.record(z.string(), z.unknown()))
      .min(1)
      .optional(),
    status: z.enum(["active", "blocked", "deleted"]).optional(),
    autobidding_mode: z.literal("max_goals").optional(),
    budget_limit: decimalInputSchema.optional(),
    budget_limit_day: decimalInputSchema.optional(),
    date_start: z.string().min(1).optional(),
    date_end: z.string().min(1).optional(),
    max_price: decimalInputSchema.optional(),
    objective: z.string().min(1).optional(),
    priced_goal: z.record(z.string(), z.unknown()).optional(),
    pricelist_id: z.number().int().optional(),
    enable_offline_goals: z.boolean().optional(),
    enable_utm: z.boolean().optional(),
  } as const;

  server.registerTool(
    CONTENT_HTML5_UPLOAD_TOOL,
    {
      title: "Загрузить HTML5-креатив VK Рекламы",
      description:
        "Загружает локальный ZIP-архив HTML5-креатива в VK Рекламу через multipart/form-data и возвращает безопасные метаданные результата.",
      inputSchema: {
        filePath: z
          .string()
          .min(1)
          .refine((value) => isAbsolute(value), {
            message: "Путь к HTML5-архиву должен быть абсолютным.",
          }),
      },
      outputSchema: {
        uploaded: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        id: z.number().int().positive(),
        variants: z.record(
          z.string(),
          z.object({
            width: z.number().int().positive(),
            height: z.number().int().positive(),
            size: z.number().int().nonnegative(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ filePath }) => {
      if (extname(filePath).toLowerCase() !== ".zip") {
        throw new VkAdsApiError(
          "The HTML5 creative must be a ZIP archive.",
          "invalid_html5_archive",
        );
      }

      const fileInfo = await lstat(filePath);

      if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
        throw new VkAdsApiError(
          "The HTML5 creative must be a regular non-symlink file.",
          "invalid_html5_archive",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const file = await openAsBlob(filePath, {
        type: "application/zip",
      });
      let uploaded: VkAdsContentUploadResult;

      try {
        uploaded = await vkAdsClient.uploadHtml5Content(
          file,
          basename(filePath),
        );
      } catch (error) {
        await auditLog.record({
          operation: "content.html5.upload",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "content.html5.upload",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "HTML5-креатив загружен и ответ VK Рекламы проверен.",
          },
        ],
        structuredContent: {
          uploaded: true as const,
          verified: true as const,
          auditRecorded: true,
          id: uploaded.id,
          variants: uploaded.variants,
        },
      };
    },
  );

  server.registerTool(
    CONTENT_STATIC_UPLOAD_TOOL,
    {
      title: "Загрузить статический креатив VK Рекламы",
      description:
        "Загружает локальный JPG или PNG в VK Рекламу через multipart/form-data с обязательными исходными width и height.",
      inputSchema: {
        filePath: z
          .string()
          .min(1)
          .refine((value) => isAbsolute(value), {
            message: "Путь к изображению должен быть абсолютным.",
          }),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      },
      outputSchema: {
        uploaded: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        id: z.number().int().positive(),
        variants: z.record(
          z.string(),
          z.object({
            width: z.number().int().positive(),
            height: z.number().int().positive(),
            size: z.number().int().nonnegative(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ filePath, width, height }) => {
      const extension = extname(filePath).toLowerCase();
      const contentType =
        extension === ".png"
          ? "image/png"
          : extension === ".jpg" || extension === ".jpeg"
            ? "image/jpeg"
            : undefined;

      if (contentType === undefined) {
        throw new VkAdsApiError(
          "The static creative must be a JPG or PNG image.",
          "invalid_static_content",
        );
      }

      const fileInfo = await lstat(filePath);

      if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
        throw new VkAdsApiError(
          "The static creative must be a regular non-symlink file.",
          "invalid_static_content",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const file = await openAsBlob(filePath, {
        type: contentType,
      });
      let uploaded: VkAdsContentUploadResult;

      try {
        uploaded = await vkAdsClient.uploadStaticContent(
          file,
          basename(filePath),
          width,
          height,
        );
      } catch (error) {
        await auditLog.record({
          operation: "content.static.upload",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "content.static.upload",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Статический креатив загружен и ответ VK Рекламы проверен.",
          },
        ],
        structuredContent: {
          uploaded: true as const,
          verified: true as const,
          auditRecorded: true,
          id: uploaded.id,
          variants: uploaded.variants,
        },
      };
    },
  );

  server.registerTool(
    CONTENT_VIDEO_UPLOAD_TOOL,
    {
      title: "Загрузить видеокреатив VK Рекламы",
      description:
        "Загружает локальный MP4 или MOV в VK Рекламу через multipart/form-data с обязательными исходными width и height.",
      inputSchema: {
        filePath: z
          .string()
          .min(1)
          .refine((value) => isAbsolute(value), {
            message: "Путь к видео должен быть абсолютным.",
          }),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
      },
      outputSchema: {
        uploaded: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        id: z.number().int().positive(),
        variants: z.record(
          z.string(),
          z.object({
            width: z.number().int().positive(),
            height: z.number().int().positive(),
            size: z.number().int().nonnegative(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ filePath, width, height }) => {
      const extension = extname(filePath).toLowerCase();
      const contentType =
        extension === ".mp4"
          ? "video/mp4"
          : extension === ".mov"
            ? "video/quicktime"
            : undefined;

      if (contentType === undefined) {
        throw new VkAdsApiError(
          "The video creative must be an MP4 or MOV file.",
          "invalid_video_content",
        );
      }

      const fileInfo = await lstat(filePath);

      if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
        throw new VkAdsApiError(
          "The video creative must be a regular non-symlink file.",
          "invalid_video_content",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const file = await openAsBlob(filePath, {
        type: contentType,
      });
      let uploaded: VkAdsContentUploadResult;

      try {
        uploaded = await vkAdsClient.uploadVideoContent(
          file,
          basename(filePath),
          width,
          height,
        );
      } catch (error) {
        await auditLog.record({
          operation: "content.video.upload",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "content.video.upload",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Видеокреатив загружен и ответ VK Рекламы проверен.",
          },
        ],
        structuredContent: {
          uploaded: true as const,
          verified: true as const,
          auditRecorded: true,
          id: uploaded.id,
          variants: uploaded.variants,
        },
      };
    },
  );

  server.registerTool(
    AD_GROUP_CREATE_TOOL,
    {
      title: "Создать группу объявлений VK Рекламы",
      description:
        "Создаёт обычную группу объявлений VK Рекламы, поддерживает документированные и package-зависимые поля, затем перечитывает результат и записывает обезличенный audit.",
      inputSchema: {
        name: z.string().min(1),
        packageId: z
          .number()
          .int()
          .min(-2_147_483_647)
          .max(2_147_483_647),
        adPlanId: z.number().int().positive().optional(),
        status: adGroupStatusSchema.optional(),
        ageRestrictions: z
          .string()
          .regex(/^[1-9]?[0-9]\+$/u)
          .optional(),
        auditPixels: z
          .array(z.record(z.string(), z.unknown()))
          .optional(),
        autobiddingMode: z.literal("max_goals").optional(),
        bannerUniqShowsLimit: z
          .number()
          .int()
          .nonnegative()
          .max(2_147_483_647)
          .optional(),
        banners: z
          .array(z.record(z.string(), z.unknown()))
          .optional(),
        budgetLimit: decimalInputSchema.optional(),
        budgetLimitDay: decimalInputSchema.optional(),
        dateEnd: z.string().min(1).optional(),
        dateStart: z.string().min(1).optional(),
        dynamicBannersUseStorelink: z.boolean().optional(),
        dynamicWithoutRemarketing: z.boolean().optional(),
        enableOfflineGoals: z.boolean().optional(),
        enableUtm: z.boolean().optional(),
        language: z.enum(["ru", "en"]).optional(),
        marketplaceAppClientId: z.string().min(1).optional(),
        maxPrice: decimalInputSchema.optional(),
        objective: z.string().min(1).optional(),
        price: decimalInputSchema.optional(),
        pricedGoal: z
          .record(z.string(), z.unknown())
          .optional(),
        pricelistId: z
          .number()
          .int()
          .min(-2_147_483_647)
          .max(2_147_483_647)
          .optional(),
        targetings: z
          .record(z.string(), z.unknown())
          .optional(),
        uniqShowsLimit: z
          .number()
          .int()
          .nonnegative()
          .max(2_147_483_647)
          .optional(),
        uniqShowsPeriod: z
          .enum(["day", "week", "month", "eternity"])
          .optional(),
        utm: z.string().optional(),
        notAd: z.boolean().optional(),
        packageFields: z
          .record(z.string(), z.unknown())
          .optional(),
      },
      outputSchema: {
        created: z.literal(true),
        verified: z.boolean(),
        auditRecorded: z.boolean(),
        id: z.number().int().positive(),
        bannerIds: z.array(z.number().int().positive()),
        group: z
          .object({
            id: z.number().int().positive(),
            name: z.string(),
            status: adGroupStatusSchema,
            adPlanId: z.number().int().nonnegative(),
            packageId: z.number().int(),
            maxPrice: decimalInputSchema.optional(),
          })
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const request: CreateVkAdsAdGroupInput = {
        ...(input.packageFields ?? {}),
        name: input.name,
        package_id: input.packageId,
      };
      const fieldMap = {
        adPlanId: "ad_plan_id",
        status: "status",
        ageRestrictions: "age_restrictions",
        auditPixels: "audit_pixels",
        autobiddingMode: "autobidding_mode",
        bannerUniqShowsLimit: "banner_uniq_shows_limit",
        banners: "banners",
        budgetLimit: "budget_limit",
        budgetLimitDay: "budget_limit_day",
        dateEnd: "date_end",
        dateStart: "date_start",
        dynamicBannersUseStorelink:
          "dynamic_banners_use_storelink",
        dynamicWithoutRemarketing:
          "dynamic_without_remarketing",
        enableOfflineGoals: "enable_offline_goals",
        enableUtm: "enable_utm",
        language: "language",
        marketplaceAppClientId: "marketplace_app_client_id",
        maxPrice: "max_price",
        objective: "objective",
        price: "price",
        pricedGoal: "priced_goal",
        pricelistId: "pricelist_id",
        targetings: "targetings",
        uniqShowsLimit: "uniq_shows_limit",
        uniqShowsPeriod: "uniq_shows_period",
        utm: "utm",
        notAd: "not_ad",
      } as const;

      for (const [inputKey, providerKey] of Object.entries(
        fieldMap,
      ) as Array<
        [
          keyof typeof fieldMap,
          (typeof fieldMap)[keyof typeof fieldMap],
        ]
      >) {
        const value = input[inputKey];

        if (value !== undefined) {
          Object.assign(request, { [providerKey]: value });
        }
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();

      if (input.adPlanId !== undefined) {
        await vkAdsClient.getAdPlan(input.adPlanId);
      }

      let created: CreateVkAdsAdGroupResult;

      try {
        created = await vkAdsClient.createAdGroup(request);
      } catch (error) {
        await auditLog.record({
          operation: "ad_groups.create",
          outcome: "failed",
        });
        throw error;
      }

      let group: VkAdsAdGroup;

      try {
        group = await vkAdsClient.getAdGroup(created.id);
      } catch {
        await auditLog.record({
          operation: "ad_groups.create",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Группа объявлений создана, но контрольное чтение не удалось.",
            },
          ],
          structuredContent: {
            created: true as const,
            verified: false,
            auditRecorded: true,
            id: created.id,
            bannerIds: created.bannerIds,
          },
        };
      }

      await auditLog.record({
        operation: "ad_groups.create",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Группа объявлений создана и проверена.",
          },
        ],
        structuredContent: {
          created: true as const,
          verified: true,
          auditRecorded: true,
          id: created.id,
          bannerIds: created.bannerIds,
          group,
        },
      };
    },
  );

  const optionalAdGroupUpdateFieldsSchema = {
    name: z.string().min(1).optional(),
    packageId: z
      .number()
      .int()
      .min(-2_147_483_647)
      .max(2_147_483_647)
      .optional(),
    adPlanId: z.number().int().positive().optional(),
    status: adGroupStatusSchema.optional(),
    ageRestrictions: z
      .string()
      .regex(/^[1-9]?[0-9]\+$/u)
      .optional(),
    auditPixels: z
      .array(z.record(z.string(), z.unknown()))
      .optional(),
    autobiddingMode: z.literal("max_goals").optional(),
    bannerUniqShowsLimit: z
      .number()
      .int()
      .nonnegative()
      .max(2_147_483_647)
      .optional(),
    budgetLimit: decimalInputSchema.optional(),
    budgetLimitDay: decimalInputSchema.optional(),
    dateEnd: z.string().min(1).optional(),
    dateStart: z.string().min(1).optional(),
    dynamicBannersUseStorelink: z.boolean().optional(),
    dynamicWithoutRemarketing: z.boolean().optional(),
    enableOfflineGoals: z.boolean().optional(),
    enableUtm: z.boolean().optional(),
    language: z.enum(["ru", "en"]).optional(),
    marketplaceAppClientId: z.string().min(1).optional(),
    maxPrice: decimalInputSchema.optional(),
    objective: z.string().min(1).optional(),
    price: decimalInputSchema.optional(),
    pricedGoal: z
      .record(z.string(), z.unknown())
      .optional(),
    pricelistId: z
      .number()
      .int()
      .min(-2_147_483_647)
      .max(2_147_483_647)
      .optional(),
    targetings: z
      .record(z.string(), z.unknown())
      .optional(),
    uniqShowsLimit: z
      .number()
      .int()
      .nonnegative()
      .max(2_147_483_647)
      .optional(),
    uniqShowsPeriod: z
      .enum(["day", "week", "month", "eternity"])
      .optional(),
    utm: z.string().optional(),
    notAd: z.boolean().optional(),
    packageFields: z
      .record(z.string(), z.unknown())
      .optional(),
  } as const;

  server.registerTool(
    AD_GROUP_UPDATE_TOOL,
    {
      title: "Обновить группу объявлений VK Рекламы",
      description:
        "Частично обновляет группу объявлений VK Рекламы, поддерживает документированные и package-зависимые поля, затем перечитывает результат и записывает обезличенный audit.",
      inputSchema: z
        .object({
          id: z.number().int().positive(),
          ...optionalAdGroupUpdateFieldsSchema,
        })
        .refine(
          ({ id: _id, packageFields, ...changes }) =>
            Object.values(changes).some(
              (value) => value !== undefined,
            ) ||
            (packageFields !== undefined &&
              Object.keys(packageFields).length > 0),
          {
            message:
              "Укажите хотя бы одно изменяемое поле группы.",
          },
        ),
      outputSchema: {
        updated: z.literal(true),
        verified: z.boolean(),
        auditRecorded: z.boolean(),
        id: z.number().int().positive(),
        group: z
          .object({
            id: z.number().int().positive(),
            name: z.string(),
            status: adGroupStatusSchema,
            adPlanId: z.number().int().nonnegative(),
            packageId: z.number().int(),
            maxPrice: decimalInputSchema.optional(),
          })
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ id, packageFields, ...input }) => {
      const request: UpdateVkAdsAdGroupInput = {
        ...(packageFields ?? {}),
      };
      const fieldMap = {
        name: "name",
        packageId: "package_id",
        adPlanId: "ad_plan_id",
        status: "status",
        ageRestrictions: "age_restrictions",
        auditPixels: "audit_pixels",
        autobiddingMode: "autobidding_mode",
        bannerUniqShowsLimit: "banner_uniq_shows_limit",
        budgetLimit: "budget_limit",
        budgetLimitDay: "budget_limit_day",
        dateEnd: "date_end",
        dateStart: "date_start",
        dynamicBannersUseStorelink:
          "dynamic_banners_use_storelink",
        dynamicWithoutRemarketing:
          "dynamic_without_remarketing",
        enableOfflineGoals: "enable_offline_goals",
        enableUtm: "enable_utm",
        language: "language",
        marketplaceAppClientId: "marketplace_app_client_id",
        maxPrice: "max_price",
        objective: "objective",
        price: "price",
        pricedGoal: "priced_goal",
        pricelistId: "pricelist_id",
        targetings: "targetings",
        uniqShowsLimit: "uniq_shows_limit",
        uniqShowsPeriod: "uniq_shows_period",
        utm: "utm",
        notAd: "not_ad",
      } as const;

      for (const [inputKey, providerKey] of Object.entries(
        fieldMap,
      ) as Array<
        [
          keyof typeof fieldMap,
          (typeof fieldMap)[keyof typeof fieldMap],
        ]
      >) {
        const value = input[inputKey];

        if (value !== undefined) {
          Object.assign(request, { [providerKey]: value });
        }
      }

      await auditLog.ensureReady();
      await vkAdsClient.getAdGroup(id);

      if (input.adPlanId !== undefined) {
        await vkAdsClient.getAdPlan(input.adPlanId);
      }

      try {
        await vkAdsClient.updateAdGroup(id, request);
      } catch (error) {
        await auditLog.record({
          operation: "ad_groups.update",
          outcome: "failed",
        });
        throw error;
      }

      let group: VkAdsAdGroup;

      try {
        group = await vkAdsClient.getAdGroup(id);
      } catch {
        await auditLog.record({
          operation: "ad_groups.update",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Группа объявлений обновлена, но контрольное чтение не удалось.",
            },
          ],
          structuredContent: {
            updated: true as const,
            verified: false,
            auditRecorded: true,
            id,
          },
        };
      }

      await auditLog.record({
        operation: "ad_groups.update",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Группа объявлений обновлена и проверена.",
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true,
          auditRecorded: true,
          id,
          group,
        },
      };
    },
  );

  server.registerTool(
    AD_GROUP_DELETE_TOOL,
    {
      title: "Удалить группу объявлений VK Рекламы",
      description:
        "Удаляет группу объявлений VK Рекламы по ID, затем перечитывает её и подтверждает статус deleted.",
      inputSchema: {
        id: z.number().int().positive(),
      },
      outputSchema: {
        deleted: z.literal(true),
        verified: z.boolean(),
        auditRecorded: z.boolean(),
        id: z.number().int().positive(),
        group: z
          .object({
            id: z.number().int().positive(),
            name: z.string(),
            status: z.literal("deleted"),
            adPlanId: z.number().int().nonnegative(),
            packageId: z.number().int(),
            maxPrice: decimalInputSchema.optional(),
          })
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      await auditLog.ensureReady();
      await vkAdsClient.getAdGroup(id);

      try {
        await vkAdsClient.deleteAdGroup(id);
      } catch (error) {
        await auditLog.record({
          operation: "ad_groups.delete",
          outcome: "failed",
        });
        throw error;
      }

      let group: VkAdsAdGroup;

      try {
        group = await vkAdsClient.getAdGroup(id);
      } catch {
        await auditLog.record({
          operation: "ad_groups.delete",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Группа объявлений удалена, но контрольное чтение не удалось.",
            },
          ],
          structuredContent: {
            deleted: true as const,
            verified: false,
            auditRecorded: true,
            id,
          },
        };
      }

      if (group.status !== "deleted") {
        await auditLog.record({
          operation: "ad_groups.delete",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "VK Реклама приняла удаление, но группа не получила статус deleted.",
            },
          ],
          structuredContent: {
            deleted: true as const,
            verified: false,
            auditRecorded: true,
            id,
          },
        };
      }

      await auditLog.record({
        operation: "ad_groups.delete",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Группа объявлений удалена и проверена.",
          },
        ],
        structuredContent: {
          deleted: true as const,
          verified: true,
          auditRecorded: true,
          id,
          group: {
            ...group,
            status: "deleted" as const,
          },
        },
      };
    },
  );

  const massAdGroupChangeSchema = z
    .object({
      id: z.number().int().min(1).max(2_147_483_647),
      status: adGroupStatusSchema.optional(),
      max_price: decimalInputSchema.optional(),
    })
    .refine(
      ({ id: _id, ...changes }) =>
        Object.values(changes).some(
          (value) => value !== undefined,
        ),
      {
        message: "Укажите хотя бы одно изменение группы.",
      },
    );

  server.registerTool(
    AD_GROUPS_MASS_ACTION_TOOL,
    {
      title: "Массово обновить группы объявлений VK Рекламы",
      description:
        "Транзакционно обновляет status и max_price у одной–200 групп, предварительно и повторно читает каждую цель и записывает обезличенный audit.",
      inputSchema: {
        changes: z
          .array(massAdGroupChangeSchema)
          .min(1)
          .max(200)
          .refine(
            (items) =>
              new Set(items.map((item) => item.id)).size ===
              items.length,
            {
              message:
                "Каждый ID группы должен встречаться один раз.",
            },
          ),
      },
      outputSchema: {
        updated: z.literal(true),
        verified: z.boolean(),
        auditRecorded: z.boolean(),
        requestedCount: z.number().int().positive().max(200),
        groups: z
          .array(
            z.object({
              id: z.number().int().positive(),
              name: z.string(),
              status: adGroupStatusSchema,
              adPlanId: z.number().int().nonnegative(),
              packageId: z.number().int(),
              maxPrice: decimalInputSchema.optional(),
            }),
          )
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ changes }) => {
      const ids = changes.map((change) => change.id);
      const request: MassUpdateVkAdsAdGroupInput[] =
        changes.map((change) => {
          const item: MassUpdateVkAdsAdGroupInput = {
            id: change.id,
          };

          if (change.status !== undefined) {
            item.status = change.status;
          }

          if (change.max_price !== undefined) {
            item.max_price = change.max_price;
          }

          return item;
        });

      await auditLog.ensureReady();
      await readAdGroupsInBatches(vkAdsClient, ids);

      try {
        await vkAdsClient.massUpdateAdGroups(request);
      } catch (error) {
        await auditLog.record({
          operation: "ad_groups.mass_action",
          outcome: "failed",
        });
        throw error;
      }

      let groups: VkAdsAdGroup[];

      try {
        groups = await readAdGroupsInBatches(vkAdsClient, ids);
      } catch {
        await auditLog.record({
          operation: "ad_groups.mass_action",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Массовое обновление принято, но контрольное чтение всех групп не удалось.",
            },
          ],
          structuredContent: {
            updated: true as const,
            verified: false,
            auditRecorded: true,
            requestedCount: changes.length,
          },
        };
      }

      const valuesMatch = groups.every((group, index) => {
        const change = changes[index];

        if (change === undefined) {
          return false;
        }

        if (
          change.status !== undefined &&
          group.status !== change.status
        ) {
          return false;
        }

        return (
          change.max_price === undefined ||
          (group.maxPrice !== undefined &&
            Number(group.maxPrice) === Number(change.max_price))
        );
      });

      if (!valuesMatch) {
        await auditLog.record({
          operation: "ad_groups.mass_action",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "VK Реклама приняла массовое обновление, но контрольные значения не совпали.",
            },
          ],
          structuredContent: {
            updated: true as const,
            verified: false,
            auditRecorded: true,
            requestedCount: changes.length,
          },
        };
      }

      await auditLog.record({
        operation: "ad_groups.mass_action",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: `Группы массово обновлены и проверены: ${groups.length}.`,
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true,
          auditRecorded: true,
          requestedCount: changes.length,
          groups,
        },
      };
    },
  );

  server.registerTool(
    AD_PLAN_CREATE_TOOL,
    {
      title: "Создать рекламную кампанию VK Рекламы",
      description:
        "Создаёт обычную рекламную кампанию VK Рекламы с одной или несколькими вложенными группами campaigns, затем перечитывает её и возвращает подтверждённое состояние.",
      inputSchema: {
        name: z.string().min(1),
        campaigns: z
          .array(z.record(z.string(), z.unknown()))
          .min(1),
        status: z.enum(["active", "blocked", "deleted"]).optional(),
        autobidding_mode: z.literal("max_goals").optional(),
        budget_limit: decimalInputSchema.optional(),
        budget_limit_day: decimalInputSchema.optional(),
        date_start: z.string().min(1).optional(),
        date_end: z.string().min(1).optional(),
        max_price: decimalInputSchema.optional(),
        objective: z.string().min(1).optional(),
        priced_goal: z.record(z.string(), z.unknown()).optional(),
        pricelist_id: z.number().int().optional(),
        enable_offline_goals: z.boolean().optional(),
        enable_utm: z.boolean().optional(),
      },
      outputSchema: {
        created: z.literal(true),
        verified: z.boolean(),
        auditRecorded: z.boolean(),
        id: z.number().int().positive(),
        campaign: z
          .object({
            id: z.number().int().positive(),
            name: z.string(),
            status: z.enum(["active", "blocked", "deleted"]),
          })
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const request: CreateVkAdsAdPlanInput = {
        name: input.name,
        campaigns: input.campaigns,
      };
      const optionalKeys = [
        "status",
        "autobidding_mode",
        "budget_limit",
        "budget_limit_day",
        "date_start",
        "date_end",
        "max_price",
        "objective",
        "priced_goal",
        "pricelist_id",
        "enable_offline_goals",
        "enable_utm",
      ] as const;

      for (const key of optionalKeys) {
        const value = input[key];

        if (value !== undefined) {
          Object.assign(request, { [key]: value });
        }
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      const created = await vkAdsClient.createAdPlan(request);
      let campaign: VkAdsAdPlan;

      try {
        campaign = await vkAdsClient.getAdPlan(created.id);
      } catch {
        await auditLog.record({
          operation: "ad_plans.create",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Кампания создана, но контрольное чтение не удалось.",
            },
          ],
          structuredContent: {
            created: true as const,
            verified: false,
            auditRecorded: true,
            id: created.id,
          },
        };
      }

      await auditLog.record({
        operation: "ad_plans.create",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Рекламная кампания создана и проверена.",
          },
        ],
        structuredContent: {
          created: true as const,
          verified: true,
          auditRecorded: true,
          id: created.id,
          campaign,
        },
      };
    },
  );

  server.registerTool(
    AD_PLAN_UPDATE_TOOL,
    {
      title: "Обновить рекламную кампанию VK Рекламы",
      description:
        "Частично обновляет обычную рекламную кампанию VK Рекламы по ID, затем перечитывает её и возвращает подтверждённое состояние.",
      inputSchema: z
        .object({
          id: z.number().int().positive(),
          ...optionalAdPlanFieldsSchema,
        })
        .refine(
          ({ id: _id, ...changes }) =>
            Object.values(changes).some(
              (value) => value !== undefined,
            ),
          {
            message: "Укажите хотя бы одно изменяемое поле кампании.",
          },
        ),
      outputSchema: {
        updated: z.literal(true),
        verified: z.boolean(),
        auditRecorded: z.boolean(),
        id: z.number().int().positive(),
        campaign: z
          .object({
            id: z.number().int().positive(),
            name: z.string(),
            status: z.enum(["active", "blocked", "deleted"]),
          })
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ id, ...input }) => {
      const request: UpdateVkAdsAdPlanInput = {};
      const optionalKeys = [
        "name",
        "campaigns",
        "status",
        "autobidding_mode",
        "budget_limit",
        "budget_limit_day",
        "date_start",
        "date_end",
        "max_price",
        "objective",
        "priced_goal",
        "pricelist_id",
        "enable_offline_goals",
        "enable_utm",
      ] as const;

      for (const key of optionalKeys) {
        const value = input[key];

        if (value !== undefined) {
          Object.assign(request, { [key]: value });
        }
      }

      await auditLog.ensureReady();
      await vkAdsClient.getAdPlan(id);

      try {
        await vkAdsClient.updateAdPlan(id, request);
      } catch (error) {
        await auditLog.record({
          operation: "ad_plans.update",
          outcome: "failed",
        });
        throw error;
      }

      let campaign: VkAdsAdPlan;

      try {
        campaign = await vkAdsClient.getAdPlan(id);
      } catch {
        await auditLog.record({
          operation: "ad_plans.update",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Кампания обновлена, но контрольное чтение не удалось.",
            },
          ],
          structuredContent: {
            updated: true as const,
            verified: false,
            auditRecorded: true,
            id,
          },
        };
      }

      await auditLog.record({
        operation: "ad_plans.update",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Рекламная кампания обновлена и проверена.",
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true,
          auditRecorded: true,
          id,
          campaign,
        },
      };
    },
  );

  const massAdPlanChangeSchema = z
    .object({
      id: z.number().int().min(1).max(2_147_483_647),
      status: z.enum(["active", "blocked", "deleted"]).optional(),
      budget_limit: decimalInputSchema.optional(),
      budget_limit_day: decimalInputSchema.optional(),
      date_start: z.string().min(1).optional(),
      date_end: z.string().min(1).optional(),
      max_price: decimalInputSchema.optional(),
    })
    .refine(
      ({ id: _id, ...changes }) =>
        Object.values(changes).some(
          (value) => value !== undefined,
        ),
      {
        message: "Укажите хотя бы одно изменение кампании.",
      },
    );

  server.registerTool(
    AD_PLANS_MASS_ACTION_TOOL,
    {
      title: "Массово обновить кампании VK Рекламы",
      description:
        "Обновляет от одной до 200 рекламных кампаний одним запросом, предварительно и повторно читает каждую цель и записывает обезличенный audit.",
      inputSchema: {
        changes: z
          .array(massAdPlanChangeSchema)
          .min(1)
          .max(200)
          .refine(
            (items) =>
              new Set(items.map((item) => item.id)).size ===
              items.length,
            {
              message:
                "Каждый ID кампании должен встречаться один раз.",
            },
          ),
      },
      outputSchema: {
        updated: z.literal(true),
        verified: z.boolean(),
        auditRecorded: z.boolean(),
        requestedCount: z.number().int().positive().max(200),
        campaigns: z
          .array(
            z.object({
              id: z.number().int().positive(),
              name: z.string(),
              status: z.enum(["active", "blocked", "deleted"]),
            }),
          )
          .optional(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ changes }) => {
      const ids = changes.map((change) => change.id);
      const request = changes.map((change) => {
        const item: MassUpdateVkAdsAdPlanInput = {
          id: change.id,
        };
        const optionalKeys = [
          "status",
          "budget_limit",
          "budget_limit_day",
          "date_start",
          "date_end",
          "max_price",
        ] as const;

        for (const key of optionalKeys) {
          const value = change[key];

          if (value !== undefined) {
            Object.assign(item, { [key]: value });
          }
        }

        return item;
      });

      await auditLog.ensureReady();
      await readAdPlansInBatches(vkAdsClient, ids);

      try {
        await vkAdsClient.massUpdateAdPlans(request);
      } catch (error) {
        await auditLog.record({
          operation: "ad_plans.mass_action",
          outcome: "failed",
        });
        throw error;
      }

      let campaigns: VkAdsAdPlan[];

      try {
        campaigns = await readAdPlansInBatches(vkAdsClient, ids);
      } catch {
        await auditLog.record({
          operation: "ad_plans.mass_action",
          outcome: "verification_failed",
        });

        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Массовое обновление принято, но контрольное чтение всех кампаний не удалось.",
            },
          ],
          structuredContent: {
            updated: true as const,
            verified: false,
            auditRecorded: true,
            requestedCount: changes.length,
          },
        };
      }

      await auditLog.record({
        operation: "ad_plans.mass_action",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: `Кампании массово обновлены и проверены: ${campaigns.length}.`,
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true,
          auditRecorded: true,
          requestedCount: changes.length,
          campaigns,
        },
      };
    },
  );

  server.registerTool(
    AD_REFERENCE_LIST_TOOL,
    {
      title: "Получить рекламные справочники VK Рекламы",
      description:
        "Возвращает страницу полей баннера, шаблонов баннера, пакетов, площадок пакетов или деревьев площадок.",
      inputSchema: {
        resource: z.enum([
          "banner_fields",
          "banner_patterns",
          "packages",
          "packages_pads",
          "pads_trees",
        ]),
        ...referencePaginationInputSchema,
      },
      outputSchema: referenceCollectionOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ resource, limit, offset }) => {
      if (vkAdsClient.listReferenceData === undefined) {
        throw new VkAdsApiError(
          "Reference-data client is unavailable.",
          "not_implemented",
        );
      }

      const result = await vkAdsClient.listReferenceData(resource, {
        limit,
        offset,
      });

      return {
        content: [
          {
            type: "text",
            text: `Получено элементов справочника: ${result.items.length} из ${result.count}.`,
          },
        ],
        structuredContent: {
          count: result.count,
          limit: result.limit,
          offset: result.offset,
          items: result.items,
        },
      };
    },
  );

  server.registerTool(
    MOBILE_REFERENCE_LIST_TOOL,
    {
      title: "Получить мобильные справочники VK Рекламы",
      description:
        "Возвращает страницу категорий событий, мобильных категорий, ОС, операторов, типов или производителей устройств.",
      inputSchema: {
        resource: z.enum([
          "in_app_event_categories",
          "mobile_categories",
          "mobile_os",
          "mobile_operators",
          "mobile_types",
          "mobile_vendors",
        ]),
        ...referencePaginationInputSchema,
      },
      outputSchema: referenceCollectionOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ resource, limit, offset }) => {
      if (vkAdsClient.listReferenceData === undefined) {
        throw new VkAdsApiError(
          "Reference-data client is unavailable.",
          "not_implemented",
        );
      }

      const result = await vkAdsClient.listReferenceData(resource, {
        limit,
        offset,
      });

      return {
        content: [
          {
            type: "text",
            text: `Получено элементов мобильного справочника: ${result.items.length} из ${result.count}.`,
          },
        ],
        structuredContent: {
          count: result.count,
          limit: result.limit,
          offset: result.offset,
          items: result.items,
        },
      };
    },
  );

  const registerSingleReferenceCollectionTool = (
    name: string,
    title: string,
    description: string,
    resource: VkAdsReferenceCollectionResource,
  ): void => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: referencePaginationInputSchema,
        outputSchema: referenceCollectionOutputSchema,
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ limit, offset }) => {
        if (vkAdsClient.listReferenceData === undefined) {
          throw new VkAdsApiError(
            "Reference-data client is unavailable.",
            "not_implemented",
          );
        }

        const result = await vkAdsClient.listReferenceData(resource, {
          limit,
          offset,
        });

        return {
          content: [
            {
              type: "text",
              text: `Получено элементов: ${result.items.length} из ${result.count}.`,
            },
          ],
          structuredContent: {
            count: result.count,
            limit: result.limit,
            offset: result.offset,
            items: result.items,
          },
        };
      },
    );
  };

  registerSingleReferenceCollectionTool(
    CURRENCIES_LIST_TOOL,
    "Получить валюты VK Рекламы",
    "Возвращает валюты и связанные с ними бюджетные ограничения.",
    "currencies",
  );
  registerSingleReferenceCollectionTool(
    MOBILE_APPS_LIST_TOOL,
    "Получить мобильные приложения VK Рекламы",
    "Возвращает страницу мобильных приложений текущего кабинета.",
    "mobile_apps",
  );
  registerSingleReferenceCollectionTool(
    REGIONS_LIST_TOOL,
    "Получить регионы VK Рекламы",
    "Возвращает страницу географического справочника регионов.",
    "regions",
  );
  registerSingleReferenceCollectionTool(
    TRANSACTION_GROUPS_LIST_TOOL,
    "Получить группы транзакций VK Рекламы",
    "Возвращает страницу групп транзакций текущего кабинета.",
    "transaction_groups",
  );

  const registerReferenceMapTool = (
    name: string,
    title: string,
    description: string,
    resource: VkAdsReferenceMapResource,
  ): void => {
    server.registerTool(
      name,
      {
        title,
        description,
        inputSchema: {},
        outputSchema: {
          data: z.record(z.string(), z.unknown()),
        },
        annotations: {
          readOnlyHint: true,
          destructiveHint: false,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async () => {
        if (vkAdsClient.getReferenceMap === undefined) {
          throw new VkAdsApiError(
            "Reference-data client is unavailable.",
            "not_implemented",
          );
        }

        const data = await vkAdsClient.getReferenceMap(resource);

        return {
          content: [
            {
              type: "text",
              text: `Получен справочник с разделами: ${Object.keys(data).length}.`,
            },
          ],
          structuredContent: { data },
        };
      },
    );
  };

  registerReferenceMapTool(
    TARGETINGS_TREE_GET_TOOL,
    "Получить дерево таргетингов VK Рекламы",
    "Возвращает актуальное дерево интересов и социально-демографических таргетингов.",
    "targetings_tree",
  );
  registerReferenceMapTool(
    THROTTLING_GET_TOOL,
    "Получить лимиты API VK Рекламы",
    "Возвращает справочник ограничений частоты запросов API.",
    "throttling",
  );

  server.registerTool(
    URL_RESOLVE_TOOL,
    {
      title: "Получить ID рекламируемой ссылки VK Рекламы",
      description:
        "Проверяет URL через API v1 и возвращает его идентификатор и классификацию.",
      inputSchema: {
        url: advertisingUrlInputSchema,
      },
      outputSchema: {
        item: vkAdsUrlOutputSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url }) => {
      const resolveUrl = vkAdsClient.resolveUrl;

      if (resolveUrl === undefined) {
        throw new VkAdsApiError(
          "URL resolver is unavailable.",
          "url_client_unavailable",
        );
      }

      const item = await resolveUrl.call(vkAdsClient, url);

      return {
        content: [
          {
            type: "text",
            text: "Рекламируемая ссылка проверена.",
          },
        ],
        structuredContent: { item },
      };
    },
  );

  server.registerTool(
    URL_CREATE_TOOL,
    {
      title: "Отправить рекламируемую ссылку на проверку",
      description:
        "Создаёт объект URL через API v2, перечитывает его и проверяет сохранённую ссылку.",
      inputSchema: {
        url: advertisingUrlInputSchema,
      },
      outputSchema: {
        created: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        item: vkAdsUrlOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ url }) => {
      const createUrl = vkAdsClient.createUrl;
      const getUrl = vkAdsClient.getUrl;

      if (createUrl === undefined || getUrl === undefined) {
        throw new VkAdsApiError(
          "URL client is unavailable.",
          "url_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      let item: VkAdsUrl;

      try {
        const created = await createUrl.call(vkAdsClient, url);
        item = await getUrl.call(vkAdsClient, created.id);

        if (item.id !== created.id || item.url !== url) {
          throw new VkAdsApiError(
            "Created URL could not be verified.",
            "url_verification_failed",
          );
        }
      } catch (error) {
        await auditLog.record({
          operation: "urls.create",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "urls.create",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Ссылка отправлена на проверку и перечитана.",
          },
        ],
        structuredContent: {
          created: true as const,
          verified: true as const,
          auditRecorded: true,
          item,
        },
      };
    },
  );

  server.registerTool(
    URL_GET_TOOL,
    {
      title: "Получить рекламируемую ссылку VK Рекламы",
      description:
        "Возвращает один объект URL API v2 по идентификатору.",
      inputSchema: {
        id: z.number().int().positive(),
      },
      outputSchema: {
        item: vkAdsUrlOutputSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      const getUrl = vkAdsClient.getUrl;

      if (getUrl === undefined) {
        throw new VkAdsApiError(
          "URL client is unavailable.",
          "url_client_unavailable",
        );
      }

      const item = await getUrl.call(vkAdsClient, id);

      return {
        content: [
          { type: "text", text: "Рекламируемая ссылка получена." },
        ],
        structuredContent: { item },
      };
    },
  );

  server.registerTool(
    URLS_GET_TOOL,
    {
      title: "Получить рекламируемые ссылки VK Рекламы",
      description:
        "Возвращает до 50 объектов URL API v2 за один запрос.",
      inputSchema: {
        ids: z
          .array(z.number().int().positive())
          .min(1)
          .max(50)
          .refine(
            (ids) => new Set(ids).size === ids.length,
            "ID ссылок не должны повторяться.",
          ),
      },
      outputSchema: {
        items: z.array(vkAdsUrlOutputSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ ids }) => {
      const getUrls = vkAdsClient.getUrls;

      if (getUrls === undefined) {
        throw new VkAdsApiError(
          "URL client is unavailable.",
          "url_client_unavailable",
        );
      }

      const items = await getUrls.call(vkAdsClient, ids);
      const returnedIds = new Set(items.map((item) => item.id));

      if (
        items.length !== ids.length ||
        ids.some((id) => !returnedIds.has(id))
      ) {
        throw new VkAdsApiError(
          "VK Ads did not return every requested URL.",
          "invalid_api_response",
        );
      }

      return {
        content: [
          {
            type: "text",
            text: `Получено ссылок: ${items.length}.`,
          },
        ],
        structuredContent: { items },
      };
    },
  );

  server.registerTool(
    MOBILE_STORE_APP_GET_TOOL,
    {
      title: "Получить приложение App Store или Google Play",
      description:
        "Возвращает безопасные метаданные приложения из кэша VK Рекламы.",
      inputSchema: mobileStoreAppInputSchema,
      outputSchema: {
        app: mobileStoreAppOutputSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ store, identifier }) => {
      const getMobileStoreApp = vkAdsClient.getMobileStoreApp;

      if (getMobileStoreApp === undefined) {
        throw new VkAdsApiError(
          "Mobile-store application client is unavailable.",
          "mobile_store_app_client_unavailable",
        );
      }

      const app = await getMobileStoreApp.call(
        vkAdsClient,
        store,
        identifier,
      );

      return {
        content: [
          {
            type: "text",
            text: "Данные приложения получены.",
          },
        ],
        structuredContent: { app },
      };
    },
  );

  server.registerTool(
    MOBILE_STORE_APP_REFRESH_TOOL,
    {
      title: "Обновить данные приложения App Store или Google Play",
      description:
        "Обновляет кэш приложения VK Рекламы и подтверждает результат отдельным чтением.",
      inputSchema: mobileStoreAppInputSchema,
      outputSchema: {
        refreshed: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        app: mobileStoreAppOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ store, identifier }) => {
      const refreshMobileStoreApp =
        vkAdsClient.refreshMobileStoreApp;
      const getMobileStoreApp = vkAdsClient.getMobileStoreApp;

      if (
        refreshMobileStoreApp === undefined ||
        getMobileStoreApp === undefined
      ) {
        throw new VkAdsApiError(
          "Mobile-store application client is unavailable.",
          "mobile_store_app_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      let app: VkAdsMobileStoreApp;

      try {
        const refreshed = await refreshMobileStoreApp.call(
          vkAdsClient,
          store,
          identifier,
        );
        app = await getMobileStoreApp.call(
          vkAdsClient,
          store,
          identifier,
        );

        if (
          refreshed.id !== app.id ||
          app.identifier !== identifier ||
          refreshed.identifier !== identifier
        ) {
          throw new VkAdsApiError(
            "Refreshed application could not be verified.",
            "mobile_store_app_verification_failed",
          );
        }
      } catch (error) {
        await auditLog.record({
          operation: `mobile_store_apps.${store}.refresh`,
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: `mobile_store_apps.${store}.refresh`,
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Данные приложения обновлены и проверены.",
          },
        ],
        structuredContent: {
          refreshed: true as const,
          verified: true as const,
          auditRecorded: true,
          app,
        },
      };
    },
  );

  server.registerTool(
    SKAD_NETWORK_IDS_TRANSFER_TOOL,
    {
      title: "Передать или вернуть SKAdNetwork ID",
      description:
        "Передаёт ID кампаний iOS другому кабинету либо возвращает их и подтверждает изменение доступного количества.",
      inputSchema: {
        action: z.enum(["share", "withdraw"]),
        appId: z.number().int().positive(),
        count: z.number().int().positive(),
        username: z.string().min(1).max(255),
      },
      outputSchema: {
        changed: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        action: z.enum(["share", "withdraw"]),
        count: z.number().int().positive(),
        availableBefore: z.number().int().nonnegative(),
        availableAfter: z.number().int().nonnegative(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ action, appId, count, username }) => {
      const listMobileApps = vkAdsClient.listMobileAppsForSkAd;
      const transferIds = vkAdsClient.transferSkAdNetworkIds;

      if (listMobileApps === undefined || transferIds === undefined) {
        throw new VkAdsApiError(
          "SKAdNetwork client is unavailable.",
          "skad_network_client_unavailable",
        );
      }

      const findApp = (items: Array<Record<string, unknown>>) =>
        items.find(
          (item) => item.rb_mobile_app_id === appId,
        );
      await auditLog.ensureReady();
      const beforeItems = await listMobileApps.call(vkAdsClient);
      const beforeApp = findApp(beforeItems);
      const availableBefore =
        beforeApp === undefined
          ? undefined
          : readSkAdAvailable(beforeApp);

      if (availableBefore === undefined) {
        throw new VkAdsApiError(
          "Apple application with SKAdNetwork counters was not found.",
          "unknown_skad_network_application",
          404,
        );
      }

      if (action === "share" && availableBefore < count) {
        throw new VkAdsApiError(
          "Not enough available SKAdNetwork identifiers.",
          "insufficient_skad_network_ids",
        );
      }

      let availableAfter: number;

      try {
        await transferIds.call(
          vkAdsClient,
          action,
          appId,
          count,
          username,
        );
        const afterItems = await listMobileApps.call(vkAdsClient);
        const afterApp = findApp(afterItems);
        const reread =
          afterApp === undefined
            ? undefined
            : readSkAdAvailable(afterApp);
        const expected =
          action === "share"
            ? availableBefore - count
            : availableBefore + count;

        if (reread !== expected) {
          throw new VkAdsApiError(
            "SKAdNetwork transfer could not be verified.",
            "skad_network_verification_failed",
          );
        }

        availableAfter = reread;
      } catch (error) {
        await auditLog.record({
          operation: `skad_network_ids.${action}`,
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: `skad_network_ids.${action}`,
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text:
              action === "share"
                ? "SKAdNetwork ID переданы и проверены."
                : "SKAdNetwork ID возвращены и проверены.",
          },
        ],
        structuredContent: {
          changed: true as const,
          verified: true as const,
          auditRecorded: true,
          action,
          count,
          availableBefore,
          availableAfter,
        },
      };
    },
  );

  server.registerTool(
    USER_PROFILE_GET_TOOL,
    {
      title: "Получить профиль кабинета VK Рекламы",
      description:
        "Возвращает безопасные настройки текущего пользователя через API v2 или v3 без email и ФИО.",
      inputSchema: {
        version: z.enum(["v2", "v3"]).default("v3"),
      },
      outputSchema: {
        profile: userProfileOutputSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ version }) => {
      const getUserProfile = vkAdsClient.getUserProfile;

      if (getUserProfile === undefined) {
        throw new VkAdsApiError(
          "User-profile client is unavailable.",
          "user_profile_client_unavailable",
        );
      }

      const profile = await getUserProfile.call(
        vkAdsClient,
        version,
      );

      return {
        content: [
          {
            type: "text",
            text: `Профиль кабинета получен через ${version}.`,
          },
        ],
        structuredContent: { profile },
      };
    },
  );

  server.registerTool(
    USER_LANGUAGE_UPDATE_TOOL,
    {
      title: "Изменить язык кабинета VK Рекламы",
      description:
        "Изменяет язык текущего пользователя через API v2 или v3 и подтверждает результат отдельным чтением.",
      inputSchema: {
        version: z.enum(["v2", "v3"]),
        language: z.enum(["ru", "en"]),
      },
      outputSchema: {
        updated: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        profile: userProfileOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ version, language }) => {
      const updateUserLanguage = vkAdsClient.updateUserLanguage;
      const getUserProfile = vkAdsClient.getUserProfile;

      if (
        updateUserLanguage === undefined ||
        getUserProfile === undefined
      ) {
        throw new VkAdsApiError(
          "User-profile client is unavailable.",
          "user_profile_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await getUserProfile.call(vkAdsClient, version);
      let profile: VkAdsUserProfile;

      try {
        await updateUserLanguage.call(
          vkAdsClient,
          version,
          language,
        );
        profile = await getUserProfile.call(
          vkAdsClient,
          version,
        );

        if (profile.language !== language) {
          throw new VkAdsApiError(
            "Updated user language could not be verified.",
            "user_profile_verification_failed",
          );
        }
      } catch (error) {
        await auditLog.record({
          operation: `user.${version}.language.update`,
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: `user.${version}.language.update`,
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Язык кабинета изменён и проверен.",
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true as const,
          auditRecorded: true,
          profile,
        },
      };
    },
  );

  server.registerTool(
    ORD_USER_STATUS_GET_TOOL,
    {
      title: "Проверить заполненность данных физлица ОРД",
      description:
        "Проверяет наличие полей ОРД текущего пользователя без возврата ФИО, телефона, ИНН и других значений.",
      inputSchema: {},
      outputSchema: {
        status: ordUserStatusOutputSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async () => {
      const getOrdUser = vkAdsClient.getOrdUser;

      if (getOrdUser === undefined) {
        throw new VkAdsApiError(
          "ORD user client is unavailable.",
          "ord_user_client_unavailable",
        );
      }

      const user = await getOrdUser.call(vkAdsClient);

      return {
        content: [
          {
            type: "text",
            text: "Заполненность данных ОРД проверена.",
          },
        ],
        structuredContent: {
          status: ordUserStatus(user),
        },
      };
    },
  );

  server.registerTool(
    ORD_USER_UPDATE_TOOL,
    {
      title: "Изменить данные физлица ОРД",
      description:
        "Изменяет переданные поля ОРД, перечитывает их, но возвращает только флаги заполненности без персональных значений.",
      inputSchema: ordUserUpdateInputSchema,
      outputSchema: {
        updated: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        status: ordUserStatusOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const getOrdUser = vkAdsClient.getOrdUser;
      const updateOrdUser = vkAdsClient.updateOrdUser;

      if (getOrdUser === undefined || updateOrdUser === undefined) {
        throw new VkAdsApiError(
          "ORD user client is unavailable.",
          "ord_user_client_unavailable",
        );
      }

      const request: VkAdsOrdUser = {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.phone === undefined ? {} : { phone: input.phone }),
        ...(input.inn === undefined ? {} : { inn: input.inn }),
        ...(input.foreignEPaymentMethod === undefined
          ? {}
          : {
              foreign_epayment_method:
                input.foreignEPaymentMethod,
            }),
        ...(input.foreignCountryCode === undefined
          ? {}
          : {
              foreign_oksm_country_code:
                input.foreignCountryCode,
            }),
        ...(input.foreignRegistrationNumber === undefined
          ? {}
          : {
              foreign_registration_number:
                input.foreignRegistrationNumber,
            }),
        ...(input.foreignInn === undefined
          ? {}
          : { foreign_inn: input.foreignInn }),
        ...(input.site === undefined ? {} : { site: input.site }),
      };
      await auditLog.ensureReady();
      await getOrdUser.call(vkAdsClient);
      let user: VkAdsOrdUser;

      try {
        await updateOrdUser.call(vkAdsClient, request);
        user = await getOrdUser.call(vkAdsClient);

        if (
          Object.entries(request).some(
            ([key, value]) =>
              user[key as keyof VkAdsOrdUser] !== value,
          )
        ) {
          throw new VkAdsApiError(
            "Updated ORD user data could not be verified.",
            "ord_user_verification_failed",
          );
        }
      } catch (error) {
        await auditLog.record({
          operation: "ord_user.update",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "ord_user.update",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Данные ОРД изменены и проверены.",
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true as const,
          auditRecorded: true,
          status: ordUserStatus(user),
        },
      };
    },
  );

  server.registerTool(
    USER_GEO_LIST_TOOL,
    {
      title: "Получить пользовательские регионы VK Рекламы",
      description:
        "Возвращает страницу регионов, указанных пользователями, с фильтром по ID или имени.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().nonnegative().optional(),
        ids: z
          .array(z.number().int())
          .min(1)
          .max(200)
          .optional(),
        query: z.string().min(1).optional(),
      },
      outputSchema: {
        count: z.number().int().nonnegative(),
        limit: z.number().int().positive(),
        offset: z.number().int().nonnegative(),
        items: z.array(userGeoOutputSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      const listUserGeo = vkAdsClient.listUserGeo;

      if (listUserGeo === undefined) {
        throw new VkAdsApiError(
          "User-geo client is unavailable.",
          "user_geo_client_unavailable",
        );
      }

      const result = await listUserGeo.call(vkAdsClient, {
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.offset === undefined
          ? {}
          : { offset: input.offset }),
        ...(input.ids === undefined ? {} : { ids: input.ids }),
        ...(input.query === undefined
          ? {}
          : { query: input.query }),
      });

      return {
        content: [
          {
            type: "text",
            text: `Получено пользовательских регионов: ${result.items.length}.`,
          },
        ],
        structuredContent: {
          count: result.count,
          limit: result.limit,
          offset: result.offset,
          items: result.items,
        },
      };
    },
  );

  server.registerTool(
    SURVEYS_LIST_TOOL,
    {
      title: "Получить опросы VK Рекламы",
      description:
        "Возвращает страницу опросов с фильтрами, поиском и сортировкой.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().nonnegative().optional(),
        adPlanIds: statisticsIdListSchema.optional(),
        adGroupIds: statisticsIdListSchema.optional(),
        bannerIds: statisticsIdListSchema.optional(),
        query: z.string().min(1).optional(),
        sorting: z.array(z.string().min(1)).min(1).optional(),
        includeActiveAdPlanIds: z.boolean().optional(),
      },
      outputSchema: {
        count: z.number().int().nonnegative(),
        offset: z.number().int().nonnegative(),
        limit: z.number().int().positive(),
        items: z.array(surveyOutputSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      if (vkAdsClient.listSurveys === undefined) {
        throw new VkAdsApiError(
          "Survey client is unavailable.",
          "survey_client_unavailable",
        );
      }

      const request: ListVkAdsSurveysInput = {
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.offset === undefined ? {} : { offset: input.offset }),
        ...(input.adPlanIds === undefined
          ? {}
          : { adPlanIds: input.adPlanIds }),
        ...(input.adGroupIds === undefined
          ? {}
          : { adGroupIds: input.adGroupIds }),
        ...(input.bannerIds === undefined
          ? {}
          : { bannerIds: input.bannerIds }),
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.sorting === undefined
          ? {}
          : { sorting: input.sorting }),
        ...(input.includeActiveAdPlanIds === undefined
          ? {}
          : {
              includeActiveAdPlanIds:
                input.includeActiveAdPlanIds,
            }),
      };
      const result = await vkAdsClient.listSurveys(request);

      return {
        content: [
          {
            type: "text",
            text: `Получено опросов: ${result.items.length} из ${result.count}.`,
          },
        ],
        structuredContent: {
          count: result.count,
          offset: result.offset,
          limit: result.limit,
          items: result.items,
        },
      };
    },
  );

  server.registerTool(
    SURVEY_GET_TOOL,
    {
      title: "Получить опрос VK Рекламы",
      description: "Возвращает один опрос по его ID.",
      inputSchema: {
        id: z.number().int().positive(),
      },
      outputSchema: {
        survey: surveyOutputSchema,
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      if (vkAdsClient.getSurvey === undefined) {
        throw new VkAdsApiError(
          "Survey client is unavailable.",
          "survey_client_unavailable",
        );
      }

      const survey = await vkAdsClient.getSurvey(id);

      return {
        content: [{ type: "text", text: "Опрос получен." }],
        structuredContent: { survey },
      };
    },
  );

  server.registerTool(
    SURVEY_CREATE_TOOL,
    {
      title: "Создать опрос VK Рекламы",
      description:
        "Создаёт опрос, перечитывает его и проверяет все переданные поля.",
      inputSchema: surveyCreateInputShape,
      outputSchema: {
        created: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        survey: surveyOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      const createSurvey = vkAdsClient.createSurvey;
      const getSurvey = vkAdsClient.getSurvey;

      if (createSurvey === undefined || getSurvey === undefined) {
        throw new VkAdsApiError(
          "Survey client is unavailable.",
          "survey_client_unavailable",
        );
      }

      const request: CreateVkAdsSurveyInput = {
        name: input.name,
        first_screen_type: input.firstScreenType,
        title: input.title,
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        company_title: input.companyTitle,
        result_info: input.resultInfo,
        pages: input.pages,
        logo_id: input.logoId,
        gradient: input.gradient,
      };
      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      let survey: VkAdsSurvey;

      try {
        const created = await createSurvey.call(vkAdsClient, request);
        survey = await getSurvey.call(vkAdsClient, created.id);

        if (!surveyMatches(survey, request)) {
          throw new VkAdsApiError(
            "Created survey did not match the request.",
            "survey_verification_failed",
          );
        }
      } catch (error) {
        await auditLog.record({
          operation: "surveys.create",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "surveys.create",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Опрос создан и проверен.",
          },
        ],
        structuredContent: {
          created: true as const,
          verified: true as const,
          auditRecorded: true,
          survey,
        },
      };
    },
  );

  server.registerTool(
    SURVEY_UPDATE_TOOL,
    {
      title: "Изменить опрос VK Рекламы",
      description:
        "Изменяет поля опроса и подтверждает результат повторным чтением; resultInfo и pages полностью заменяются.",
      inputSchema: {
        id: z.number().int().positive(),
        changes: z
          .object({
            name: surveyCreateInputShape.name.optional(),
            firstScreenType:
              surveyCreateInputShape.firstScreenType.optional(),
            title: surveyCreateInputShape.title.optional(),
            description:
              surveyCreateInputShape.description.optional(),
            companyTitle:
              surveyCreateInputShape.companyTitle.optional(),
            resultInfo:
              surveyCreateInputShape.resultInfo.optional(),
            pages: surveyCreateInputShape.pages.optional(),
            logoId: surveyCreateInputShape.logoId.optional(),
            gradient: surveyCreateInputShape.gradient.optional(),
          })
          .refine(
            (changes) =>
              Object.values(changes).some(
                (value) => value !== undefined,
              ),
            "Укажите хотя бы одно изменение.",
          ),
      },
      outputSchema: {
        updated: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        survey: surveyOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ id, changes }) => {
      const updateSurvey = vkAdsClient.updateSurvey;
      const getSurvey = vkAdsClient.getSurvey;

      if (updateSurvey === undefined || getSurvey === undefined) {
        throw new VkAdsApiError(
          "Survey client is unavailable.",
          "survey_client_unavailable",
        );
      }

      const request: UpdateVkAdsSurveyInput = {
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(changes.firstScreenType === undefined
          ? {}
          : { first_screen_type: changes.firstScreenType }),
        ...(changes.title === undefined
          ? {}
          : { title: changes.title }),
        ...(changes.description === undefined
          ? {}
          : { description: changes.description }),
        ...(changes.companyTitle === undefined
          ? {}
          : { company_title: changes.companyTitle }),
        ...(changes.resultInfo === undefined
          ? {}
          : { result_info: changes.resultInfo }),
        ...(changes.pages === undefined
          ? {}
          : { pages: changes.pages }),
        ...(changes.logoId === undefined
          ? {}
          : { logo_id: changes.logoId }),
        ...(changes.gradient === undefined
          ? {}
          : { gradient: changes.gradient }),
      };
      await auditLog.ensureReady();
      await getSurvey.call(vkAdsClient, id);
      let survey: VkAdsSurvey;

      try {
        await updateSurvey.call(vkAdsClient, id, request);
        survey = await getSurvey.call(vkAdsClient, id);

        if (!surveyMatches(survey, request)) {
          throw new VkAdsApiError(
            "Updated survey did not match the request.",
            "survey_verification_failed",
          );
        }
      } catch (error) {
        await auditLog.record({
          operation: "surveys.update",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "surveys.update",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Опрос изменён и проверен.",
          },
        ],
        structuredContent: {
          updated: true as const,
          verified: true as const,
          auditRecorded: true,
          survey,
        },
      };
    },
  );

  server.registerTool(
    SURVEY_COPY_TOOL,
    {
      title: "Скопировать опрос VK Рекламы",
      description:
        "Копирует существующий опрос и проверяет новый объект чтением.",
      inputSchema: {
        id: z.number().int().positive(),
        name: z.string().min(1).max(255).optional(),
      },
      outputSchema: {
        copied: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        survey: surveyOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ id, name }) => {
      const copySurvey = vkAdsClient.copySurvey;
      const getSurvey = vkAdsClient.getSurvey;

      if (copySurvey === undefined || getSurvey === undefined) {
        throw new VkAdsApiError(
          "Survey client is unavailable.",
          "survey_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await getSurvey.call(vkAdsClient, id);
      let survey: VkAdsSurvey;

      try {
        const copied = await copySurvey.call(vkAdsClient, id, name);
        survey = await getSurvey.call(vkAdsClient, copied.id);

        if (
          survey.id === id ||
          (name !== undefined && survey.name !== name)
        ) {
          throw new VkAdsApiError(
            "Copied survey could not be verified.",
            "survey_verification_failed",
          );
        }
      } catch (error) {
        await auditLog.record({
          operation: "surveys.copy",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "surveys.copy",
        outcome: "success",
      });

      return {
        content: [
          { type: "text", text: "Опрос скопирован и проверен." },
        ],
        structuredContent: {
          copied: true as const,
          verified: true as const,
          auditRecorded: true,
          survey,
        },
      };
    },
  );

  const registerSurveyArchiveTool = (
    name: string,
    archived: boolean,
  ): void => {
    server.registerTool(
      name,
      {
        title: archived
          ? "Архивировать опросы VK Рекламы"
          : "Вернуть опросы из архива VK Рекламы",
        description: archived
          ? "Архивирует опросы и проверяет статус каждого повторным чтением."
          : "Возвращает опросы из архива и проверяет статус каждого повторным чтением.",
        inputSchema: { ids: surveyIdsSchema },
        outputSchema: {
          changed: z.literal(true),
          verified: z.literal(true),
          auditRecorded: z.boolean(),
          surveys: z.array(surveyOutputSchema),
        },
        annotations: {
          readOnlyHint: false,
          destructiveHint: archived,
          idempotentHint: true,
          openWorldHint: true,
        },
      },
      async ({ ids }) => {
        const setSurveysArchived = vkAdsClient.setSurveysArchived;
        const getSurvey = vkAdsClient.getSurvey;

        if (
          setSurveysArchived === undefined ||
          getSurvey === undefined
        ) {
          throw new VkAdsApiError(
            "Survey client is unavailable.",
            "survey_client_unavailable",
          );
        }

        await auditLog.ensureReady();
        await Promise.all(
          ids.map(async (id) => await getSurvey.call(vkAdsClient, id)),
        );
        let surveys: VkAdsSurvey[];

        try {
          await setSurveysArchived.call(vkAdsClient, ids, archived);
          surveys = await Promise.all(
            ids.map(
              async (id) => await getSurvey.call(vkAdsClient, id),
            ),
          );

          const expectedStatus = archived ? 2 : 1;

          if (
            surveys.some(
              (survey) => survey.status !== expectedStatus,
            )
          ) {
            throw new VkAdsApiError(
              "Survey archival state could not be verified.",
              "survey_verification_failed",
            );
          }
        } catch (error) {
          await auditLog.record({
            operation: archived
              ? "surveys.archive"
              : "surveys.unarchive",
            outcome: "failed",
          });
          throw error;
        }

        await auditLog.record({
          operation: archived
            ? "surveys.archive"
            : "surveys.unarchive",
          outcome: "success",
        });

        return {
          content: [
            {
              type: "text",
              text: archived
                ? "Опросы архивированы и проверены."
                : "Опросы возвращены из архива и проверены.",
            },
          ],
          structuredContent: {
            changed: true as const,
            verified: true as const,
            auditRecorded: true,
            surveys,
          },
        };
      },
    );
  };

  registerSurveyArchiveTool(SURVEYS_ARCHIVE_TOOL, true);
  registerSurveyArchiveTool(SURVEYS_UNARCHIVE_TOOL, false);

  server.registerTool(
    RESPONDENTS_LIST_TOOL,
    {
      title: "Получить респондентов VK Рекламы",
      description:
        "Возвращает безопасные метаданные респондентов без ответов и персональных контактных данных.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().nonnegative().optional(),
        surveyIds: statisticsIdListSchema.optional(),
        adPlanIds: statisticsIdListSchema.optional(),
        adGroupIds: statisticsIdListSchema.optional(),
        bannerIds: statisticsIdListSchema.optional(),
        createdAtFrom: leadDateTimeInputSchema.optional(),
        createdAtTo: leadDateTimeInputSchema.optional(),
        sorting: z.array(z.string().min(1)).min(1).optional(),
      },
      outputSchema: {
        count: z.number().int().nonnegative(),
        offset: z.number().int().nonnegative(),
        limit: z.number().int().positive(),
        items: z.array(respondentOutputSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      if (vkAdsClient.listRespondents === undefined) {
        throw new VkAdsApiError(
          "Respondent client is unavailable.",
          "respondent_client_unavailable",
        );
      }

      const request: ListVkAdsRespondentsInput = {
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.offset === undefined ? {} : { offset: input.offset }),
        ...(input.surveyIds === undefined
          ? {}
          : { surveyIds: input.surveyIds }),
        ...(input.adPlanIds === undefined
          ? {}
          : { adPlanIds: input.adPlanIds }),
        ...(input.adGroupIds === undefined
          ? {}
          : { adGroupIds: input.adGroupIds }),
        ...(input.bannerIds === undefined
          ? {}
          : { bannerIds: input.bannerIds }),
        ...(input.createdAtFrom === undefined
          ? {}
          : { createdAtFrom: input.createdAtFrom }),
        ...(input.createdAtTo === undefined
          ? {}
          : { createdAtTo: input.createdAtTo }),
        ...(input.sorting === undefined
          ? {}
          : { sorting: input.sorting }),
      };
      const result = await vkAdsClient.listRespondents(request);

      return {
        content: [
          {
            type: "text",
            text: `Получено респондентов: ${result.items.length}.`,
          },
        ],
        structuredContent: {
          count: result.count,
          offset: result.offset,
          limit: result.limit,
          items: result.items,
        },
      };
    },
  );

  server.registerTool(
    SURVEY_RESPONDENTS_EXPORT_TOOL,
    {
      title: "Экспортировать респондентов опроса VK Рекламы",
      description:
        "Сохраняет XLSX с ответами респондентов в новый приватный локальный файл; содержимое и путь не возвращаются через MCP.",
      inputSchema: {
        surveyId: z.number().int().positive(),
        outputPath: z
          .string()
          .min(1)
          .refine((value) => isAbsolute(value), {
            message: "Путь экспорта должен быть абсолютным.",
          }),
      },
      outputSchema: {
        saved: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        bytes: z.number().int().positive(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ surveyId, outputPath }) => {
      const exportSurveyRespondents =
        vkAdsClient.exportSurveyRespondents;
      const getSurvey = vkAdsClient.getSurvey;

      if (
        exportSurveyRespondents === undefined ||
        getSurvey === undefined
      ) {
        throw new VkAdsApiError(
          "Survey export client is unavailable.",
          "survey_client_unavailable",
        );
      }

      if (extname(outputPath).toLowerCase() !== ".xlsx") {
        throw new VkAdsApiError(
          "Survey export path must end with .xlsx.",
          "invalid_survey_export_path",
        );
      }

      await auditLog.ensureReady();
      await getSurvey.call(vkAdsClient, surveyId);
      let exported: VkAdsLeadFormLeadsExport;

      try {
        exported = await exportSurveyRespondents.call(
          vkAdsClient,
          surveyId,
        );

        if (
          exported.bytes[0] !== 0x50 ||
          exported.bytes[1] !== 0x4b
        ) {
          throw new VkAdsApiError(
            "VK Ads returned an invalid XLSX export.",
            "invalid_api_response",
          );
        }

        await writeFile(outputPath, exported.bytes, {
          flag: "wx",
          mode: 0o600,
        });
      } catch (error) {
        await auditLog.record({
          operation: "surveys.respondents.export",
          outcome: "failed",
        });
        throw error;
      }

      const savedFile = await lstat(outputPath);

      if (
        !savedFile.isFile() ||
        savedFile.isSymbolicLink() ||
        savedFile.size !== exported.bytes.byteLength
      ) {
        await auditLog.record({
          operation: "surveys.respondents.export",
          outcome: "verification_failed",
        });
        throw new VkAdsApiError(
          "Saved respondent export could not be verified.",
          "survey_export_verification_failed",
        );
      }

      await auditLog.record({
        operation: "surveys.respondents.export",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Экспорт респондентов сохранён и проверен.",
          },
        ],
        structuredContent: {
          saved: true as const,
          verified: true as const,
          auditRecorded: true,
          bytes: exported.bytes.byteLength,
        },
      };
    },
  );

  server.registerTool(
    SUBSCRIPTIONS_LIST_TOOL,
    {
      title: "Получить подписки VK Рекламы",
      description:
        "Возвращает страницу API-подписок текущего кабинета.",
      inputSchema: {
        limit: z.number().int().min(1).max(50).optional(),
        offset: z.number().int().nonnegative().optional(),
      },
      outputSchema: {
        count: z.number().int().nonnegative(),
        offset: z.number().int().nonnegative(),
        limit: z.number().int().positive(),
        items: z.array(subscriptionOutputSchema),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      if (vkAdsClient.listSubscriptions === undefined) {
        throw new VkAdsApiError(
          "Subscription client is unavailable.",
          "subscription_client_unavailable",
        );
      }

      const result = await vkAdsClient.listSubscriptions({
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.offset === undefined
          ? {}
          : { offset: input.offset }),
      });

      return {
        content: [
          {
            type: "text",
            text: `Получено подписок: ${result.items.length} из ${result.count}.`,
          },
        ],
        structuredContent: {
          count: result.count,
          offset: result.offset,
          limit: result.limit,
          items: result.items,
        },
      };
    },
  );

  server.registerTool(
    SUBSCRIPTION_CREATE_TOOL,
    {
      title: "Создать подписку VK Рекламы",
      description:
        "Создаёт API-подписку на ресурс и проверяет её повторным чтением списка.",
      inputSchema: {
        resource: z.enum(["BANNER", "CAMPAIGN", "OKLEADAD"]),
        callbackUrl: z.string().url().refine(
          (value) => new URL(value).protocol === "https:",
          "Callback URL должен использовать HTTPS.",
        ),
      },
      outputSchema: {
        created: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        subscription: subscriptionOutputSchema,
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ resource, callbackUrl }) => {
      const createSubscription = vkAdsClient.createSubscription;
      const listSubscriptions = vkAdsClient.listSubscriptions;

      if (
        createSubscription === undefined ||
        listSubscriptions === undefined
      ) {
        throw new VkAdsApiError(
          "Subscription client is unavailable.",
          "subscription_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      await vkAdsClient.getCurrentUser();
      let subscription: VkAdsSubscriptionsPage["items"][number];

      try {
        const created = await createSubscription.call(
          vkAdsClient,
          resource,
          callbackUrl,
        );
        const page = await listSubscriptions.call(vkAdsClient, {
          limit: 50,
          offset: 0,
        });
        const found = page.items.find((item) => item.id === created.id);

        if (
          found === undefined ||
          found.resource !== resource ||
          found.callbackUrl !== callbackUrl
        ) {
          throw new VkAdsApiError(
            "Created subscription could not be verified.",
            "subscription_verification_failed",
          );
        }

        subscription = found;
      } catch (error) {
        await auditLog.record({
          operation: "subscriptions.create",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "subscriptions.create",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Подписка создана и проверена.",
          },
        ],
        structuredContent: {
          created: true as const,
          verified: true as const,
          auditRecorded: true,
          subscription,
        },
      };
    },
  );

  server.registerTool(
    SUBSCRIPTION_DELETE_TOOL,
    {
      title: "Удалить подписку VK Рекламы",
      description:
        "Удаляет существующую API-подписку и подтверждает её отсутствие повторным чтением.",
      inputSchema: {
        id: z.number().int().positive(),
      },
      outputSchema: {
        deleted: z.literal(true),
        verified: z.literal(true),
        auditRecorded: z.boolean(),
        id: z.number().int().positive(),
      },
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ id }) => {
      const deleteSubscription = vkAdsClient.deleteSubscription;
      const listSubscriptions = vkAdsClient.listSubscriptions;

      if (
        deleteSubscription === undefined ||
        listSubscriptions === undefined
      ) {
        throw new VkAdsApiError(
          "Subscription client is unavailable.",
          "subscription_client_unavailable",
        );
      }

      await auditLog.ensureReady();
      const before = await listSubscriptions.call(vkAdsClient, {
        limit: 50,
        offset: 0,
      });

      if (!before.items.some((item) => item.id === id)) {
        throw new VkAdsApiError(
          "Subscription was not found.",
          "unknown_subscription",
          404,
        );
      }

      try {
        await deleteSubscription.call(vkAdsClient, id);
        const after = await listSubscriptions.call(vkAdsClient, {
          limit: 50,
          offset: 0,
        });

        if (after.items.some((item) => item.id === id)) {
          throw new VkAdsApiError(
            "Deleted subscription is still present.",
            "subscription_verification_failed",
          );
        }
      } catch (error) {
        await auditLog.record({
          operation: "subscriptions.delete",
          outcome: "failed",
        });
        throw error;
      }

      await auditLog.record({
        operation: "subscriptions.delete",
        outcome: "success",
      });

      return {
        content: [
          {
            type: "text",
            text: "Подписка удалена, отсутствие подтверждено.",
          },
        ],
        structuredContent: {
          deleted: true as const,
          verified: true as const,
          auditRecorded: true,
          id,
        },
      };
    },
  );

  registerVkCommunityTools(
    server,
    communityDependencies ?? {
      client: new VkCommunityClient({
        tokenProvider: () => process.env.VK_API_TOKEN?.trim() ?? "",
        tokenType:
          process.env.VK_API_TOKEN_TYPE === "legacy"
            ? "legacy"
            : "vk_id",
        timeoutMs: 30_000,
      }),
      store: new CommunityResearchStore(
        process.env.VK_COMMUNITY_RESEARCH_FILE?.trim() ||
          ".vk-community-research.json",
        30 * 24 * 60 * 60 * 1_000,
      ),
    },
  );

  return server;
}
