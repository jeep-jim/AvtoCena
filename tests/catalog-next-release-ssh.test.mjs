import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import {ChinaSshSession, checkedTerminalAppImageCleanupReport, terminalAppImageCleanupPending} from '../scripts/catalog-next/release-ssh.mjs';

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

function imageResult(overrides = {}) {
  return {version: 1, kind: 'china-terminal-app-image-cleanup-v1', completed: true, status: 'removed',
    uncertain: false, imagesRemoved: 1, runtimeSha: 'a'.repeat(40), imageId: 'sha256:' + 'b'.repeat(64),
    witnessSha256: 'c'.repeat(64), diskFreeBytesBefore: 100, diskFreeBytesAfter: 175,
    measuredFreeBytesChange: 75, reason: 'exact_terminal_image', ...overrides};
}

test('terminal image success copier requires completed evidence and measures df independently of image size', () => {
  const valid = imageResult();
  assert.deepEqual(checkedTerminalAppImageCleanupReport(valid), valid);
  assert.equal(Object.isFrozen(checkedTerminalAppImageCleanupReport(valid)), true);
  for (const patch of [{completed: false}, {uncertain: true}, {status: 'pending'}, {imagesRemoved: 0},
    {diskFreeBytesBefore: -1}, {diskFreeBytesAfter: Number.MAX_SAFE_INTEGER + 1}, {measuredFreeBytesChange: 1},
    {reason: 'raw private diagnostic'}, {witnessSha256: 'not-a-hash'}, {runtimeSha: null}, {sql: 'private'}]) {
    assert.throws(() => checkedTerminalAppImageCleanupReport({...valid, ...patch}), /china_ssh_app_image_report/);
  }
  for (const reason of ['current_or_rollback', 'container_reference', 'pinned_image', 'retained_bootstrap', 'ineligible_image']) {
    assert.equal(checkedTerminalAppImageCleanupReport(imageResult({status: 'protected', imagesRemoved: 0, reason})).reason, reason);
  }
  assert.equal(checkedTerminalAppImageCleanupReport(imageResult({diskFreeBytesAfter: 70, measuredFreeBytesChange: -30})).imagesRemoved, 1);
  let reads = 0;
  const accessor = {...valid}; Object.defineProperty(accessor, 'reason', {enumerable: true, get() { reads++; return 'exact_terminal_image'; }});
  assert.throws(() => checkedTerminalAppImageCleanupReport(accessor)); assert.equal(reads, 0);
});

test('terminal image pending projection is bounded and does not invoke or echo remote getters/messages', () => {
  const pending = {version: 1, kind: 'china-terminal-app-image-cleanup-v1', completed: false,
    status: 'pending', uncertain: true, errorCode: 'delete_not_confirmed'};
  assert.deepEqual(terminalAppImageCleanupPending({appImageCleanup: pending}), pending);
  const fallback = terminalAppImageCleanupPending(Error('private source URL and token'));
  assert.equal(fallback.errorCode, 'operation_failed'); assert.equal(fallback.uncertain, true);
  let reads = 0;
  const accessor = Object.defineProperty({}, 'appImageCleanup', {get() { reads++; throw Error('private'); }});
  assert.deepEqual(terminalAppImageCleanupPending(accessor), fallback); assert.equal(reads, 0);
  for (const value of [null, {...pending, extra: 'private'}, {...pending, completed: true}, {...pending, errorCode: 'private-url'}]) {
    assert.deepEqual(terminalAppImageCleanupPending({appImageCleanup: value}), fallback);
  }
});

test('the exact terminal-image RPC preserves only its safe pending receipt on a failed DELETE', async t => {
  const pending = {version: 1, kind: 'china-terminal-app-image-cleanup-v1', completed: false,
    status: 'pending', uncertain: true, errorCode: 'delete_not_confirmed'};
  const {child, session} = childWithInput(t, (raw, _encoding, callback) => {
    const request = JSON.parse(raw);
    assert.equal(request.method, 'retire_terminal_app_image');
    queueMicrotask(() => {
      child.stdout.write(JSON.stringify({kind: 'error', id: request.id, code: 'china_host_app_image_delete_reply',
        appImageCleanup: pending, unrelated: 'private'}) + '\n');
      callback();
    });
  });
  await assert.rejects(session.call('retire_terminal_app_image', {action: 'remove'}), error => {
    assert.equal(error.message, 'china_host_app_image_delete_reply');
    assert.deepEqual(error.appImageCleanup, pending); assert.equal(Object.hasOwn(error, 'unrelated'), false); return true;
  });
});
