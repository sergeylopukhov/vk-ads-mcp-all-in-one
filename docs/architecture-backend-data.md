# Backend, Runtime And State

## Process Composition

`src/index.ts` creates one process-local dependency graph:

- `AppConfig` fixes the profile, connection identifier, timeout, mode and opt-in switches at startup.
- `VkAdsClient` uses the selected token provider and endpoint allowlists.
- `TokenRateLimiter` serializes requests for the local credential at a minimum one-second interval.
- `VkAdsOAuth` is the optional local OAuth helper for VK Ads.
- `createServer()` receives these dependencies and exposes the MCP surface.

The MCP request cannot switch profile, credential, API host or local upload root. Start another server process for another profile.

## State Model

### External Provider Entities

The main VK Ads hierarchy is `ad_plans → ad_groups → banners`. The server also reads or safely operates on campaigns, URLs, statistics, remarketing assets, segments, lead forms, reports, packages, agency data and supported mobile-app entities.

### Local State

- Secret storage contains tokens and client credentials outside the repository.
- OAuth pending state, write previews, write audit metadata and uploaded-file metadata live only in the current process.
- A preview expires after ten minutes and is single-use.
- CSV and XLSX exports are generated in memory; they are not written to the project directory.

## Read Pipeline

1. A public tool or `call_read_tool` validates its schema.
2. `server.ts` maps the request to a fixed `VkAdsClient` method.
3. The rate limiter schedules the provider request.
4. Sensitive metadata is filtered before it is returned by tools that need it.

`search_tools` should be used before an unknown capability. It returns only implemented capabilities unless the caller explicitly includes planned entries.

## Write Pipeline

1. Write tools are absent unless the process starts with `VK_ADS_MODE=write`.
2. A specific preflight validates local fields and, where required, current provider state.
3. A write preview stores an immutable canonical payload hash, operation, connection ID, expiry and required confirmation phrase.
4. `write_execute` consumes the preview only when the exact confirmation is supplied from the same connection.
5. The server records non-sensitive audit metadata and performs a supported re-read.

Most mutations are restricted to explicitly named `__MCP_TEST__` objects. Additional high-impact categories need dedicated environment opt-ins and test-ID allowlists.

## Data Handling

- Do not add a database or cache without an explicit product requirement.
- Treat provider responses as untrusted input; expose only typed, validated and intentionally filtered fields.
- PII remarketing files require a separate directory and explicit opt-in; their content is not returned or logged.
