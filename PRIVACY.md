# Blueprint Privacy

Last updated: August 22, 2026

Blueprint is a bring-your-own-key Chrome extension with a local Blueprint Agent Host. It has no Blueprint account, developer-operated backend, analytics, advertising, or telemetry.

## Data the extension handles

Depending on the feature, Blueprint handles YouTube video identifiers and metadata, native captions and timestamps, planner conversations, Blueprint Markdown, AI results, translations, selected text, saved notes, appearance settings, and Supadata or DeepSeek API keys.

Blueprint uses Chrome's local extension storage for settings, keys, Blueprint state, conversations, cached digests, translations, and notes. This data remains in the current Chrome profile until you remove it or reset the extension.

## Supadata

For transcript retrieval, the extension sends the canonical YouTube watch URL to `https://api.supadata.ai` with your Supadata API key. Supadata returns native captions and timestamps. Blueprint fixes the request to `mode=native` and does not request generated transcripts.

## Local Agent and DeepSeek

The extension does not contain a DeepSeek HTTP transport. Planning and every learning AI feature are sent through Chrome Native Messaging to the local Blueprint Agent Host installed for the current Windows user.

When a session opens, the extension reads your DeepSeek key from Chrome's local extension storage and sends it to the host. The host retains the key in memory for the session, supplies it to Pi Agent only when DeepSeek is called, and does not write it to disk. The host receives only the content required by the requested capability, such as a planner message, current Blueprint Markdown, transcript text, selected text, or note context.

The local host then sends that requested content to DeepSeek V4 Flash under your DeepSeek account. The developer does not proxy or receive the request. Supadata and DeepSeek process data under their own terms, retention rules, and privacy policies.

## Permissions

- `storage`: keep settings, credentials, Blueprint state, cached learning data, and notes in the Chrome profile.
- `nativeMessaging`: communicate with the installed `com.blueprint.agent` local host.
- `sidePanel`: show the YouTube learning interface beside YouTube.
- `tabs`: open the Blueprint home page and linked YouTube learning nodes.
- YouTube host access: identify the current video and run the learning integration.
- Supadata host access: retrieve native captions.

The extension has no DeepSeek host permission because DeepSeek calls belong to the local host.

## User controls

You can clear cached digests, delete notes, reset all extension data, remove the extension, run the host uninstaller, and revoke either provider key. Clearing local data cannot delete information a provider has already processed or retained.

Blueprint does not sell personal information, build advertising profiles, or share data with data brokers.
