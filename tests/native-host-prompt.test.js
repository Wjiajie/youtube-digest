const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const promptLoaderUrl = pathToFileURL(
  path.resolve(__dirname, "../apps/native-agent-host/src/prompt-loader.ts"),
).href;

test("native Agent prompt loader extracts CRLF fenced sections and substitutes variables", async () => {
  const { loadPromptSection } = await import(promptLoaderUrl);
  const markdown = [
    "# Prompt fixture",
    "",
    "## System prompt",
    "",
    "```text",
    "Teach {topic} safely.",
    "Second line.",
    "```",
    "",
    "## Other section",
    "",
    "```",
    "ignored",
    "```",
    "",
  ].join("\r\n");

  assert.equal(
    loadPromptSection(markdown, "System prompt", { topic: "Native Messaging" }),
    "Teach Native Messaging safely.\r\nSecond line.",
  );
  assert.throws(
    () => loadPromptSection(markdown, "Missing prompt"),
    /Prompt section not found/,
  );
});

test("native Agent loose JSON parser accepts fenced output and trailing commas", async () => {
  const { parseLooseJson } = await import(promptLoaderUrl);

  assert.deepEqual(
    parseLooseJson('preface\n```json\n{"segments":[{"id":"one","text":"中文",}],}\n```'),
    { segments: [{ id: "one", text: "中文" }] },
  );
  assert.throws(() => parseLooseJson("not JSON"), /JSON/);
});
