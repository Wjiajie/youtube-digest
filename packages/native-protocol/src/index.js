"use strict";

const PROTOCOL_VERSION = 1;
const DEFAULT_MAX_MESSAGE_BYTES = 1024 * 1024;
const CAPABILITIES = Object.freeze([
  "blueprint.plan",
  "learning.analyze_video",
  "learning.explain_selection",
  "learning.polish_note",
  "learning.translate_transcript_batch",
]);
const CAPABILITY_SET = new Set(CAPABILITIES);
const CONTROL_TYPES = new Set(["session.open", "session.close", "agent.abort"]);

function requireNonEmptyString(value, name, maxLength = 256) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength
  ) {
    throw new Error(`${name} must be a non-empty string`);
  }
}

function validateEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    throw new Error("Native message must be an object");
  }
  if (envelope.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error(`Unsupported protocol version: ${envelope.protocolVersion}`);
  }
  requireNonEmptyString(envelope.requestId, "requestId");
  requireNonEmptyString(envelope.sessionId, "sessionId");

  const isControl = CONTROL_TYPES.has(envelope.type);
  if (envelope.type !== "request" && envelope.type !== "event" && !isControl) {
    throw new Error(`Unsupported message type: ${String(envelope.type)}`);
  }
  const isSessionEvent =
    envelope.type === "event" &&
    typeof envelope.input?.kind === "string" &&
    envelope.input.kind.startsWith("session.");
  if (!isControl && !isSessionEvent && !CAPABILITY_SET.has(envelope.capability)) {
    throw new Error(`Unsupported capability: ${String(envelope.capability)}`);
  }
  if (
    envelope.input === null ||
    typeof envelope.input !== "object" ||
    Array.isArray(envelope.input)
  ) {
    throw new Error("input must be an object");
  }
  if (
    envelope.type === "event" &&
    (!Number.isSafeInteger(envelope.seq) || envelope.seq < 0)
  ) {
    throw new Error("event seq must be a non-negative integer");
  }
  return envelope;
}

function encodeFrame(message, { maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES } = {}) {
  validateEnvelope(message);
  const body = Buffer.from(JSON.stringify(message), "utf8");
  if (body.byteLength > maxMessageBytes) {
    throw new Error(`Native message exceeds the ${maxMessageBytes} byte size limit`);
  }
  const frame = Buffer.allocUnsafe(4 + body.byteLength);
  frame.writeUInt32LE(body.byteLength, 0);
  body.copy(frame, 4);
  return frame;
}

function createFrameDecoder({ maxMessageBytes = DEFAULT_MAX_MESSAGE_BYTES } = {}) {
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 1) {
    throw new Error("maxMessageBytes must be a positive integer");
  }
  let buffered = Buffer.alloc(0);
  const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

  return {
    push(chunk) {
      if (!(chunk instanceof Uint8Array)) {
        throw new Error("Native message chunk must be bytes");
      }
      buffered = Buffer.concat([buffered, Buffer.from(chunk)]);
      const messages = [];

      while (buffered.byteLength >= 4) {
        const bodyLength = buffered.readUInt32LE(0);
        if (bodyLength < 1 || bodyLength > maxMessageBytes) {
          buffered = Buffer.alloc(0);
          throw new Error(
            `Native message size ${bodyLength} exceeds the ${maxMessageBytes} byte limit`,
          );
        }
        if (buffered.byteLength < bodyLength + 4) break;

        const body = buffered.subarray(4, bodyLength + 4);
        buffered = buffered.subarray(bodyLength + 4);
        let parsed;
        try {
          parsed = JSON.parse(utf8Decoder.decode(body));
        } catch (error) {
          buffered = Buffer.alloc(0);
          throw new Error(`Invalid native message JSON or UTF-8: ${error.message}`);
        }
        messages.push(validateEnvelope(parsed));
      }

      return messages;
    },
  };
}

module.exports = {
  CAPABILITIES,
  DEFAULT_MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  createFrameDecoder,
  encodeFrame,
  validateEnvelope,
};
