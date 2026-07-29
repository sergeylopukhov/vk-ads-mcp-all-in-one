# Tool routing

Use the smallest route that answers the request. Inspect tool schemas exposed
by MCP before filling provider-specific fields.

## Status and authentication

- Connection: `vk_ads_connection_check`
- Safe account profile: `vk_ads_user_profile_get`
- Forced token refresh: `vk_ads_oauth_token_refresh`
- Revoke all current-account tokens and reauthenticate:
  `vk_ads_oauth_current_tokens_delete`
- Inspect a one-time authorization code: `vk_ads_oauth_code_info`

## Campaign hierarchy

- Campaigns: `vk_ads_ad_plans_list`, `vk_ads_ad_plan_get`,
  `vk_ads_ad_plan_create`, `vk_ads_ad_plan_update`,
  `vk_ads_ad_plans_mass_action`
- Ad groups: `vk_ads_ad_groups_list`, `vk_ads_ad_group_get`,
  `vk_ads_ad_group_create`, `vk_ads_ad_group_update`,
  `vk_ads_ad_group_delete`, `vk_ads_ad_groups_mass_action`
- Ads: `vk_ads_banners_list`, `vk_ads_banner_get`,
  `vk_ads_banner_create`, `vk_ads_banner_update`,
  `vk_ads_banner_delete`, `vk_ads_banners_mass_action`,
  `vk_ads_banners_remoderate`
- Creatives: `vk_ads_content_html5_upload`,
  `vk_ads_content_static_upload`, `vk_ads_content_video_upload`

## Statistics and planning

- Forecast: `vk_ads_projection_predict`
- Daily statistics: `vk_ads_statistics_day_list`
- API v2 daily or summary statistics: `vk_ads_statistics_v2_get`
- Last 60 minutes: `vk_ads_fast_statistics_get`
- Goal conversions: `vk_ads_goal_statistics_get`
- In-app events: `vk_ads_in_app_statistics_get`
- Offline conversions: `vk_ads_offline_conversion_statistics_day_get`,
  `vk_ads_offline_conversion_statistics_summary_get`

## Audiences

- Counters and goals: `vk_ads_remarketing_counters_list`,
  `vk_ads_remarketing_counter_get`,
  `vk_ads_remarketing_counter_goals_list`, `vk_ads_goals_list`
- Offline conversions: `vk_ads_remarketing_offline_goals_list`,
  `vk_ads_remarketing_offline_goal_create`,
  `vk_ads_remarketing_offline_goal_update`,
  `vk_ads_remarketing_offline_goal_delete`
- Uploaded lists: `vk_ads_remarketing_users_lists_list`,
  `vk_ads_remarketing_users_list_get`,
  `vk_ads_remarketing_users_list_create`,
  `vk_ads_remarketing_users_list_update`,
  `vk_ads_remarketing_users_list_delete`
- Segments: `vk_ads_segments_list`, `vk_ads_segment_get`,
  `vk_ads_segment_create`, `vk_ads_segment_update`,
  `vk_ads_segment_delete`
- Segment sources: `vk_ads_segment_relations_list`,
  `vk_ads_segment_relations_create`, `vk_ads_segment_relation_update`,
  `vk_ads_segment_relation_delete`
- Sharing: `vk_ads_sharing_keys_list`, `vk_ads_sharing_key_create`,
  `vk_ads_sharing_key_activate`, `vk_ads_sharing_key_delete`

## Leads and surveys

- Lead forms: `vk_ads_lead_forms_list`, `vk_ads_lead_form_get`,
  `vk_ads_lead_form_create`, `vk_ads_lead_form_update`,
  `vk_ads_lead_form_copy`, `vk_ads_lead_forms_archive`,
  `vk_ads_lead_forms_unarchive`
- Leads: `vk_ads_leads_list`, `vk_ads_lead_form_leads_export`,
  `vk_ads_lead_form_test_lead_send`
- Surveys: `vk_ads_surveys_list`, `vk_ads_survey_get`,
  `vk_ads_survey_create`, `vk_ads_survey_update`,
  `vk_ads_survey_copy`, `vk_ads_surveys_archive`,
  `vk_ads_surveys_unarchive`
- Respondents: `vk_ads_respondents_list`,
  `vk_ads_survey_respondents_export`

## Community research

- One-call foreground research: `vk_find_community_candidates`
- Discovery only: `vk_discover_communities`
- Post and metadata analysis: `vk_analyze_communities`
- Local scoring: `vk_score_communities`
- Background run: `vk_start_community_research`
- Compatible background alias: `vk_research_communities`
- Progress: `vk_get_community_research_progress`
- Saved result: `vk_get_community_research_run`
- Rescore saved data: `vk_rescore_community_research_run`
- In-memory export preparation: `vk_export_community_candidates`

## Supporting data

- Ad references: `vk_ads_ad_reference_list`
- Mobile references: `vk_ads_mobile_reference_list`
- Regions: `vk_ads_regions_list`
- Targeting tree: `vk_ads_targetings_tree_get`
- API limits: `vk_ads_throttling_get`
- URLs: `vk_ads_url_resolve`, `vk_ads_url_get`, `vk_ads_urls_get`,
  `vk_ads_url_create`
- Price lists: `vk_ads_pricelists_list`,
  `vk_ads_pricelist_batch_get`, `vk_ads_pricelist_create`,
  `vk_ads_pricelist_batch_create`

## Current `⛔️` tools

The installed `docs/tools.md` remains authoritative if this list differs.

Read tools that may be attempted with explicit status disclosure:

- `vk_ads_oauth_code_info`
- `vk_start_community_research`
- `vk_research_communities`
- `vk_get_community_research_progress`
- `vk_get_community_research_run`
- `vk_rescore_community_research_run`
- `vk_find_community_candidates`
- `vk_discover_communities`
- `vk_analyze_communities`
- `vk_score_communities`
- `vk_export_community_candidates`
- `vk_ads_remarketing_counter_get`
- `vk_ads_remarketing_counter_goals_list`
- `vk_ads_ord_user_status_get`
- `vk_ads_user_geo_list`

Write tools that are not routine operations:

- `vk_ads_oauth_current_tokens_delete`
- `vk_ads_oauth_token_refresh`
- `vk_ads_banners_remoderate`
- `vk_ads_remarketing_counter_create`
- `vk_ads_remarketing_counter_update`
- `vk_ads_remarketing_counter_delete`
- `vk_ads_remarketing_counter_goal_create`
- `vk_ads_remarketing_counter_goal_update`
- `vk_ads_remarketing_in_app_event_update`
- `vk_ads_skad_network_ids_transfer`
- `vk_ads_ord_user_update`
