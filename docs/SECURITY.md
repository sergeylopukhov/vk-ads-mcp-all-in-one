# Security

## Secret Policy

- Never place access tokens, PII or production response bodies in source, tests, docs, logs or MCP client configuration.
- The server reads the personal VK Ads token from the local `.env` file beside `package.json`.
- Keep `.env` out of screenshots, archives and version control. The repository ignore rules cover it.

## Profile And Network Boundaries

- Profile and connection ID are fixed at process startup and cannot be supplied by a tool call.
- The VK Ads client uses a fixed official base URL and path allowlists.
- Advertising destinations must be public HTTPS domains without embedded credentials, IP addresses or localhost.

## Mutation Controls

- Startup is read-only unless `VK_ADS_MODE=write` is explicit.
- Every registered write needs preflight, a short-lived preview and an exact one-time user confirmation.
- Existing production objects are not a valid test target. Test operations require `__MCP_TEST__` naming and, where configured, explicit ID allowlists.
- PII uploads, agency writes, sharing-key revocation, SKAdNetwork writes, in-app event category writes and counter writes use separate opt-ins.

## File Upload Controls

- Files must resolve under an approved local upload root and be regular files.
- Image, MP4 and HTML5 ZIP content is checked for signature, size and structural constraints before preview.
- Remarketing user lists use a separate PII root and are validated without returning or logging contact content.

## Incident Handling

If a credential leaks, revoke it in VK first. Do not paste it into an issue or chat. Report security issues using the public contact in the repository-level `SECURITY.md`.
