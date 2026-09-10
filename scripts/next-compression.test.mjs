// Real installed Next response piping + compression over loopback HTTP.
// No app, account, credentials, model fixtures or warning suppression.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, get } from "node:http";
import { Readable } from "node:stream";
import { gunzipSync, inflateSync } from "node:zlib";
import compression from "next/dist/compiled/compression/index.js";
import { pipeNodeReadableToNodeResponse } from "next/dist/server/pipe-readable.js";

test("large compressed responses preserve every byte without accumulating drain listeners", { timeout: 10_000 }, async () => {
  const warnings = [];
  const record = warning => { if (warning.name === "MaxListenersExceededWarning") warnings.push(warning.message); };
  process.on("warning", record);
  const payload = Buffer.alloc(128 * 16_384, 65);
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.setHeader("Cache-Control", "private, no-store");
    compression({ threshold: 0 })(request, response, () => {
      const stream = Readable.from(Array.from({ length: 128 }, () => Buffer.alloc(16_384, 65)));
      void pipeNodeReadableToNodeResponse(stream, response).catch(error => response.destroy(error));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    for (const encoding of ["identity", "gzip", "deflate", "gzip"]) {
      const result = await new Promise((resolve, reject) => {
        get(`http://127.0.0.1:${server.address().port}`, { headers: { "accept-encoding": encoding } }, response => {
          const chunks = [];
          response.on("data", chunk => chunks.push(chunk)); response.on("error", reject);
          response.on("end", () => resolve({ body: Buffer.concat(chunks), headers: response.headers }));
        }).on("error", reject);
      });
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(result.headers["content-encoding"], encoding === "identity" ? undefined : encoding);
      assert.equal(result.headers["cache-control"], "private, no-store");
      assert.deepEqual(encoding === "gzip" ? gunzipSync(result.body) : encoding === "deflate" ? inflateSync(result.body) : result.body, payload);
      assert.deepEqual(warnings, [], "A single response must not accumulate one listener per backpressure cycle");
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    process.off("warning", record);
  }
});

for (const phase of ["before headers", "after headers"]) test(`drain once/off/removeListener preserve semantics ${phase}`, { timeout: 10_000 }, async () => {
  let removedCalls = 0, onceCalls = 0, finishCalls = 0;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    compression({ threshold: 0 })(request, response, () => {
      if (phase === "after headers") response.flushHeaders();
      const removed = () => removedCalls++;
      response.once("drain", removed);
      assert.equal(response.off("drain", removed), response);
      response.on("drain", removed);
      assert.equal(response.removeListener("drain", removed), response);
      response.once("drain", () => onceCalls++);
      response.once("finish", () => finishCalls++);
      assert.throws(() => response.removeListener("drain", null), TypeError);
      void pipeNodeReadableToNodeResponse(Readable.from(Array.from({ length: 16 }, () => Buffer.alloc(65_536))), response).catch(error => response.destroy(error));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await new Promise((resolve, reject) => {
      get(`http://127.0.0.1:${server.address().port}`, { headers: { "accept-encoding": "gzip" } }, response => {
        response.resume(); response.on("end", resolve); response.on("error", reject);
      }).on("error", reject);
    });
    assert.equal(removedCalls, 0);
    assert.equal(onceCalls, 1);
    assert.equal(finishCalls, 1);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test("disconnecting a compressed response releases its upstream producer", { timeout: 10_000 }, async () => {
  let released;
  let produced = 0;
  const producerReleased = new Promise(resolve => { released = resolve; });
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    compression({ threshold: 0 })(request, response, () => {
      const source = Readable.from((async function* () {
        try {
          for (let index = 0; index < 128; index++) {
            produced++;
            yield Buffer.alloc(65_536, 65);
            await new Promise(resolve => setTimeout(resolve, 2));
          }
        } finally { released(); }
      })());
      void pipeNodeReadableToNodeResponse(source, response).catch(error => response.destroy(error));
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await new Promise((resolve, reject) => {
      get(`http://127.0.0.1:${server.address().port}`, { headers: { "accept-encoding": "gzip" } }, response => {
        response.once("data", () => { response.destroy(); resolve(); });
        response.on("error", reject);
      }).on("error", reject);
    });
    await producerReleased;
    assert.ok(produced < 128, "Disconnect must cancel the producer, not wait for its natural completion");
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test("removing a pre-compression transport listener still targets the response", { timeout: 10_000 }, async () => {
  let calls = 0;
  const server = createServer((request, response) => {
    const listener = () => calls++;
    response.on("drain", listener);
    response.setHeader("Content-Type", "text/html");
    compression({ threshold: 0 })(request, response, () => {
      response.flushHeaders();
      response.off("drain", listener);
      response.emit("drain");
      response.end("response complete");
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await new Promise((resolve, reject) => {
      get(`http://127.0.0.1:${server.address().port}`, { headers: { "accept-encoding": "gzip" } }, response => {
        response.resume(); response.on("end", resolve); response.on("error", reject);
      }).on("error", reject);
    });
    assert.equal(calls, 0);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
