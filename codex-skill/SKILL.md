---
name: vk-ads-mcp
description: Use the installed VK Ads MCP to inspect, analyze, and explicitly change VK advertising, and to research public VK communities. Activate for requests about VK Ads accounts, campaigns, ad groups, ads, creatives, audiences, statistics, forecasts, leads, surveys, price lists, token recovery, or VK community discovery and analysis.
---

# VK Ads MCP

Use only public tools exposed by the installed `vk-ads` server. Do not invent
tool names, provider fields, object IDs, or results.

## Core procedure

1. For the first advertising operation, call `vk_ads_connection_check`.
   Skip it for community-only work because those tools use a separate Core VK
   token.
2. Infer safe missing parameters from read tools and the conversation. Ask only
   when a value cannot be inferred reliably or changes the user's decision.
3. For analysis, establish the object hierarchy and reporting period before
   interpreting metrics. Prefer complete periods and disclose partial data.
4. Call write tools only when the user explicitly requests that exact change.
   A write call executes immediately; there is no preview layer.
5. Before a write, read the target and verify its ID, status, and parent. Use
   one narrow write call, then reread the result when supported.
6. Never expose tokens, client secrets, identifier-file contents, lead
   contacts, respondent answers, or raw private provider payloads.
7. Respond in Russian unless the user requests another language.

## Live status

Treat the installed release's `docs/tools.md` as the status authority.

- A `✅` tool may be used normally within the rules above.
- A `⛔️` read tool may be attempted when useful, but disclose its status before
  use and report the result without describing the tool as available.
- Do not use a `⛔️` write tool as a routine solution. The OAuth recovery
  exceptions below still require an explicit user request. Do not use other
  `⛔️` write tools.
- Never treat an expected failure, empty mutation, or `remoderated=false` as
  success.

See [references/tool-routing.md](references/tool-routing.md) for exact tool
routes and the current `⛔️` set. Read only the relevant section.

## Workflows

Read [references/workflows.md](references/workflows.md) when the task involves
account diagnostics, performance analysis, campaign management, community
token recovery, audiences, leads or surveys, or cleanup.

For community discovery or advertising-audience research, read
[references/community-research.md](references/community-research.md) before
asking missing questions or calling a community tool.
For a community-only task, do not also read `references/workflows.md`; read
only the community section of `references/tool-routing.md` when tool routing is
needed.
For this workflow, do not activate or open an available questionnaire merely
because many questions remain. Always offer the response-method choice first
and wait for the user's explicit selection.
If the questionnaire skill is unavailable, the second option must explicitly
say that it will install the skill. Do not offer to open or use a questionnaire
that is not installed.
Before every community tool call, omit custom `scoring_rules.weights` unless
they materially improve the search. If weights are present, the same payload
must include attainable `min_score` and `review_min_score` values. Preserve
qualifiers in multiword exclusions; never broaden "оптовый поставщик" to the
generic term "поставщик". For a small foreground search, set the tool's
result `limit` to the number of final candidates the user requested; use the
separate search budget to inspect a wider candidate pool.
After every community search, state the active recommendation and review
thresholds. If the result contains fewer suitable candidates than requested,
do not stop at "nothing found": explain the limiting stage and offer score
adjustment, search expansion, query refinement, or an explicit filter change.
Never lower thresholds or relax exclusions without the user's choice.

For analytical work, also read
[references/reporting.md](references/reporting.md) and produce a detailed
report by default.

## Authentication recovery

- Normal expiry and the first provider HTTP `401` are handled automatically.
- On an explicit refresh request, call `vk_ads_oauth_token_refresh` and state
  that its current release status is `⛔️`.
- If the pair was revoked or replaced elsewhere, explain that
  `vk_ads_oauth_current_tokens_delete` revokes every token for the configured
  VK Ads account. Call it only after explicit consent using
  `DELETE_ALL_CURRENT_VK_ADS_TOKENS`, then run
  `vk_ads_connection_check`.
