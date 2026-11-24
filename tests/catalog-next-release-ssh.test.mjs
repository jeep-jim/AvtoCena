import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import {ChinaSshSession} from '../scripts/catalog-next/release-ssh.mjs';

function childWithInput(t, write) {
  const child = new EventEmitter();
  child.stdin = new Writable({highWaterMark: 1, write});
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => {
    if (!child.killed) { child.killed = true; queueMicrotask(() => child.emit('close', null, 'SIGTERM')); }
    return true;
  };
  const session = new ChinaSshSession(child);
  t.after(() => session.abort());
  return {child, session};
}

test('abort rejects a write waiting for drain even when the pipe closes without error', {timeout: 2000}, async t => {
  const {child, session} = childWithInput(t, (_raw, _encoding, _callback) => {});
  const pending = session.write(Buffer.from('backpressured bytes'));
  const rejected = assert.rejects(pending, /china_ssh_closed/);
  session.abort(); await session.exited; await rejected;
  assert.equal(child.stdin.destroyed, true);
  assert.equal(child.stdin.listenerCount('drain'), 0);
  assert.equal(child.stdin.listenerCount('close'), 0);
  await assert.rejects(session.write(Buffer.from('late write')), /china_ssh_closed/);
});

test('a real streamed upload rejects after transport closes during a blocked body write', {timeout: 2000}, async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'china-ssh-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const filename = path.join(directory, 'details.sqlite.gz');
  await fs.writeFile(filename, Buffer.alloc(8192, 1));
  let started, request;
  const bodyStarted = new Promise(resolve => { started = resolve; });
  const {child, session} = childWithInput(t, (raw, _encoding, callback) => {
    if (!request) {
      request = JSON.parse(raw);
      queueMicrotask(() => {
        child.stdout.write(JSON.stringify({kind: 'upload-ready', id: request.id}) + '\n');
        callback();
      });
    } else {
      assert.equal(raw.length, 8192);
      started(); // Keep this callback pending to simulate a full SSH pipe.
    }
  });
  const uploading = session.upload('details.sqlite', filename);
  const rejected = assert.rejects(uploading, /china_ssh_closed/);
  await bodyStarted;
  // A remote close alone is sufficient; no local stdin error/drain is needed.
  child.emit('close', 255, null);
  await rejected;
  assert.equal(session.pending.size, 0);
  assert.equal(child.stdin.listenerCount('drain'), 0);
  assert.equal(child.stdin.listenerCount('close'), 0);
});

test('normal backpressure drains and removes only the temporary listeners', {timeout: 2000}, async t => {
  let release;
  const {child, session} = childWithInput(t, (_raw, _encoding, callback) => { release = callback; });
  const writes = 25;
  for (let i = 0; i < writes; i++) {
    const pending = session.write(Buffer.from('ordinary bytes'));
    assert.equal(child.stdin.listenerCount('drain'), 1);
    release(); await pending;
    assert.equal(child.stdin.listenerCount('drain'), 0);
    assert.equal(child.stdin.listenerCount('close'), 0);
    assert.equal(child.stdin.listenerCount('error'), 1); // Session's permanent error observer.
    assert.equal(child.listenerCount('close'), 1);
  }
});

test('a pipe error rejects the pending write with a safe code', {timeout: 2000}, async t => {
  const {child, session} = childWithInput(t, (_raw, _encoding, _callback) => {});
  const pending = session.write(Buffer.from('blocked'));
  const rejected = assert.rejects(pending, error => error.message === 'china_ssh_input');
  child.stdin.destroy(Error('private transport diagnostic must not escape'));
  await rejected;
  assert.equal(child.stdin.listenerCount('drain'), 0);
});
