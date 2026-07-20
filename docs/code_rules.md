# Code Rules

Read this file before changing code, tests, scripts, build configuration, provider contracts or MCP behavior.

## Intent And Scope

- Discussion and analysis do not authorize repository edits or provider writes.
- Make the smallest change that satisfies the explicit request.
- Do not refactor unrelated code, alter existing campaign data or widen a provider permission boundary as incidental cleanup.

## Context Before Change

- Read `docs/architecture.md` and the relevant owner document first.
- Use `search_tools`, existing schemas and `VkAdsClient` allowlists rather than inventing tool names, paths, fields or IDs.
- Treat unknown provider behavior as `TODO: clarify` or a planned capability until it is confirmed.
- Do not read or print local secret files unless the task explicitly requires a safe credential-status check.

## VK Ads Safety Rules

- Preserve `readonly` as the default mode.
- New writes must have input validation, preflight, preview, exact one-time confirmation, post-write verification and test-object isolation where applicable.
- Never use an existing production campaign, group, banner, audience, counter or budget as a write test target.
- Keep API hosts and paths fixed in code; do not introduce generic raw-request tools.
- Keep uploads inside configured roots and preserve content validation before provider calls.

## Verification

- For code changes, run the smallest relevant check and `npm run build` when the shipped TypeScript surface changes.
- For provider behavior, use read-only checks first. A write check requires explicit user permission and a disposable `__MCP_TEST__` scenario.
- Report checks run, their outcome and anything not verified.

## Durable Documentation

Documentation maintenance is automatic only for durable changes. Update the most specific local `docs/` owner file when architecture, API, security, setup, integration contracts, testing policy or operations change. Do not record transient task progress.

## Finish

State changed files, verification evidence and remaining provider-contract uncertainty. Never include secrets or raw PII in the final response.
