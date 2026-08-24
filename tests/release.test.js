const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("manifest grants the minimum Blueprint Native Messaging boundary", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const packageJson = JSON.parse(read("package.json"));

  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.minimum_chrome_version, "116");
  assert.equal(manifest.name, "Blueprint");
  assert.equal(manifest.version, "2.0.0");
  assert.equal(packageJson.version, manifest.version);
  assert.equal(manifest.options_ui.page, "options.html");
  assert.ok(manifest.permissions.includes("nativeMessaging"));
  assert.equal(manifest.permissions.includes("activeTab"), false);
  assert.ok(manifest.host_permissions.includes("https://www.youtube.com/*"));
  assert.ok(manifest.host_permissions.includes("https://api.supadata.ai/*"));
  assert.equal(
    manifest.host_permissions.some((permission) => /deepseek/i.test(permission)),
    false,
  );
  assert.equal(Object.hasOwn(manifest, "optional_host_permissions"), false);
  assert.match(manifest.key, /^[A-Za-z0-9+/=]+$/);
});

test("release surface includes Blueprint pages, Agent gateway, and Windows host packaging", () => {
  const extensionFiles = [
    "agent-gateway.js",
    "blueprint-domain.js",
    "blueprint.html",
    "blueprint.css",
    "blueprint.js",
    "goal.html",
    "goal.css",
    "goal.js",
  ];
  const releaseScript = read("scripts/check-release.sh");
  for (const file of extensionFiles) {
    assert.equal(fs.existsSync(path.join(root, file)), true, file);
    assert.match(releaseScript, new RegExp(`"${file.replace(".", "\\.")}"`));
  }

  for (const file of [
    "apps/native-agent-host/src/index.ts",
    "apps/native-agent-host/src/agent-service.ts",
    "apps/native-agent-host/src/prompt-loader.ts",
    "apps/native-agent-host/scripts/install.ps1",
    "apps/native-agent-host/scripts/uninstall.ps1",
    "apps/native-agent-host/scripts/package-host.ps1",
    "apps/native-agent-host/sea-config.json",
    "packages/native-protocol/src/index.js",
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), true, file);
  }

  const packageJson = JSON.parse(read("package.json"));
  assert.match(packageJson.scripts["build:host"], /native-agent-host/);
  assert.match(packageJson.scripts["package:host"], /native-agent-host/);
  assert.match(packageJson.scripts["package:all"], /build:extension/);
  assert.match(packageJson.scripts["package:all"], /package:host/);
  assert.match(read("scripts/build-extension.mjs"), /blueprint-src\.js/);
});

