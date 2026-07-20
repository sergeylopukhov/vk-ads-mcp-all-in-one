# Architecture Map

This is a routing map, not the complete project record. Read it before changes to runtime behavior, MCP interfaces, security controls, configuration, integrations, release procedures, tests, or documentation ownership.

## Project Profile

- Profile: local TypeScript MCP package and automation service.
- Runtime: Node.js 20+ with MCP stdio transport.
- Primary external provider: VK Ads API.
- Agent target: Codex through the repository root `AGENTS.md`.
- Code-rules mode: use `docs/code_rules.md`.
- Documentation maintenance: automatic durable maintenance.

## Core Documents

- [Architecture Overview](architecture-overview.md): stack, folders, runtime boundaries, entry points.
- [Backend And Runtime](architecture-backend-data.md): process composition, state, access controls, write pipeline.
- [Quality And Risks](architecture-quality-risks.md): verification commands, known limitations, volatile areas.

## Interface And Operations Documents

- [MCP API](API.md): transport, tool discovery, input and write contracts.
- [Integrations](INTEGRATIONS.md): VK Ads, OAuth and secret-storage boundaries.
- [Security](SECURITY.md): credential, write, destination and upload controls.
- [Operations](DEPLOYMENT.md): local build, client connection and release boundaries.
- [Code Rules](code_rules.md): required rules before code and code-adjacent edits.

## Ownership Rules

- Keep architecture facts in the most specific architecture document.
- Put public MCP behavior and compatibility constraints in `API.md`.
- Put provider-specific contracts and credential flows in `INTEGRATIONS.md`.
- Put secret handling and permission boundaries in `SECURITY.md`.
- Put commands, environment setup and release workflow in `DEPLOYMENT.md`.
- Do not duplicate durable facts. Link to the owner document instead.
- Mark an unknown durable fact as `TODO: clarify`; do not infer it from an API error or a UI observation.

## Local-Only Policy

`docs/` and `.project-questionnaire/` are local project memory and are ignored by Git. Do not commit, push, upload or publish them unless the user explicitly requests it.

## Update Rule

Under automatic durable maintenance, update the matching document in the same task only when a completed change affects architecture, API, integration contracts, security, setup, release operations, test policy or documentation ownership. Routine implementation notes do not belong here.
