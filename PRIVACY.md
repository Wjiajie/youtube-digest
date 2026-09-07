# Blueprint Privacy

Last updated: August 27, 2026

Blueprint 3 uses a Web application, a YouTube browser extension, and Supabase. This document describes the current M1 source; the historical local-only version remains available at Git tag `v2.0.0`.

## Data handled

The cloud database can contain account identity, Blueprint titles and descriptions, Goals, Stages, Path Nodes, optional YouTube resource bindings, user-confirmed proposal snapshots and diffs, revisions, and explicit learning-session starts.

The extension stores its own OAuth session, an account-keyed Blueprint cache, and account-keyed pending learning-session commands for short-term recovery. It does not store service-role credentials. The new version does not import historical Chrome data.

## Service boundaries

- Supabase provides email OTP authentication, OAuth authorization for the extension, PostgreSQL storage, and Row Level Security.
- Vercel is the planned Web hosting environment.
- Sentry is optional. When configured, Blueprint strips request bodies, query strings, headers, cookies, email, IP, custom context, and extra fields before sending errors.
- Product events contain an allowlisted event name, surface, optional entity ID, bounded result code, duration bucket, and timestamp. They do not contain Goal text, proposal content, transcripts, or notes.

M1 does not call DeepSeek, YouTube Data API, or Supadata. Later stages must update this notice before introducing those processors.

## Browser permissions

- `identity`: run the OAuth 2.1 authorization-code flow with PKCE.
- `storage`: keep the extension session, account-scoped cache, and pending writeback queue.
- `sidePanel`: display the Blueprint learning companion beside YouTube.
- `tabs`: identify the current YouTube video, navigate to a bound video, and open the Web app.
- YouTube host access: match the current watch URL to a resource binding.
- Web and Supabase host access: read the Blueprint, write an explicit learning session, and exchange OAuth tokens.

## User control

Blueprint changes do not enter the formal Blueprint until the user applies a proposal. Starting a learning session also requires an explicit click. Signing out removes the active extension session; the Web connection page can revoke an OAuth grant. Data export and account deletion are planned before public registration and are not yet implemented in M1.

Blueprint does not sell personal information, run advertising, or build advertising profiles.
