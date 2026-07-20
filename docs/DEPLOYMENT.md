# Local Operations

## Runtime Model

This package is a local stdio MCP server. It is installed and started on the same machine that owns the local credential store. It does not expose a hosted HTTP service.

## Requirements And Build

- Node.js 20 or newer.
- Install dependencies with `npm ci`.
- Build distributable JavaScript with `npm run build`.
- Start directly with `node dist/index.js`, normally through an MCP client configuration.

## Configuration

- Select an account namespace with `VK_ADS_PROFILE`; the default is `default`.
- Keep `VK_ADS_MODE=readonly` unless an isolated test write is intentional.
- Persist the personal VK Ads token through the supported local secret store, never through repository files or committed client configuration.
- Use an absolute path for `VK_ADS_UPLOAD_DIR` before any media upload capability is available.

## Client Connection

Public client-specific instructions live in `README.md` and `readme/setup-clients.md`. They are the source of truth for user-facing installation text. Internal docs should not duplicate those step-by-step commands.

## Release Boundary

- The npm package is marked private; npm publishing is not configured.
- GitHub release packaging and automated CI are not defined in the current `package.json`.
- Before a release, at minimum run a clean install and `npm run build`, then verify a read-only MCP connection using a non-destructive request.
- TODO: clarify the maintained release artifact and version-bump procedure before automating publication.

## Recovery

- For a failed local build, remove only generated `dist/`, reinstall dependencies and rebuild.
- For a credential problem, repair or rotate the provider credential in its local secret store; do not place a replacement in the repository.
- For an unintended write attempt, inspect the process-local write audit while the server is running and re-read the affected provider object before any further action.
