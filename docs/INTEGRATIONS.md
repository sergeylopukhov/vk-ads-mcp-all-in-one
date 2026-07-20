# Integrations

## VK Ads API

- Primary base URL: `https://ads.vk.com/api/v2`.
- The client also has narrowly allowlisted methods for documented v1 and v3 resources where the product requires them.
- Every endpoint is represented by a fixed method in `src/vk-client.ts`; there is no generic HTTP pass-through.
- The user credential and provider role ultimately decide which resources are visible or writable.
- Provider contracts can evolve. Add a new operation only after official documentation or an isolated safe verification confirms its path, schema and permissions.

## VK Ads Authentication

- The server accepts only a personal VK Ads access token.
- OAuth, application credentials and browser callbacks are intentionally not part of the project.
- The personal access token is stored only in the local `.env` file beside `package.json`.

## Local Token File

- Copy `.env.example` to `.env` and enter the token after `VK_ADS_TOKEN=`.
- The same workflow works on macOS, Windows and Linux.
- `.env` stays local and is ignored by Git.

## MCP Clients

The public README documents supported local stdio clients. Each client must start the local Node.js process with an absolute path to `dist/index.js`; no client configuration should contain an access token.
