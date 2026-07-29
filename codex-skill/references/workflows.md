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
4. Add goal, in-app, or offline statistics only when relevant.
5. Check structural context: status, parent, budget settings, and active ads.
6. Compare periods and objects using actual returned metrics. Do not invent
   attribution, revenue, or missing denominators.
7. Return the detailed report described in `reporting.md`.

## Campaign management

1. Run the connection check and resolve the current hierarchy.
2. Infer safe IDs from an exact unique match; otherwise ask the user.
3. Read the target immediately before changing it.
4. Verify the requested operation, payload scope, status, and parent links.
5. Call one narrow create, update, delete, or mass-action tool.
6. Reread the object or collection and compare requested fields.
7. Report confirmed, partially confirmed, or failed outcomes truthfully.

For mass actions, enumerate the resolved targets before execution. Do not widen
phrases such as "these campaigns" beyond the visible selection.

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
   `vk_ads_oauth_token_refresh`, disclose its `⛔️` status, then run
   `vk_ads_connection_check`.
4. If refresh fails because the pair was revoked or replaced elsewhere, explain
   that the reset affects every token for the configured account.
5. After explicit consent, call `vk_ads_oauth_current_tokens_delete` with
   `DELETE_ALL_CURRENT_VK_ADS_TOKENS`.
6. Run `vk_ads_connection_check` after reauthentication.
7. Never print, request in chat, or copy token values.

## Audience work

1. Identify whether the source is a counter, offline list, uploaded user list,
   composed segment, or shared source.
2. Read existing objects and their relations before creating or changing data.
3. Prefer existing verified list and segment tools.
4. Treat current counter-goal write tools as unverified and do not use them as
   routine operations.
5. After a write, reread the object, relations, or collection and verify exact
   requested fields.
6. Never expose uploaded identifiers or source credentials.

## Leads and surveys

1. Resolve the exact form or survey and inspect its current status.
2. Return only sanitized metadata through MCP.
3. Create, update, copy, archive, or restore only on explicit request.
4. Treat local CSV/XLSX export as a write: require explicit intent and never
   overwrite an existing file.
5. Do not expose contacts or respondent answers in chat.
6. Reread statuses after archive or restore operations.

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
