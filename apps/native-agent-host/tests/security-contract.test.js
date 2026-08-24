import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const hostRoot = path.resolve(testDirectory, "..");
const repoRoot = path.resolve(hostRoot, "..", "..");

function readHostFile(...segments) {
  return fs.readFileSync(path.join(hostRoot, ...segments), "utf8");
}

let agentServiceModulePromise;
function loadAgentServiceForTest() {
  if (!agentServiceModulePromise) {
    agentServiceModulePromise = build({
      entryPoints: [path.join(hostRoot, "src", "agent-service.ts")],
      bundle: true,
      format: "esm",
      platform: "node",
      target: "node22",
      write: false,
      loader: { ".md": "text" },
      plugins: [
        {
          name: "local-agent-test-doubles",
          setup(esbuild) {
            esbuild.onResolve(
              { filter: /^@earendil-works\/pi-agent-core$/ },
              (args) => ({ path: args.path, namespace: "agent-test-double" }),
            );
            esbuild.onResolve(
              { filter: /^@earendil-works\/pi-ai$/ },
              (args) => ({ path: args.path, namespace: "agent-test-double" }),
            );
            esbuild.onResolve(
              { filter: /^@earendil-works\/pi-ai\/providers\/deepseek$/ },
              (args) => ({ path: args.path, namespace: "agent-test-double" }),
            );
            esbuild.onResolve(
              { filter: /^@sinclair\/typebox$/ },
              (args) => ({ path: args.path, namespace: "agent-test-double" }),
            );
            esbuild.onLoad({ filter: /.*/, namespace: "agent-test-double" }, (args) => {
              if (args.path === "@earendil-works/pi-agent-core") {
                return {
                  contents: `
                    export class Agent {
                      constructor(options) {
                        globalThis.__blueprintCapturedAgentOptions = options;
                        this.state = { ...options.initialState, messages: [] };
                      }
                      subscribe() { return () => {}; }
                      async prompt() {
                        this.state.messages.push({
                          role: "assistant",
                          content: [{ type: "text", text: "test Agent response" }],
                        });
                      }
                      abort() {}
                      reset() {}
                    }
                  `,
                };
              }
              if (args.path === "@earendil-works/pi-ai") {
                return {
                  contents: `
                    export function createModels() {
                      return {
                        setProvider() {},
                        getModel(provider, id) {
                          return { provider, id, maxTokens: 384000 };
                        },
                        async streamSimple() {},
                      };
                    }
                  `,
                };
              }
              if (args.path.endsWith("/deepseek")) {
                return { contents: "export function deepseekProvider() { return {}; }" };
              }
              return {
                contents: "export const Type = { Object: (value) => value, String: (value) => value };",
              };
            });
          },
        },
      ],
    }).then(({ outputFiles }) =>
      import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`),
    );
  }
  return agentServiceModulePromise;
}

async function runPlannerWithAgentText(agentText, onProposal) {
  const { LocalAgentService } = await loadAgentServiceForTest();
  const service = new LocalAgentService();
  service.runAgent = async () => agentText;
  return service.run(
    { sessionId: "session-test", apiKey: "not-used", modelId: "deepseek-v4-flash" },
    "blueprint.plan",
    { text: "Plan safely", blueprint: "## Existing\n", blueprintVersion: 1 },
    { signal: new AbortController().signal, onProposal },
  );
}

test("native-host workspace test command discovers at least one real test", () => {
  const packageJson = JSON.parse(readHostFile("package.json"));
  const discoveredTests = fs
    .readdirSync(testDirectory)
    .filter((name) => name.endsWith(".test.js"));

  assert.match(packageJson.scripts.test, /node\s+--test/);
  assert.ok(discoveredTests.length >= 1, "the host workspace must contain a discoverable test");
  assert.ok(discoveredTests.includes(path.basename(fileURLToPath(import.meta.url))));
});

test("prompt variable substitution is one-pass for untrusted placeholder text", async () => {
  const promptLoaderUrl = pathToFileURL(
    path.join(hostRoot, "src", "prompt-loader.ts"),
  ).href;
  const { loadPromptSection } = await import(promptLoaderUrl);
  const markdown = [
    "## System prompt",
    "",
    "```text",
    "User value: {untrusted}",
    "Trusted value: {trusted}",
    "```",
  ].join("\n");

  assert.equal(
    loadPromptSection(markdown, "System prompt", {
      untrusted: "literal {trusted}",
      trusted: "trusted replacement",
    }),
    "User value: literal {trusted}\nTrusted value: trusted replacement",
  );
});

test("the Agent execution path enforces bounded turn and tool-call budgets", () => {
  const source = readHostFile("src", "agent-service.ts");
  const runAgentStart = source.indexOf("private async runAgent");
  const plannerStart = source.indexOf("private async runBlueprintPlanner", runAgentStart);
  assert.ok(runAgentStart >= 0 && plannerStart > runAgentStart);
  const executionPath = source.slice(runAgentStart, plannerStart);

  const declarations = [...source.matchAll(
    /const\s+([A-Z][A-Z0-9_]*(?:TURN|TOOL_CALL)[A-Z0-9_]*)\s*=\s*([\d_]+)/g,
  )].map((match) => ({
    name: match[1],
    value: Number(match[2].replaceAll("_", "")),
  }));
  const turnBudget = declarations.find(({ name }) => name.includes("TURN"));
  const toolCallBudget = declarations.find(({ name }) => name.includes("TOOL_CALL"));

  assert.ok(turnBudget, "declare an explicit maximum Agent turn budget");
  assert.ok(toolCallBudget, "declare an explicit maximum Agent tool-call budget");
  for (const budget of [turnBudget, toolCallBudget]) {
    assert.ok(
      Number.isSafeInteger(budget.value) && budget.value >= 1 && budget.value <= 32,
      `${budget.name} must be a conservative finite positive integer`,
    );
    assert.match(
      executionPath,
      new RegExp(`\\b${budget.name}\\b`),
      `${budget.name} must be enforced by the shared Agent execution path`,
    );
  }
});

