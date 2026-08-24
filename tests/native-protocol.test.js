const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const protocolPath = path.resolve(
  __dirname,
  "../packages/native-protocol/src/index.js",
);

const EXPECTED_CAPABILITIES = [
  "blueprint.plan",
  "learning.analyze_video",
  "learning.explain_selection",
  "learning.polish_note",
  "learning.translate_transcript_batch",
];

function loadProtocol() {
  try {
    delete require.cache[require.resolve(protocolPath)];
    return require(protocolPath);
  } catch (error) {
    if (
      error?.code === "MODULE_NOT_FOUND" &&
      String(error.message).includes("native-protocol")
    ) {
      assert.fail(
        "Blueprint v3 requires packages/native-protocol/src/index.js",
      );
    }
    throw error;
  }
}

function requestEnvelope(overrides = {}) {
  return {
    protocolVersion: 1,
    type: "request",
    requestId: "request-1",
    sessionId: "session-1",
    capability: "learning.analyze_video",
    input: { transcriptText: "[0:00] Hello" },
    ...overrides,
  };
}

test("native protocol freezes version 1 and the accepted capability union", () => {
  const protocol = loadProtocol();

  assert.equal(protocol.PROTOCOL_VERSION, 1);
  assert.ok(
    protocol.CAPABILITIES &&
      typeof protocol.CAPABILITIES[Symbol.iterator] === "function",
    "CAPABILITIES must be an iterable fixed union",
  );
  assert.deepEqual([...protocol.CAPABILITIES].sort(), EXPECTED_CAPABILITIES);
});

test("native protocol validates request and sequenced event envelopes fail-closed", () => {
  const { validateEnvelope } = loadProtocol();
  assert.equal(typeof validateEnvelope, "function");

  assert.doesNotThrow(() => validateEnvelope(requestEnvelope()));
  assert.doesNotThrow(() =>
    validateEnvelope(
      requestEnvelope({
        type: "event",
        seq: 0,
        input: { kind: "output.delta", text: "Hello" },
      }),
    ),
  );

  assert.throws(
    () => validateEnvelope(requestEnvelope({ protocolVersion: 2 })),
    /version/i,
  );
  assert.throws(
    () => validateEnvelope(requestEnvelope({ capability: "shell.exec" })),
    /capability/i,
  );
  assert.throws(
    () => validateEnvelope(requestEnvelope({ requestId: "" })),
    /requestId/i,
  );
  assert.throws(
    () => validateEnvelope(requestEnvelope({ sessionId: "" })),
    /sessionId/i,
  );
  assert.throws(
    () => validateEnvelope(requestEnvelope({ input: null })),
    /input/i,
  );
  assert.throws(
    () => validateEnvelope(requestEnvelope({ type: "event" })),
    /seq/i,
  );
  assert.throws(
    () => validateEnvelope(requestEnvelope({ type: "event", seq: 1.5 })),
    /seq/i,
  );
});

test("native messaging framing uses a 4-byte little-endian UTF-8 byte length", () => {
  const { encodeFrame } = loadProtocol();
  assert.equal(typeof encodeFrame, "function");

  const message = requestEnvelope({ input: { text: "你好, Pi" } });
  const frame = encodeFrame(message);
  const body = Buffer.from(JSON.stringify(message), "utf8");

  assert.ok(Buffer.isBuffer(frame));
  assert.equal(frame.readUInt32LE(0), body.byteLength);
  assert.deepEqual(frame.subarray(4), body);
});

test("native message decoder handles split and coalesced stream chunks", () => {
  const { createFrameDecoder, encodeFrame } = loadProtocol();
  assert.equal(typeof createFrameDecoder, "function");

  const first = requestEnvelope();
  const second = requestEnvelope({
    requestId: "request-2",
    capability: "learning.explain_selection",
    input: { selectedText: "small selection" },
  });
  const firstFrame = encodeFrame(first);
  const secondFrame = encodeFrame(second);
  const decoder = createFrameDecoder();

  assert.deepEqual(decoder.push(firstFrame.subarray(0, 3)), []);
  assert.deepEqual(
    decoder.push(
      Buffer.concat([firstFrame.subarray(3), secondFrame.subarray(0, 7)]),
    ),
    [first],
  );
  assert.deepEqual(decoder.push(secondFrame.subarray(7)), [second]);
});

test("native message decoder rejects oversized and malformed complete frames", () => {
  const { createFrameDecoder } = loadProtocol();

  const oversizedPrefix = Buffer.alloc(4);
  oversizedPrefix.writeUInt32LE(1025, 0);
  assert.throws(
    () => createFrameDecoder({ maxMessageBytes: 1024 }).push(oversizedPrefix),
    /size|large|limit/i,
  );

  const invalidJson = Buffer.from("not-json", "utf8");
  const malformedFrame = Buffer.alloc(4 + invalidJson.byteLength);
  malformedFrame.writeUInt32LE(invalidJson.byteLength, 0);
  invalidJson.copy(malformedFrame, 4);
  assert.throws(
    () => createFrameDecoder().push(malformedFrame),
    /json|message|parse/i,
  );
});
