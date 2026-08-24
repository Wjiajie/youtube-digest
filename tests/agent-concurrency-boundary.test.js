const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("options delegates Agent status to the single background gateway session", () => {
  const optionsSource = read("options.js");
  const optionsHtml = read("options.html");
  const backgroundSource = read("background.js");

  assert.doesNotMatch(
    optionsSource,
    /\bnew\s+(?:root\.)?BlueprintAgent\.AgentGateway\b|\bnew\s+AgentGateway\b/,
    "the options page must not create its own credentialed AgentGateway",
  );
  assert.doesNotMatch(
    optionsSource,
    /\bconnectNative\s*\(/,
    "the options page must not open a Native Messaging session",
  );
  assert.doesNotMatch(
    optionsHtml,
    /<script\b[^>]*\bsrc=["']agent-gateway\.js["']/i,
    "the options document must not load the Native Messaging gateway",
  );
  assert.match(
    optionsSource,
    /(?:root\.)?chrome\.runtime\.sendMessage\s*\(\s*\{\s*action\s*:\s*["']getAgentStatus["']/,
    "connection checks must ask the background service worker for Agent status",
  );
  assert.match(
    backgroundSource,
    /message\.action\s*===\s*["']getAgentStatus["'][\s\S]*?agentGateway\s*\.\s*getStatus\s*\(/,
  );
});

function loadBackgroundWithBlockedBlueprintWrites() {
  let messageListener;
  let releaseWrites;
  let setCalls = 0;
  const writesReleased = new Promise((resolve) => {
    releaseWrites = resolve;
  });
  const store = {
    blueprint_state_v1: {
      version: 7,
      markdown: "## Existing\n- Existing video | https://www.youtube.com/watch?v=abcdef0",
      theme: "sci-fi",
      updatedAt: 1,
    },
  };
  const listener = { addListener() {} };
  let context;

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
    fetch: async () => {
      throw new Error("network access is forbidden in this concurrency test");
    },
    chrome: {
      storage: {
        local: {
          setAccessLevel: () => Promise.resolve(),
          async get(keys) {
            const snapshot = structuredClone(store);
            if (typeof keys === "string") return { [keys]: snapshot[keys] };
            if (Array.isArray(keys)) {
              return Object.fromEntries(keys.map((key) => [key, snapshot[key]]));
            }
            return snapshot;
          },
          async set(values) {
            setCalls += 1;
            await writesReleased;
            Object.assign(store, structuredClone(values));
          },
        },
        onChanged: listener,
      },
      action: { onClicked: listener },
      sidePanel: {
        setPanelBehavior() {},
        setOptions: () => Promise.resolve(),
        open: () => Promise.resolve(),
      },
      runtime: {
        onInstalled: listener,
        onConnect: listener,
        onMessage: {
          addListener(callback) {
            messageListener = callback;
          },
        },
        openOptionsPage() {},
        getURL: (resource) => `chrome-extension://test/${resource}`,
        sendMessage: () => Promise.resolve(),
        connectNative() {
          throw new Error("Native Messaging must not be used by blueprint apply");
        },
      },
      tabs: {
        onUpdated: listener,
        onActivated: listener,
        create: () => Promise.resolve(),
        get: async () => ({}),
        query: async () => [],
      },
      scripting: { executeScript: async () => [] },
    },
  };
  sandbox.globalThis = sandbox;
  context = vm.createContext(sandbox);
  vm.runInContext(read("background.js"), context, { filename: "background.js" });

  return {
    store,
    releaseWrites,
    getSetCalls: () => setCalls,
    send(message) {
      return new Promise((resolve, reject) => {
        const keepChannelOpen = messageListener(message, {}, resolve);
        if (keepChannelOpen !== true) {
          reject(new Error("background must keep the apply response channel open"));
        }
      });
    },
  };
}

test("two proposals for the same base version commit exactly once", async () => {
  const harness = loadBackgroundWithBlockedBlueprintWrites();
  const first = harness.send({
    action: "applyBlueprintProposal",
    baseVersion: 7,
    proposal: {
      markdown: "## First\n- First video | https://www.youtube.com/watch?v=abcdef1",
      summary: "first",
    },
  });
  const second = harness.send({
    action: "applyBlueprintProposal",
    baseVersion: 7,
    proposal: {
      markdown: "## Second\n- Second video | https://www.youtube.com/watch?v=abcdef2",
      summary: "second",
    },
  });

  // Let both current get/check paths reach the deliberately blocked write.
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  harness.releaseWrites();

  const responses = await Promise.all([first, second]);
  const successes = responses.filter((response) => response?.success === true);
  const conflicts = responses.filter(
    (response) =>
      response?.success === false && response?.error === "BLUEPRINT_VERSION_CONFLICT",
  );

  assert.equal(successes.length, 1, "only one same-version proposal may commit");
  assert.equal(conflicts.length, 1, "the losing proposal must report a version conflict");
  assert.equal(harness.getSetCalls(), 1, "a conflicted proposal must not write storage");
  assert.equal(harness.store.blueprint_state_v1.version, 8);
});
