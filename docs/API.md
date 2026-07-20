# MCP API

## Transport And Discovery

- Transport: standard input/output only; there is no public HTTP endpoint.
- The server name and version are defined in `src/server.ts`.
- Start with `get_provider_context` to confirm profile, mode and provider base URL.
- Use `search_tools` to discover capabilities. A catalog entry with `implemented: false` is not executable.
- Read-only tools can also be reached through `call_read_tool`; direct `vk_*` aliases use the same allowlisted implementation.

## Read Contracts

Read tools validate IDs, pagination, date ranges, fields and enumerated values before calling VK. They use fixed paths in `VkAdsClient`; a tool never accepts a raw API host, arbitrary path or arbitrary request body.

The public surface is grouped around:

- account and throttling status;
- ad plans, campaigns, ad groups, banners and registered URLs;
- media patterns and field definitions;
- statistics, goal statistics, analytical ranking, period comparison and delivery diagnostics;
- remarketing, segments, counters, lists, local geos and supported mobile-app assets;
- reports, exports, lead forms, agency and ORD metadata;
- provider catalogs such as packages, placements, targeting and regions.

The exact executable inventory is the runtime result of `search_tools`, not this document.

## Write Contracts

- Write tools are registered only in write mode.
- The caller must obtain a preview through `write_preview` or a named write-preview alias.
- `write_execute` requires the preview ID and its exact generated confirmation statement.
- Previews expire after ten minutes, are bound to one connection ID and cannot be reused.
- Test-object naming and any required ID allowlist are validated again before the provider request.

Do not document or expose a generic request proxy. Adding a provider operation means adding a dedicated schema, a fixed client method, preflight rules, an explicit write classification and verification.

## Compatibility Rules

- Preserve stdio transport and named MCP tool compatibility unless a documented breaking release is intended.
- Keep read-only as the startup default.
- Keep the API base host fixed to the approved VK Ads endpoints.
- Treat status `403`, `404` and `405` as provider capability state where the tool explicitly models that outcome; do not infer unavailable contracts from unrelated failures.
- Keep sensitive fields, tokens, refresh tokens, client secrets, PII and untrusted local paths out of MCP responses.