test("the model passed to Pi Agent has a conservative runtime maxTokens limit", async () => {
  const { LocalAgentService } = await loadAgentServiceForTest();
  delete globalThis.__blueprintCapturedAgentOptions;
  const service = new LocalAgentService();

  const result = await service.run(
    { sessionId: "session-token-budget", apiKey: "not-used", modelId: "deepseek-v4-flash" },
    "learning.explain_selection",
    { selectedText: "Explain bounded output" },
    { signal: new AbortController().signal },
  );

  assert.deepEqual(result, { explanation: "test Agent response" });
  const runtimeMaxTokens =
    globalThis.__blueprintCapturedAgentOptions?.initialState?.model?.maxTokens;
  assert.ok(
    Number.isSafeInteger(runtimeMaxTokens) &&
      runtimeMaxTokens >= 1 &&
      runtimeMaxTokens <= 32_768,
    `Pi Agent model.maxTokens must be explicitly bounded; received ${String(runtimeMaxTokens)}`,
  );
});

test("packaging and installation bind Native Messaging to the stable extension ID", () => {
  const stableExtensionId = "kipaapemlimhdkpcenelpjeccmnkninf";
  for (const relativePath of [
    ["scripts", "install.ps1"],
    ["scripts", "package-host.ps1"],
  ]) {
    const source = readHostFile(...relativePath);
    const label = path.join(...relativePath);
    const ids = [...source.matchAll(/\b[a-p]{32}\b/g)].map((match) => match[0]);

    assert.doesNotMatch(
      source,
      /\$ExtensionId\b/,
      `${label} must not accept or interpolate an arbitrary ExtensionId`,
    );
    assert.deepEqual(
      [...new Set(ids)],
      [stableExtensionId],
      `${label} must contain only the published extension ID`,
    );
  }

  assert.equal(fs.existsSync(path.join(repoRoot, "manifest.json")), true);
});

test("blueprint planner rejects free text when the proposal tool was never called", async () => {
  const observedProposals = [];
  await assert.rejects(
    runPlannerWithAgentText(
      "Here is an informal plan that was not submitted through the proposal tool.",
      (proposal) => observedProposals.push(proposal),
    ),
  );
  assert.deepEqual(observedProposals, []);
});

test("blueprint planner fails closed when its budget ends without a proposal tool call", async () => {
  const observedProposals = [];
  await assert.rejects(
    runPlannerWithAgentText("", (proposal) => observedProposals.push(proposal)),
  );
  assert.deepEqual(observedProposals, []);
});

test("blueprint planner rejects propose-before-read and accepts read-then-propose", async () => {
  const { LocalAgentService } = await loadAgentServiceForTest();
  const session = {
    sessionId: "session-order",
    apiKey: "not-used",
    modelId: "deepseek-v4-flash",
  };
  const input = { text: "Plan safely", blueprint: "## Existing\n", blueprintVersion: 1 };

  const outOfOrderService = new LocalAgentService();
  const outOfOrderObserved = [];
  outOfOrderService.runAgent = async (_session, _system, _user, tools) => {
    const propose = tools.find((tool) => tool.name === "propose_blueprint_revision");
    const rejected = await propose.execute("proposal-before-read", {
      markdown: "## Unsafe order",
      summary: "must be rejected",
    });
    assert.equal(rejected.isError, true);
    return "free text must not become a proposal";
  };
  await assert.rejects(
    outOfOrderService.run(session, "blueprint.plan", input, {
      signal: new AbortController().signal,
      onProposal: (proposal) => outOfOrderObserved.push(proposal),
    }),
  );
  assert.deepEqual(outOfOrderObserved, []);

  const orderedService = new LocalAgentService();
  const orderedObserved = [];
  orderedService.runAgent = async (_session, _system, _user, tools) => {
    const read = tools.find((tool) => tool.name === "read_blueprint");
    const propose = tools.find((tool) => tool.name === "propose_blueprint_revision");
    const readResult = await read.execute("read-first", {});
    assert.match(readResult.content[0].text, /Existing/);
    const proposalResult = await propose.execute("proposal-after-read", {
      markdown: "## Ordered proposal",
      summary: "read then propose",
    });
    assert.equal(proposalResult.isError, undefined);
    return "";
  };
  const orderedResult = await orderedService.run(session, "blueprint.plan", input, {
    signal: new AbortController().signal,
    onProposal: (proposal) => orderedObserved.push(proposal),
  });
  assert.deepEqual(orderedResult, {
    proposal: { markdown: "## Ordered proposal", summary: "read then propose" },
  });
  assert.deepEqual(orderedObserved, [
    { markdown: "## Ordered proposal", summary: "read then propose" },
  ]);
});
