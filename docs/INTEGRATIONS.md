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
- The personal access token is persisted only through the selected local secret store.

## Local Credential Storage

- macOS defaults to Keychain.
- Windows and Linux require the encrypted-file mode for persistent storage.
- The encrypted store uses AES-256-GCM with an scrypt-derived key and is written atomically with restrictive file permissions.
- A profile prefixes stored credential keys, so credentials are not selected by arbitrary MCP input.

## MCP Clients

The public README documents supported local stdio clients. Each client must start the local Node.js process with an absolute path to `dist/index.js`; no client configuration should contain an access token or secret-store passphrase.
