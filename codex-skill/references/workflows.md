# Workflows

## Account diagnostics

1. Run `vk_ads_connection_check`.
2. Read `vk_ads_user_profile_get` only when account settings matter.
3. Read `vk_ads_throttling_get` when rate limits may explain failures.
4. List the relevant campaigns, groups, ads, audiences, or forms.
5. Separate provider state, configuration problems, missing objects, and
   unverified-tool limitations.
6. Do not change anything unless the user explicitly asks.

## Performance analysis

1. Resolve the requested account, campaign, group, or ad IDs.
2. Establish the timezone, requested range, comparison range, and whether the
   latest period is complete.
3. Use `vk_ads_statistics_day_list` for daily trends and
   `vk_ads_statistics_v2_get` for the required daily or aggregate view.
4. For impressions, clicks, spend, CTR, CPC, CPM, goals, CPA, and CR, omit the
   metric selector or pass `fields=["base"]` / `metrics=["base"]`. These
   parameters name metric sets; never pass result fields such as `shows`,
   `impressions`, or `views` as metric sets.
5. Add goal, in-app, or offline statistics only when relevant.
6. Check structural context: status, parent, budget settings, and active ads.
7. Compare periods and objects using actual returned metrics. Do not invent
   attribution, revenue, or missing denominators.
8. Return the detailed report described in `reporting.md`.

## Campaign management

1. Run the connection check and resolve the current hierarchy.
2. Infer safe IDs from an exact unique match; otherwise ask the user.
3. Call `vk_ads_action_prepare` with the exact action and planned input.
4. Read `missingFields`, `incompatibleFields`, `warnings`,
   `allowedValues`, `suggestedPatch`, and `requiresConfirmation`.
5. Resolve blocking conditions. Ask separately before applying a suggested
   change to a parent or related object.
6. When `ready=true`, call one narrow create, update, delete, or mass-action
   tool with the same input.
7. Reread the object or collection and compare requested fields.
8. Report confirmed, partially confirmed, or failed outcomes truthfully.

For mass actions, enumerate the resolved targets before execution. Do not widen
phrases such as "these campaigns" beyond the visible selection.

## Provider validation failures

1. Read the normalized provider code, message, and field paths returned by MCP.
2. Attribute the failure only to fields named by VK. Do not infer that a
   creative, URL, group, package, or limit is faulty without matching provider
   evidence.
3. Do not repeat the same write or cycle through alternative creatives after a
   rejected request.
4. If VK omits field details, read the exact group and take its `packageId`.
   Call `vk_ads_ad_reference_list` with `resource=packages` and
   `ids=[packageId]`, then inspect `options.settings` and the `pads` entry in
   `options.targetings`, including its defaults, values, and pattern groups.
   Do not search for the package only in the unfiltered collection because VK
   can omit packages that remain assigned to existing groups.
5. Inspect the applicable banner pattern and placement references only after
   the exact package contract is known.
6. Retry only after changing the identified invalid field. For an earlier
   ambiguous write, first reread provider state to exclude a duplicate.

## Community research

1. Read `community-research.md`, collect the missing brief in chat or through
   the optional questionnaire flow, and prepare the domain-neutral search
   configuration.
2. For a small bounded request, prefer `vk_find_community_candidates`.
3. For broad research, start `vk_start_community_research`, then poll
   `vk_get_community_research_progress` and read the final snapshot with
   `vk_get_community_research_run`.
4. Use discovery, analysis, and scoring tools separately when the user needs
   control over an intermediate stage.
5. Use `vk_rescore_community_research_run` when weights, clusters, or a subset
   of the already analyzed terms changes. A new term requires another provider
   analysis and is reported as incomplete without it.
6. Rank candidates, explain reasons and risks, group them into useful clusters,
   and propose next actions.
7. Do not export by default. Prepare export only when requested.

All community tools carry `✅`.

## Token recovery

1. If ordinary reads work, do nothing.
2. On an expired token or first HTTP `401`, allow the server's automatic refresh.
3. If the user explicitly asks for a refresh, call
   `vk_ads_action_prepare` with `oauth.tokens_refresh` and the exact
   confirmation, then call `vk_ads_oauth_token_refresh` and run
   `vk_ads_connection_check`.
4. If refresh fails because the pair was revoked or replaced elsewhere, explain
   that the reset affects every token for the configured account.
5. After explicit consent, prepare `oauth.tokens_delete`, then call
   `vk_ads_oauth_current_tokens_delete` with
   `DELETE_ALL_CURRENT_VK_ADS_TOKENS`.
6. Run `vk_ads_connection_check` after reauthentication.
7. Never print, request in chat, or copy token values.

## Audience work

1. Identify whether the source is a counter, offline list, uploaded user list,
   VK community, composed segment, or shared source.
2. Read existing objects and their relations before creating or changing data.
3. For VK community subscribers, call `vk_ads_vk_groups_list`, then import
   missing numeric IDs, shortnames, or VK links with
   `vk_ads_vk_groups_import`. Pass the returned `objectId` values to
   `vk_ads_vk_community_audience_create`. Use
   `excludeCommunityObjectIds` for community exclusions and
   `excludeSegmentIds` for earlier audiences. Do not use the registry `id`,
   a URL ID, or `remarketing_group`; the latter is for Odnoklassniki groups.
4. Read logical VK-community audiences through
   `vk_ads_vk_community_audiences_list` and
   `vk_ads_vk_community_audience_get`. Rename or replace sources through
   `vk_ads_vk_community_audience_update`, and delete the complete logical
   audience through `vk_ads_vk_community_audience_delete`.
5. Keep `vk_ads_segment_create`, `vk_ads_segment_update`, and
   `vk_ads_segment_delete` for low-level API v2 segments only.
6. Treat current counter-goal write tools as unverified and do not use them as
   routine operations.
7. Prepare the exact audience action before a write. Do not submit source
   credentials, file contents, or sharing keys in chat.
8. After a write, reread the object, relations, or collection and verify exact
   requested fields.
9. Never expose uploaded identifiers or source credentials.

## Leads and surveys

1. Resolve the exact form or survey and inspect its current status.
2. Return only sanitized metadata through MCP.
3. Prepare the exact create, update, copy, archive, restore, test-lead, or
   export action before writing.
4. Treat local CSV/XLSX export as a write: require explicit intent and never
   overwrite an existing file.
5. Do not expose contacts or respondent answers in chat.
6. Reread statuses after archive or restore operations.

## Price lists and account settings

1. Prepare the exact price-list, local-geo, URL, mobile-app, language, ОРД, or
   SKAdNetwork action before writing.
2. For a price list, choose one source branch and provide only its required
   fields. Keep marketplace credentials out of chat.
3. Treat batch item IDs as unique and wait for the provider task to finish
   before reporting success.
4. Require the exact confirmation literal for OAuth and ОРД operations.
5. Keep ОРД personal values and SKAdNetwork recipients out of reports.

## Safe cleanup

1. Clarify the object class and scope if it is not exact.
2. List and reread every candidate immediately before cleanup.
3. Exclude objects outside the user's explicit selection.
4. Prefer provider archive/status transitions where that is the supported
   lifecycle; otherwise use the narrow delete tool.
5. For mass cleanup, show the resolved target count and IDs before execution if
   ambiguity remains.
6. Confirm deletion, archive status, or absence with a separate read.
7. Never claim cleanup succeeded when the provider reports a no-op or the
   reread is inconclusive.
