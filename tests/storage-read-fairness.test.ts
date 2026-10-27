import test from 'node:test';
import assert from 'node:assert/strict';
import {readObjectStorageResponseBody} from '../apps/web/lib/data';

test('buffered object transfer lets unrelated event-loop work run before completion', async () => {
  const chunk = Buffer.alloc(64 * 1024, 0x51);
  let produced = 0, heartbeat = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk);
      if (++produced === 128) controller.close();
    },
  }));
  const timer = setImmediate(() => { heartbeat = true; });
  try {
    const bytes = await readObjectStorageResponseBody(response, 3000);
    assert.equal(bytes.length, 8 * 1024 * 1024);
    assert.ok(bytes.every(value => value === 0x51), 'transfer stays lossless');
    assert.equal(heartbeat, true, 'a ready stream must not monopolize the event loop');
  } finally { clearImmediate(timer); }
});

test('fairness does not extend the transfer deadline or return a partial object', async () => {
  let produced = 0, cancelled = false;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (produced++ < 32) controller.enqueue(new Uint8Array(64 * 1024));
    },
    cancel() { cancelled = true; },
  }));
  await assert.rejects(readObjectStorageResponseBody(response, 30), /object_storage_response_timeout/);
  assert.equal(cancelled, true);
});
