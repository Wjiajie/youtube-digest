# Blueprint

Blueprint is a personal goal system delivered as a Chrome extension plus a local Windows Agent service. The extension opens on an interactive 3D goal home page, turns approved Agent proposals into a stable Markdown skill tree, and reuses the included YouTube learning side panel for linked course nodes.

[简体中文](README.zh-CN.md)

## Product shape

- The Chrome extension owns the Blueprint, settings, notes, transcripts, and interface.
- The local Blueprint Agent Host is a small Windows executable registered through Chrome Native Messaging. It runs Pi Agent and is the only component that calls DeepSeek.
- Supadata transcript requests remain a direct extension integration and always use `mode=native`.
- There is no developer-operated account, cloud database, analytics service, or proxy backend.

The extension can still open and display saved goals without the Agent Host. Planning, overviews, explanations, translation, and note polishing require the local service and your DeepSeek key.

## Install with your coding agent

Ask your coding agent to build and package this repository, then place the extracted release in a permanent folder I choose. The extension and native host must stay at stable paths after installation.

1. Install Node.js 22 or newer, npm, Git Bash, and a current Chrome version.
2. Run `npm install` and `npm run package:all` from this repository.
3. Open `dist/blueprint-agent-host-windows-x64` in PowerShell and run `./install.ps1`. This copies the host to your local application data folder and registers `com.blueprint.agent` for the published extension ID.
4. Open `chrome://extensions`, enable Developer mode, and choose **Load unpacked**.
5. Select the repository root or the extracted extension folder. The selected folder must contain `manifest.json`, not another parent folder.
6. Pin Blueprint if you want a toolbar shortcut. Clicking the toolbar icon opens the Blueprint home page.

To remove the local host, run `./uninstall.ps1` from the same host package. Removing the host does not delete extension data. Chrome does not auto-update unpacked extensions; replace the files and click **Reload** on the Blueprint card after an update.

## Configure

Open Blueprint, choose the Settings button, and enter these values yourself:

1. A Supadata API key from [Supadata sign-up](https://dash.supadata.ai/auth/sign-up).
2. A DeepSeek API key from [DeepSeek API Keys](https://platform.deepseek.com/api_keys).
3. One visual theme: sci-fi, cyberpunk, wuxia, or modern urban.

The published model is fixed to DeepSeek V4 Flash. API keys are stored in Chrome's local extension storage. When an AI session begins, the extension sends the DeepSeek key to the local Blueprint Agent Host over Native Messaging; the host keeps it only in memory for the session and does not persist it.

Use **Check connection** in Settings to confirm that Chrome can reach the host. A missing-host status usually means `install.ps1` was not run for the current Windows user, or Chrome was open while the native host registration changed. Restart Chrome and check again.

## Use Blueprint

1. Click the Blueprint toolbar icon. The home page shows a rotatable animated character and one module for each top-level goal.
2. Type a goal or requested change into the planner at the bottom of the page.
3. Review the Agent's Markdown proposal. Nothing is persisted until you choose **Apply proposal**.
4. Select a goal module to open its milestone path. Theme changes affect presentation only; the hierarchy stays the same.
5. Select a milestone with a YouTube watch link to open that video and the existing learning side panel.
6. In the learning panel, fetch the transcript, generate an overview, translate segments, explain selected text, and save timestamped notes.

The planner accepts this structural format:

```markdown
# My Blueprint

## Learn distributed systems
### Foundations
- Networking basics | https://www.youtube.com/watch?v=VIDEO_ID
- Consensus
### Practice
- Build a replicated key-value store
```

The extension validates size, hierarchy, link origin, and blueprint version before applying a proposal. The Agent receives no file, shell, browser, or arbitrary network tools.

## Supadata caption behavior and credits

Blueprint sends the canonical YouTube watch URL and your Supadata key to the transcript API described in [Supadata's get-transcript documentation](https://docs.supadata.ai/get-transcript). It forces `mode=native`, prefers English when available, and does not perform local audio transcription.

Supadata currently advertises 100 credits per month on its free plan. A native transcript request uses **1 credit**. A generated transcript costs **2 credits per video minute**, but Blueprint does not use that generated path because it forces `mode=native`. Provider pricing and quotas can change, so confirm them in Supadata before relying on these figures.

DeepSeek usage is billed separately under your DeepSeek account. Blueprint does not include or resell provider credits.

## Architecture

```text
Chrome extension
  Blueprint 3D home and goal pages
  Planner chat and user-confirmed proposals
  YouTube learning side panel
  Chrome local storage
       | Native Messaging, framed JSON protocol v1
       v
Local Blueprint Agent Host for Windows
  Capability router and validation
  Pi Agent Core
  DeepSeek V4 Flash transport
```

All five AI capabilities use the same Gateway: blueprint planning, video analysis, selection explanation, transcript-batch translation, and note polishing. The browser code has no DeepSeek endpoint or authorization transport. Prompt templates are bundled into the Windows host during its build.

## Development and packaging

```bash
npm install
npm test
npm run build:extension
npm run build:host
npm run check
npm run package:all
```

Release artifacts are written to `dist/`:

- `blueprint-v2.0.0.zip`: allowlisted Chrome extension files.
- `blueprint-agent-host-windows-x64/`: standalone host executable, installer, uninstaller, example manifest, and SHA-256 checksums.

See [PRIVACY.md](PRIVACY.md) for data handling and [SECURITY.md](SECURITY.md) for trust boundaries and vulnerability reporting.
