# Architecture Overview

## Stack

- Language: TypeScript with ESM modules.
- Runtime: Node.js 20 or newer.
- MCP SDK: `@modelcontextprotocol/sdk` over stdio.
- Validation: Zod.
- Build: TypeScript compiler via `npm run build`.
- Persistence: no application database. Credentials are held outside the repository in a platform keychain or encrypted local file.

## Repository Layout

- `src/index.ts`: process composition and stdio server startup.
- `src/server.ts`: MCP tool registration, read aliases, write previews and execution wiring.
- `src/vk-client.ts`: fixed-host VK Ads HTTP client, endpoint allowlists and response handling.
- `src/config.ts`: environment parsing, profile isolation and credential refresh setup.
- `src/vk-ads-oauth.ts`: local callback OAuth flow for VK Ads.
- `src/secret-store.ts`: macOS Keychain and AES-256-GCM encrypted-file storage.
- `src/write-gate.ts`, `src/write-preflight.ts`, `src/banner-preflight.ts`: explicit write confirmation and local validation.
- `src/upload-policy.ts` and `src/destination-policy.ts`: upload-root, media-format and advertising-destination constraints.
- `src/analytics.ts` and `src/export.ts`: local analysis and in-memory CSV/XLSX generation.
- `src/tool-catalog.ts`: searchable capability catalog; it distinguishes implemented tools from planned ones.
- `README.md` and `readme/`: public installation and client-connection documentation.

## Runtime Shape

1. `index.ts` loads a fixed local profile and starts one MCP server over stdio.
2. Configuration constructs secret storage, optional OAuth helpers, a one-request-per-second rate limiter and the VK Ads client.
3. `createServer()` registers read-only tools unconditionally and write tools only when `VK_ADS_MODE=write`.
4. MCP calls pass through schemas and allowlisted client methods; the caller cannot provide an arbitrary API host or raw request path.
5. Writes require preflight, a short-lived preview, an exact one-time confirmation and a result re-read where the operation supports it.

## System Boundaries

### In Scope

- Local access to VK Ads API resources through MCP tools.
- Local analytics, validation and export transforms.
- Isolated profiles for separate advertising accounts.

### Out Of Scope

- A hosted HTTP service, shared multi-user backend or central credential store.
- Persistence of campaign data, reports or uploaded files by the MCP server.
- Circumventing VK permissions, API limits, campaign moderation or undocumented contracts.
- Storing real tokens, secrets, PII or production API responses in the repository.