test("published copy uses the Blueprint product name", () => {
  const readme = read("README.md");
  const chineseReadme = read("README.zh-CN.md");
  const privacy = read("PRIVACY.md");
  const security = read("SECURITY.md");

  for (const text of [readme, chineseReadme, privacy, security]) {
    assert.doesNotMatch(text, /—/);
  }
  assert.match(readme, /^# Blueprint$/m);
  assert.match(chineseReadme, /^# Blueprint$/m);
});

test("published docs describe the local Agent trust boundary", () => {
  const readme = read("README.md");
  const chineseReadme = read("README.zh-CN.md");
  const privacy = read("PRIVACY.md");
  const security = read("SECURITY.md");
  const publishedDocs = [readme, chineseReadme, privacy, security].join("\n");

  assert.match(publishedDocs, /local Blueprint Agent|local Agent service/i);
  assert.match(publishedDocs, /Native Messaging/i);
  assert.match(privacy, /session memory|memory for the session/i);
  assert.match(privacy, /Chrome(?:'s)? local extension storage/i);
  assert.doesNotMatch(
    publishedDocs,
    /requests go directly from the extension to (?:Supadata or )?DeepSeek/i,
  );
  assert.doesNotMatch(publishedDocs, /DeepSeek host access/i);
});

test("Settings exposes Agent status without provider transport controls", () => {
  const optionsPage = read("options.html");
  const optionsScript = read("options.js");

  assert.match(optionsPage, /<title>Blueprint Settings<\/title>/);
  assert.match(optionsPage, /<div class="eyebrow">Blueprint<\/div>/);
  assert.match(
    optionsPage,
    /Blueprint uses DeepSeek V4 Flash for overviews,[\s\S]*note polishing\./,
  );
  assert.match(optionsPage, /local Blueprint Agent Host/i);
  assert.match(optionsPage, /id="checkAgentButton"/);
  assert.match(optionsPage, /id="agentServiceStatus"[^>]*role="status"/);
  assert.doesNotMatch(optionsPage, /id="(?:provider|aiBaseUrl|aiModel)"/);
  assert.match(optionsScript, /agentGateway\.getStatus\s*\(/);
});

test("install and learning documentation retains the direct Supadata contract", () => {
  const readme = read("README.md");
  const chineseReadme = read("README.zh-CN.md");

  assert.match(readme, /^## Install with your coding agent$/m);
  assert.match(readme, /permanent folder I choose/i);
  assert.match(readme, /Load unpacked/i);
  assert.match(readme, /must contain `manifest\.json`/i);
  assert.match(readme, /100 credits per month/i);
  assert.match(readme, /native transcript request uses \*\*1 credit\*\*/i);
  assert.match(readme, /generated transcript costs \*\*2 credits per video minute\*\*/i);
  assert.match(readme, /forces `mode=native`/i);
  assert.match(readme, /dash\.supadata\.ai\/auth\/sign-up/i);
  assert.match(readme, /docs\.supadata\.ai\/get-transcript/i);
  assert.match(chineseReadme, /^## 让你的编程 Agent 帮你安装$/m);
  assert.match(chineseReadme, /加载已解压的扩展程序/);
  assert.match(chineseReadme, /必须包含 `manifest\.json`/);
  assert.match(chineseReadme, /dash\.supadata\.ai\/auth\/sign-up/i);
  assert.doesNotMatch(readme, /^## Contributing$/m);
});

test("notes filters preserve selected contrast and expose pressed state", () => {
  const html = read("sidepanel.html");
  const css = read("sidepanel.css");
  const js = read("sidepanel.js");

  assert.match(
    html,
    /id="notesFilterThis"[\s\S]*?aria-pressed="true"[\s\S]*?>[\s\S]*?This Video/,
  );
  assert.match(
    html,
    /id="notesFilterAll"[\s\S]*?aria-pressed="false"[\s\S]*?>[\s\S]*?All Notes/,
  );
  assert.match(
    css,
    /\.notes-filter \.enhance-btn\.active:hover:not\(:disabled\)\s*\{[^}]*background:\s*var\(--accent-hover\);[^}]*color:\s*white;/,
  );
  assert.match(
    css,
    /\.notes-filter \.enhance-btn:hover:not\(:disabled\)\s*\{[^}]*background:\s*transparent;[^}]*color:\s*var\(--text-secondary\);/,
  );
  assert.match(css, /\.notes-filter \.enhance-btn:focus-visible\s*\{[^}]*outline:/);
  assert.match(js, /setNotesFilter\(false\)/);
  assert.match(js, /setNotesFilter\(true\)/);
  assert.match(js, /setAttribute\("aria-pressed", String\(!showAll\)\)/);
  assert.match(js, /setAttribute\("aria-pressed", String\(showAll\)\)/);
});

test("extension runtime has no source credential or direct LLM provider transport", () => {
  const extensionRuntime = [
    "background.js",
    "agent-gateway.js",
    "content.js",
    "sidepanel.js",
    "options.js",
    "settings.js",
    "blueprint-domain.js",
  ]
    .map(read)
    .join("\n");
  const hostRuntime = read("apps/native-agent-host/src/agent-service.ts");

  assert.doesNotMatch(extensionRuntime, /\bCONFIG\./);
  assert.doesNotMatch(extensionRuntime, /importScripts\(["']config\.js/);
  assert.doesNotMatch(extensionRuntime, /https:\/\/api\.deepseek\.com/i);
  assert.doesNotMatch(extensionRuntime, /Authorization\s*:\s*`?Bearer/i);
  assert.doesNotMatch(extensionRuntime, /\bfetch\s*\([^)]*deepseek/i);
  assert.doesNotMatch(extensionRuntime, /\bsk-[A-Za-z0-9_-]{20,}\b/);
  assert.match(extensionRuntime, /deepseek-v4-flash/);
  assert.match(hostRuntime, /deepseekProvider\(\)/);
  assert.match(hostRuntime, /getApiKey:\s*async \(\) => session\.apiKey/);
});

test("retired Remix and reader files are absent", () => {
  for (const file of [
    "reader.html",
    "reader.js",
    "remix-prompts.js",
    "config.example.js",
  ]) {
    assert.equal(fs.existsSync(path.join(root, file)), false, file);
  }
});

test("published prompt files contain host runtime sections", () => {
  const expectedSections = {
    "prompts/analysis.md": ["System prompt", "User prompt"],
    "prompts/explain.md": ["System prompt", "User prompt"],
    "prompts/note-cleanup.md": ["System prompt", "User prompt"],
    "prompts/translation.md": [
      "Shared base rules",
      "Chinese rules",
      "Transcript batch translation",
    ],
  };
  const hostRuntime = read("apps/native-agent-host/src/agent-service.ts");

  for (const [file, sections] of Object.entries(expectedSections)) {
    const markdown = read(file);
    assert.match(hostRuntime, new RegExp(path.basename(file).replace(".", "\\.")));
    for (const section of sections) {
      assert.match(markdown, new RegExp(`^## ${section}$`, "m"));
    }
  }
});
