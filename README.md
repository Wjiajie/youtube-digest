# Blueprint

Blueprint is an Agent-assisted personal goal system. Version 3 is being built as a Next.js Web app plus a focused YouTube extension, backed by one Supabase identity and one structured Blueprint.

[简体中文](README.zh-CN.md)

## M1 cloud slice

The current source implements the M1 foundation:

- a generic `Blueprint → Goal → Stage → Path Node` model with learn, practice, checkpoint, and reflection nodes;
- user-reviewed proposals with optimistic version checks and atomic application;
- invite-only email magic-link login and Supabase Row Level Security;
- a minimal Web editor and an OAuth 2.1/PKCE extension authorization flow;
- an explicit YouTube learning-session writeback with owner-scoped offline recovery;
- privacy-minimized product events and optional Sentry error reporting;
- shared domain contracts and semantic UI tokens across Web and extension.

The former local Chrome extension and Windows Native Agent Host are preserved in Git tag `v2.0.0`; they are no longer part of the current runtime.

## Repository

```text
apps/web          Next.js App Router application
apps/extension    WXT Manifest V3 extension
packages/domain   framework-independent domain and application contracts
packages/ui       shared semantic tokens and small UI primitives
supabase          schema, RPCs, RLS policies, and pgTAP tests
docs              product, architecture, UX, ADRs, and the living roadmap
```

## Local development

Requirements: Node.js 22+, npm, and Docker for the full local Supabase stack.

```bash
npm install
cp apps/web/.env.example apps/web/.env.local
cp apps/extension/.env.example apps/extension/.env.local
npm run supabase:start
npm run supabase:reset
npm run dev:web
npm run dev:extension
```

The extension keeps the published ID `kipaapemlimhdkpcenelpjeccmnkninf`. Register that public OAuth client in Supabase before testing authorization. See [M1 cloud setup](docs/m1-cloud-setup.md).

For the complete local-to-hosted setup and acceptance journey, run the repeatable interactive wizard:

```bash
npm run setup:m1-cloud
```

## Verification

```bash
npm run check:m1
npm run check:m1-wizard
npm run test:e2e
npm run supabase:test
```

`check:m1` runs type checks, domain/extension tests, an embedded PostgreSQL migration contract, both production builds, and an extension security-surface check. `supabase:test` requires the local Supabase stack and is the final RLS integration gate.

## Documentation

- [Product vision](docs/product-vision.md)
- [Current architecture](docs/architecture.md)
- [Current UI/UX](docs/ui-ux-design.md)
- [Target UI/UX plan](docs/target-ui-ux-plan.md)
- [Multi-stage execution roadmap](docs/execution-roadmap.md)
- [M1 cloud setup](docs/m1-cloud-setup.md)
- [Privacy](PRIVACY.md) and [security](SECURITY.md)

M1 intentionally does not include the Agent Skills pipeline, final 3D identity dashboard, transcript learning workspace, video recommendation, or review loop. Those remain M2–M5 work in the roadmap.
