import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

const need = (value, code) => assert(value, 'china_ssh_' + code);
const hash = raw => createHash('sha256').update(raw).digest('hex');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const methods = new Set(['init', 'upload', 'start', 'functional', 'speed', 'switch', 'browser_evidence', 'accept', 'recover', 'retire', 'retire_recovery', 'close']);

/** A single authenticated, ordered stream. Raw private files never enter JSON
 * logs; host reads exactly the already-approved compressed byte length. */
export class ChinaSshSession {
  constructor(child) {
    this.child = child; this.sequence = 0; this.pending = new Map(); this.buffer = ''; this.closed = false;
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.ready.catch(() => {});
    this.exited = new Promise(resolve => child.once('close', (code, signal) => {
      this.closed = true; this.fail(Error('china_ssh_closed')); resolve({code, signal});
    }));
    child.once('error', () => this.fail(Error('china_ssh_transport')));
    child.stdin.on('error', () => this.fail(Error('china_ssh_input')));
    child.stderr.on('data', () => {});
    child.stdout.on('data', chunk => {
      this.buffer += chunk.toString('utf8');
      if (Buffer.byteLength(this.buffer) > 4 * 1024 * 1024) return this.abort(Error('china_ssh_output_bound'));
      let end;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        try { this.message(JSON.parse(line)); } catch { this.abort(Error('china_ssh_protocol')); }
      }
    });
  }
  fail(error) {
    this.readyReject(error);
    for (const row of this.pending.values()) { clearTimeout(row.timer); row.reject(error); row.readyReject(error); }
    this.pending.clear();
  }
  abort(error = Error('china_ssh_aborted')) { this.fail(error); this.child.stdin.destroy(); this.child.kill('SIGTERM'); }
  async write(raw) {
    const stream = this.child.stdin;
    need(!this.closed && !stream.destroyed && !stream.writableEnded, 'closed');
    // A destroyed pipe need not emit drain or error. Register close before the
    // write, and remove all listeners when this particular chunk is accepted.
    // This keeps a timed-out/disconnected upload from waiting forever and does
    // not retain one pending `exited.then` handler for every streamed chunk.
    await new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        stream.off('drain', drained); stream.off('close', closed); stream.off('error', inputError);
        this.child.off('close', closed); this.child.off('error', transportError);
        if (error) reject(error); else resolve();
      };
      const drained = () => finish();
      const closed = () => finish(Error('china_ssh_closed'));
      const inputError = () => finish(Error('china_ssh_input'));
      const transportError = () => finish(Error('china_ssh_transport'));
      stream.once('drain', drained); stream.once('close', closed); stream.once('error', inputError);
      this.child.once('close', closed); this.child.once('error', transportError);
      try { if (stream.write(raw)) finish(); }
      catch { inputError(); }
    });
  }
  message(value) {
    if (value.kind === 'ready') { need(value.protocol === 1, 'protocol_version'); this.readyResolve(); return; }
    const row = this.pending.get(value.id); need(row, 'reply_id');
    if (value.kind === 'upload-ready') { row.readyResolve(); return; }
    clearTimeout(row.timer); this.pending.delete(value.id);
    if (value.kind === 'result') { row.resolve(value.value); row.readyResolve(false); }
    else if (value.kind === 'error') {
      const error = Error(/^china_host_[a-z0-9_]+$/.test(value.code ?? '') ? value.code : 'china_ssh_remote_error');
      row.reject(error); row.readyReject(error);
    } else throw Error('china_ssh_reply_kind');
  }
  request(method, params = {}) {
    need(methods.has(method) && this.pending.size === 0, 'request_order');
    const id = ++this.sequence;
    let resolve, reject, readyResolve, readyReject;
    const result = new Promise((yes, no) => { resolve = yes; reject = no; }); result.catch(() => {});
    const ready = new Promise((yes, no) => { readyResolve = yes; readyReject = no; }); ready.catch(() => {});
    const timeout = method === 'speed' ? 1600000 : method === 'start' ? 1200000 : method === 'upload' ? 1800000 : 300000;
    const timer = setTimeout(() => this.abort(Error('china_ssh_' + method + '_timeout')), timeout);
    this.pending.set(id, {resolve, reject, readyResolve, readyReject, timer});
    this.write(Buffer.from(JSON.stringify({id, method, params}) + '\n')).catch(error => this.abort(error));
    return {result, ready};
  }
  call(method, params) { return this.request(method, params).result; }
  async upload(name, filename) {
    const call = this.request('upload', {name});
    const begun = await Promise.race([call.ready, call.result.then(() => false)]);
    if (begun !== false) for await (const raw of createReadStream(filename, {highWaterMark: 128 * 1024})) await this.write(raw);
    return call.result;
  }
  async close() { const value = await this.call('close'); this.child.stdin.end(); const exit = await this.exited; need(exit.code === 0, 'exit'); return value; }
}

export async function openChinaSshSession({root, directory, privateKey = process.env.SSH_PRIVATE_KEY, spawnImpl = spawn}) {
  const known = path.join(root, 'docs/operations/regcloud-staging-known-hosts');
  need(hash(await fs.readFile(known)) === 'fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c', 'host_pin');
  const key = path.join(directory, 'ssh-key');
  need(typeof privateKey === 'string' && privateKey.length > 0, 'key_missing');
  await fs.writeFile(key, privateKey + '\n', {mode: 0o600, flag: 'wx'}); delete process.env.SSH_PRIVATE_KEY;
  const program = await fs.readFile(path.join(root, 'scripts/catalog-next/release-host.py'));
  const bootstrap = `import hashlib,sys;raw=sys.stdin.buffer.read(${program.length});assert len(raw)==${program.length};assert hashlib.sha256(raw).hexdigest()=='${hash(program)}';exec(compile(raw,'<exact-china-controller>','exec'))`;
  const command = '/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -B -c ' + quote(bootstrap);
  const args = ['-F', '/dev/null', '-T', '-i', key, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
    '-o', 'ForwardAgent=no', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + known,
    '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=10',
    '-o', 'ClearAllForwardings=yes', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3',
    'root@151.248.113.177', command];
  const child = spawnImpl('/usr/bin/ssh', args, {env: {PATH: '/usr/bin:/bin', LANG: 'C.UTF-8'}, stdio: ['pipe', 'pipe', 'pipe']});
  const session = new ChinaSshSession(child);
  const timeout = setTimeout(() => session.abort(Error('china_ssh_start_timeout')), 30000);
  try { await session.write(program); await session.ready; return session; }
  catch (error) { session.abort(error); throw error; }
  finally { clearTimeout(timeout); await fs.rm(key, {force: true}); }
}
