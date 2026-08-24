const test = require("node:test");
const assert = require("node:assert/strict");

const { parseBlueprint } = require("../blueprint-domain.js");

test("duplicate top-level goal titles receive unique routable IDs", () => {
  const parsed = parseBlueprint([
    "## Learn agents",
    "- First video | https://www.youtube.com/watch?v=abcdef1",
    "## Learn agents",
    "- Second video | https://www.youtube.com/watch?v=abcdef2",
  ].join("\n"));

  const ids = parsed.goals.map((goal) => goal.id);
  assert.equal(ids.length, 2);
  assert.equal(new Set(ids).size, ids.length, "each top-level route target must be unique");
  for (const id of ids) {
    assert.equal(typeof id, "string");
    assert.ok(id.length > 0 && !/\s/.test(id), `goal ID must be routable: ${id}`);
    assert.equal(decodeURIComponent(encodeURIComponent(id)), id);
  }
});

test("a bullet URL binding must reject non-canonical or non-YouTube URLs", () => {
  const invalidBindings = [
    "https://example.com/watch?v=abcdef1",
    "http://www.youtube.com/watch?v=abcdef1",
    "https://youtu.be/abcdef1",
    "https://www.youtube.com.evil.example/watch?v=abcdef1",
  ];

  for (const url of invalidBindings) {
    assert.throws(
      () => parseBlueprint(`## Goal\n- Bound resource | ${url}`),
      undefined,
      `must reject attempted URL binding: ${url}`,
    );
  }

  const canonical = parseBlueprint(
    "## Goal\n- Bound resource | https://www.youtube.com/watch?v=abcdef1",
  );
  assert.equal(
    canonical.goals[0].milestones[0].nodes[0].youtubeUrl,
    "https://www.youtube.com/watch?v=abcdef1",
  );
});
