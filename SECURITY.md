# Blueprint Security

## Supported version

Security fixes target the latest code on `main` and the latest published release when releases exist. Older snapshots are not supported.

## Trust boundaries

Blueprint has two local components separated by Chrome Native Messaging:

1. The Chrome extension owns user interaction, Chrome local extension storage, the Blueprint document, and direct Supadata transcript calls.
2. The local Blueprint Agent Host owns Pi Agent execution and DeepSeek transport. It accepts a versioned, length-framed JSON protocol only from the exact extension origin registered in its native-host manifest.

The extension has no direct LLM provider transport. The host keeps the DeepSeek key in session memory, redacts key-shaped values from errors, writes protocol frames only to stdout, and sends operational diagnostics to stderr. Closing the native session or process clears its in-memory session map.

## Agent controls

- Five explicit capabilities are allowlisted; unknown capabilities fail closed.
- Learning capabilities receive no Agent tools.
- The planner receives only `read_blueprint` and `propose_blueprint_revision`.
- Proposals do not write extension storage. The extension validates the complete Markdown and requires user confirmation before applying it.
- Input sizes, node counts, link origins, protocol frame sizes, event order, idle time, and hard execution time are bounded.
- Requests can be cancelled. Timeouts and disconnects return structured, retryable errors without silently repeating a completed external call.
- The Agent has no shell, file, browser-control, arbitrary HTTP, secret-reading, or extension-storage tool.

## Installation integrity

The host packager performs a clean lockfile install, downloads the pinned Node.js runtime over HTTPS, verifies its hard-coded upstream SHA-256, and writes the runtime version, archive hash, lockfile hash, and fixed extension ID to `BUILD-PROVENANCE.json`. The Windows package includes `SHA256SUMS` for the executable, installer, uninstaller, example manifest, and provenance record. `install.ps1` refuses to install when the executable does not match that checksum and always registers the one published extension ID.

These local development artifacts are not Authenticode-signed. The co-located checksum detects accidental corruption and tampering after package creation, but it does not establish publisher identity if the entire package is replaced. Obtain releases from a trusted channel, compare an independently published checksum when one exists, and run `install.ps1` only from a release you trust. Installation is per user and registers `com.blueprint.agent` under the Chrome native messaging registry key. `uninstall.ps1` removes that registration and installed host files.

Never put provider keys in source files, commits, logs, screenshots, issue reports, planner messages, or customization prompts. Enter them only in Blueprint Settings and rotate a key if exposure is suspected.

## Report a vulnerability

Do not publish credentials, private transcripts, or an exploitable proof in a public issue. Contact the repository maintainer privately with the affected version, reproduction steps, impact, and the smallest safe evidence. Useful reports include native-message validation bypasses, unexpected data disclosure, unauthorized tool use, unsafe proposal application, secret persistence, or release-package tampering.
