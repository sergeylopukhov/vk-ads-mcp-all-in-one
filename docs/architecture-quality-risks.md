# Quality And Risks

## Verification

- `npm ci`: reproducible dependency installation.
- `npm run build`: typechecks and compiles the shipped TypeScript surface.
- `git diff --check`: whitespace validation for documentation-only changes.
- A live provider smoke check must be read-only unless the user explicitly authorizes an isolated `__MCP_TEST__` scenario.

The public package currently exposes a build script only. Do not claim that `npm test`, `npm run typecheck` or API-documentation checks exist unless the scripts are added to `package.json`.

## Known Risks

- VK Ads endpoint contracts and permissions vary by account, role and provider release. Represent unverified operations as planned, not executable.
- Rate limiting is process-local. Separate server processes using the same credential do not share the in-memory one-request-per-second queue.
- OAuth depends on a correctly configured user-owned VK application and an available loopback port.
- Provider `403`, `404` and `405` may mean missing permission or unavailable capability, not necessarily a malformed MCP request.
- In-memory write previews and audit metadata disappear when the process exits.
- Media checks prevent known local format errors, but final eligibility and moderation remain VK decisions.

## Current Scope Limits

- Remarketing counter tools support safe reading of counters and goals. Mutating counter operations are limited to explicitly allowlisted test counters with separate opt-in.
- Do not describe pixel creation, production counter mutation or live event-delivery diagnostics as supported until their provider contracts are confirmed and implemented.

## Change Checklist

When adding or changing a tool:

1. Confirm the provider contract from official documentation or a safe isolated verification.
2. Add fixed input/output schemas and client allowlist coverage.
3. Add local validation and a narrow preflight for writes.
4. Preserve read-only startup and exact confirmation flow.
5. Verify the focused behavior and update the matching durable document.
