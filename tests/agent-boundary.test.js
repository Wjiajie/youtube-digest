const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function extractFunction(source, name) {
  const startPattern = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const start = source.search(startPattern);
  assert.notEqual(start, -1, `Expected background.js to define ${name}`);
  const remaining = source.slice(start + 1);
  const nextFunction = remaining.search(/\n(?:async\s+)?function\s+[A-Za-z_$]/);
  return source.slice(start, nextFunction === -1 ? source.length : start + 1 + nextFunction);
}

function loadAgentGateway() {
  const gatewayPath = path.join(root, "agent-gateway.js");
  assert.equal(
    fs.existsSync(gatewayPath),
    true,
    "Blueprint v3 requires a root agent-gateway.js loadable by the MV3 worker",
  );
  return require(gatewayPath);
}

test("manifest grants nativeMessaging while keeping Supadata direct and DeepSeek unprivileged", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const permissions = manifest.permissions || [];
  const hostPermissions = manifest.host_permissions || [];

  assert.ok(permissions.includes("nativeMessaging"));
  assert.ok(hostPermissions.includes("https://api.supadata.ai/*"));
  assert.equal(
    hostPermissions.some((permission) => /deepseek/i.test(permission)),
    false,
    "the extension must not hold a DeepSeek host permission",
  );
});

test("AgentGateway exposes the accepted v3 operation surface", () => {
  const exported = loadAgentGateway();
  const AgentGateway = exported.AgentGateway || exported;
  const requiredMethods = [
    "getStatus",
    "analyzeVideo",
    "explainSelection",
    "translateTranscriptBatch",
    "polishNote",
    "planBlueprint",
    "abort",
  ];

  assert.equal(typeof AgentGateway, "function");
  for (const method of requiredMethods) {
    assert.equal(
      typeof AgentGateway.prototype[method],
      "function",
      `AgentGateway.${method} must be implemented`,
    );
  }
});

test("extension LLM runtime has one Native Messaging gateway and no direct provider transport", () => {
  const background = read("background.js");
  assert.match(background, /importScripts\([\s\S]*?["']agent-gateway\.js["']/);
  assert.doesNotMatch(background, /https:\/\/api\.deepseek\.com/i);
  assert.doesNotMatch(background, /chatCompletionsUrl|\/chat\/completions/i);
  assert.doesNotMatch(background, /Authorization\s*:\s*`?Bearer/i);
  assert.doesNotMatch(background, /\brequestAiCompletion\b|\bcallAiTranslation\b/);

  const gateway = read("agent-gateway.js");
  assert.match(gateway, /chrome\.runtime\.connectNative\s*\(/);
  assert.doesNotMatch(gateway, /\bfetch\s*\(/);
  assert.doesNotMatch(gateway, /https:\/\/api\.deepseek\.com/i);
});

test("the four existing learning actions route through the same AgentGateway instance", () => {
  const background = read("background.js");
  const routes = [
    ["handleAnalyzeTranscript", "analyzeVideo"],
    ["handleExplainSelection", "explainSelection"],
    ["handleTranslateContent", "translateTranscriptBatch"],
    ["cleanupNoteText", "polishNote"],
  ];
  const receivers = [];

  for (const [functionName, methodName] of routes) {
    const body = extractFunction(background, functionName);
    const match = body.match(
      new RegExp(`\\b([A-Za-z_$][\\w$]*)\\.${methodName}\\s*\\(`),
    );
    assert.ok(match, `${functionName} must call AgentGateway.${methodName}`);
    receivers.push(match[1]);
    assert.doesNotMatch(body, /\bfetch\s*\(|\brequestAiCompletion\b/);
  }

  assert.equal(
    new Set(receivers).size,
    1,
    `Expected one shared AgentGateway receiver, got: ${receivers.join(", ")}`,
  );
});

function loadBackgroundWithUnavailableHost() {
  const targetText = "Raw target note.";
  const store = {
    ytd_settings: {
      aiApiKey: "test-session-key",
      supadataApiKey: "test-supadata-key",
    },
    digest_abcdefghi: {
      transcript: [
        { start: 0, text: "Earlier context." },
        { start: 10, text: targetText },
        { start: 20, text: "Later context." },
      ],
    },
    ytd_notes: [],
  };
  let messageListener;
  let context;
  const listener = { addListener() {} };
  const sandbox = {
    console,
    URL,
    TextDecoder,
    TextEncoder,
    AbortController,
    structuredClone,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    importScripts(...files) {
      for (const file of files) {
        vm.runInContext(read(file), context, { filename: file });
      }
    },
    fetch: async (url) => {
      if (String(url).startsWith("chrome-extension://test/")) {
        const resource = String(url).slice("chrome-extension://test/".length);
        return { ok: true, text: async () => read(resource) };
      }
      throw new Error("Direct LLM network access is forbidden in the extension");
    },
    chrome: {
      storage: {
        local: {
          setAccessLevel: () => Promise.resolve(),
          async get(key) {
            if (typeof key === "string") return { [key]: store[key] };
            return { ...store };
          },
          async set(values) {
            Object.assign(store, values);
          },
        },
      },
      action: { onClicked: listener },
      sidePanel: {
        setPanelBehavior() {},
        setOptions: () => Promise.resolve(),
        open: () => Promise.resolve(),
      },
      runtime: {
        onInstalled: listener,
        onMessage: {
          addListener(callback) {
            messageListener = callback;
          },
        },
        openOptionsPage() {},
        getURL: (resource) => `chrome-extension://test/${resource}`,
        sendMessage: () => Promise.resolve(),
        connectNative() {
          return {
            onMessage: listener,
            onDisconnect: listener,
            postMessage() {
              throw new Error("Native Agent host is unavailable");
            },
            disconnect() {},
          };
        },
      },
      tabs: {
        onUpdated: listener,
        onActivated: listener,
        get: async () => ({}),
        query: async () => [],
      },
      scripting: { executeScript: async () => [] },
    },
  };
  sandbox.globalThis = sandbox;
  context = vm.createContext(sandbox);
  vm.runInContext(read("background.js"), context, { filename: "background.js" });

  return { store, targetText, messageListener };
}

test("note polish host failure still saves the exact raw note as explicitly unfinished", async () => {
  const { store, targetText, messageListener } =
    loadBackgroundWithUnavailableHost();
  assert.equal(typeof messageListener, "function");

  const result = await new Promise((resolve, reject) => {
    const keepChannelOpen = messageListener(
      {
        action: "saveNote",
        videoId: "abcdefghi",
        timestamp: 12,
        videoTitle: "Test video",
        channelName: "Test channel",
      },
      {},
      resolve,
    );
    if (keepChannelOpen !== true) {
      reject(new Error("saveNote must keep its asynchronous response channel open"));
    }
  });

  assert.equal(result.success, true);
  assert.equal(store.ytd_notes.length, 1);
  const [note] = store.ytd_notes;
  assert.equal(note.rawText, targetText);
  assert.equal(note.text, targetText);
  const polishIsExplicitlyUnfinished =
    note.polishCompleted === false ||
    note.isPolished === false ||
    ["failed", "incomplete", "unavailable"].includes(note.polishStatus) ||
    ["failed", "incomplete", "unavailable"].includes(note.polish?.status);
  assert.equal(
    polishIsExplicitlyUnfinished,
    true,
    "saved note must record that Agent polish did not complete",
  );
});
