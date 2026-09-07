# Blueprint Security

## Supported source

Security fixes target the latest code on `main`. The local 2.0 runtime is historical and preserved at tag `v2.0.0`; the Windows Native Agent Host is retired.

## Trust boundaries

```text
Next.js Web ───────┐
                   ├─ Supabase Auth + PostgreSQL + RLS
WXT extension ─────┘
```

- The Web session may read the user's Blueprint, create/reject proposals, and invoke the atomic proposal-application function.
- The extension uses a separately revocable public OAuth client. It can read the owner's Blueprint and write learning sessions/product events, but RLS denies proposal and formal Blueprint writes.
- Formal Blueprint tables are directly read-only to authenticated clients. A security-definer RPC verifies the authenticated owner, rejects the extension client, locks the current version, applies one complete proposal, and records a revision in one transaction.
- Owner IDs are present in composite foreign keys and RLS policies. A learning resource must belong to the same owner and Path Node as its session.

## Secrets and OAuth

- The Supabase service-role key exists only in the Web server environment and invite endpoint.
- The extension contains only public configuration and never contains service-role, DeepSeek, YouTube, or Supadata secrets.
- Extension authorization uses the OAuth 2.1 authorization-code flow with PKCE and a random state value. The stable manifest key preserves extension ID `kipaapemlimhdkpcenelpjeccmnkninf` and therefore its callback origin.
- Refresh and access tokens remain in extension background storage; content scripts are not part of M1.

## Data and failure controls

- Domain validation bounds hierarchy sizes, enforces stable unique UUIDs, accepts only canonical YouTube watch URLs, and rejects cross-Goal, self, duplicate, or cyclic dependencies.
- Proposal creation and learning-session writeback use client mutation IDs for idempotency.
- Failed extension writebacks remain in an account-scoped outbox and are retried only for the currently signed-in owner.
- Sentry is disabled without a DSN and strips request and user content when enabled.
- Product events use an enum and contain no free-form content fields beyond a bounded operational result code.

## Verification

Run `npm run check:m1`, `npm run test:e2e`, and `npm run supabase:test`. The first command also inspects the built extension permissions and fails if service credentials, DeepSeek transport, or Supadata transport appear in client output.

## Report a vulnerability

Do not publish credentials, private Blueprint content, OAuth tokens, or an exploitable proof in a public issue. Contact the repository maintainer privately with the affected commit, reproduction steps, impact, and the smallest safe evidence. Useful reports include RLS bypasses, cross-user access, proposal-confirmation bypasses, OAuth callback/state issues, secret leakage, unsafe recovery queues, and excessive browser permissions.
