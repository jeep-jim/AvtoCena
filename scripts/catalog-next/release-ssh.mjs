import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';

const need = (value, code) => assert(value, 'china_ssh_' + code);
const hash = raw => createHash('sha256').update(raw).digest('hex');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const methods = new Set(['init', 'resume_init', 'upload', 'start', 'functional', 'speed', 'switch', 'browser_evidence', 'accept', 'recover', 'diagnose', 'retire', 'retire_recovery', 'prune_failed_uploads', 'prune_failed_witness', 'prune_resolved_failed_uploads', 'close']);

export function checkedStartupReport(value) {
  const keys = ['version', 'kind', 'ready', 'elapsedSeconds', 'attempts', 'health', 'candidate', 'reason'];
  const exact = (row, expected) => row && typeof row === 'object' && !Array.isArray(row)
    && JSON.stringify(Object.keys(row).sort()) === JSON.stringify([...expected].sort());
  need(exact(value, keys) && value.version === 1 && value.kind === 'china-host-startup-v1' && typeof value.ready === 'boolean'
    && Number.isFinite(value.elapsedSeconds) && value.elapsedSeconds >= 0 && value.elapsedSeconds <= 3600
    && Number.isSafeInteger(value.attempts) && value.attempts >= 0 && value.attempts <= 10000
    && ['not_checked', 'ok', 'connection_refused', 'timeout', 'invalid_json', 'identity_mismatch', 'http_response', 'connection_error', 'unavailable'].includes(value.health)
    && ['ready', 'timeout', 'exited', 'oom', 'restarted', 'inspect_unavailable'].includes(value.reason)
    && value.ready === (value.reason === 'ready') && (!value.ready || value.health === 'ok'), 'startup_report');
  const candidate = value.candidate;
  need(candidate === null || (exact(candidate, ['running', 'status', 'exitCode', 'oomKilled', 'restartCount'])
    && typeof candidate.running === 'boolean' && typeof candidate.oomKilled === 'boolean'
    && ['created', 'restarting', 'running', 'removing', 'paused', 'exited', 'dead'].includes(candidate.status)
    && Number.isSafeInteger(candidate.exitCode) && Math.abs(candidate.exitCode) <= 2147483647
    && Number.isSafeInteger(candidate.restartCount) && candidate.restartCount >= 0 && candidate.restartCount <= 10000), 'startup_report');
  return value;
}

export function checkedRetainedFenceReport(value) {
  const keys = ['version', 'kind', 'ingressChanged', 'changedFields', 'mountOrderOnly',
    'beforePid', 'afterPid', 'beforeStartedAt', 'afterStartedAt'];
  const fields = ['Id', 'Image', 'Config', 'HostConfig', 'Mounts', 'Pid', 'StartedAt', 'RestartCount', 'Running'];
  need(value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(keys.sort())
    && value.version === 1 && value.kind === 'china-host-retained-fence-v1'
    && typeof value.ingressChanged === 'boolean' && typeof value.mountOrderOnly === 'boolean'
    && Array.isArray(value.changedFields) && value.changedFields.length <= fields.length
    && new Set(value.changedFields).size === value.changedFields.length && value.changedFields.every(key => fields.includes(key))
    && [value.beforePid,value.afterPid].every(pid => pid === null || Number.isSafeInteger(pid) && pid >= 0 && pid <= 2147483647)
    && [value.beforeStartedAt,value.afterStartedAt].every(time => time === null || typeof time === 'string'
      && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(time)), 'retained_fence_report');
  return value;
}

/** Only the public paths in the frozen server baseline, plus the scoped China
 * route, may cross the SSH/report boundary. No raw output or exception text. */
export function checkedServerSpeedReport(value) {
  const paths = new Set(['/', '/api/health', '/api/leads', '/autocalc', '/cars', '/login',
    '/cars/autocatalog', '/cars/autocatalog?make=Changan', '/cars?sort=totalRub',
    '/cars?market=china', '/cars?market=china&make=Volkswagen&page=2', '/cars?market=europe&make=BMW&page=2',
    '/cars?market=china&city=%D0%9D%D0%BE%D0%B2%D0%BE%D0%BA%D1%83%D0%B7%D0%BD%D0%B5%D1%86%D0%BA',
    '/api/catalog/search?market=europe&make=BMW&page=2', '/api/catalog/search?market=china&marketPage=1&page=9',
    '/api/catalog/search?market=china&budgetTo=1500000&pageSize=6',
    '/cars/china/BMW/3%20SERIES?powerTo=160&sort=totalRub', '/cars/china/BMW/3?powerTo=160&sort=totalRub']);
  const phases = new Set(['warm', 'after_ttl', 'after_directory_ttl']);
  const errors = new Set(['AssertionError', 'HTTPError', 'URLError', 'TimeoutError', 'JSONDecodeError', 'RemoteDisconnected',
    'IncompleteRead', 'ConnectionResetError', 'ConnectionRefusedError', 'ValueError', 'KeyError', 'TypeError',
    'OSError', 'SSLError', 'UnicodeDecodeError', 'other']);
  const exact = (row, keys) => row !== null && typeof row === 'object' && !Array.isArray(row)
    && Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key));
  const natural = number => Number.isSafeInteger(number) && number >= 0;
  const seconds = number => Number.isFinite(number) && number >= 0 && number <= 86400;
  const boolean = number => typeof number === 'boolean';
  const valid = condition => need(condition, 'server_speed_report');
  valid(exact(value, ['present', 'sha256', 'exitCode', 'samples', 'rejectedSamples']) && boolean(value.present)
    && Array.isArray(value.samples) && natural(value.rejectedSamples) && value.samples.length + value.rejectedSamples <= 512);
  if (!value.present) {
    valid(value.sha256 === null && value.exitCode === null && value.samples.length === 0 && value.rejectedSamples === 0);
  } else {
    valid(typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256)
      && Number.isSafeInteger(value.exitCode) && Math.abs(value.exitCode) <= 255);
    for (const row of value.samples) {
      valid(row !== null && typeof row === 'object' && !Array.isArray(row));
      if (row.performanceGate === 'summary') {
        valid(exact(row, ['performanceGate', 'marketScope', 'routes', 'acceptedBaselineRoutes', 'samples', 'slowSamples',
          'functionalPassed', 'performanceAccepted', 'latencyBlocking', 'acceptedBaselineEnforced']) && row.marketScope === 'china'
          && ['routes', 'acceptedBaselineRoutes'].every(key => Array.isArray(row[key]) && row[key].length <= 64 && row[key].every(route => paths.has(route)))
          && ['samples', 'slowSamples'].every(key => natural(row[key]) && row[key] <= 10000)
          && ['functionalPassed', 'performanceAccepted', 'latencyBlocking', 'acceptedBaselineEnforced'].every(key => boolean(row[key])));
        continue;
      }
      valid(paths.has(row.path));
      if (row.performanceRequest === 'started') {
        valid(exact(row, ['performanceRequest', 'path']));
      } else if (row.performanceRequest === 'complete') {
        valid(exact(row, ['performanceRequest', 'path', 'seconds', 'functionalPassed']) && seconds(row.seconds) && boolean(row.functionalPassed));
      } else if (row.performanceRequest === 'failed') {
        valid(exact(row, ['performanceRequest', 'path', 'seconds', 'errorType']) && seconds(row.seconds) && errors.has(row.errorType));
      } else if (phases.has(row.speedBaseline)) {
        const keys = ['speedBaseline', 'path', 'referenceSeconds', 'measurementNoiseSeconds', 'ceilingSeconds', 'seconds', 'blocking', 'passed'];
        if (Object.hasOwn(row, 'recheckSeconds') || Object.hasOwn(row, 'recheckMedianSeconds')) {
          keys.push('recheckSeconds', 'recheckMedianSeconds');
          valid(Array.isArray(row.recheckSeconds) && row.recheckSeconds.length === 3 && row.recheckSeconds.every(seconds) && seconds(row.recheckMedianSeconds));
        }
        valid(exact(row, keys) && ['referenceSeconds', 'measurementNoiseSeconds', 'ceilingSeconds', 'seconds'].every(key => seconds(row[key]))
          && boolean(row.blocking) && boolean(row.passed));
      } else if (phases.has(row.performanceGate)) {
        valid(exact(row, ['performanceGate', 'path', 'seconds', 'ceiling', 'passed', 'functionalPassed', 'latencyBlocking'])
          && seconds(row.seconds) && seconds(row.ceiling) && ['passed', 'functionalPassed', 'latencyBlocking'].every(key => boolean(row[key])));
      } else valid(false);
    }
  }
  const raw = JSON.stringify(value); valid(Buffer.byteLength(raw) <= 256 * 1024);
  return JSON.parse(raw);
}

/** Optional observations from the existing gate, never an acceptance verdict. */
export function checkedHomePhaseTimingReport(value, binding) {
  const exact = (row, keys) => row !== null && typeof row === 'object' && !Array.isArray(row)
    && Object.keys(row).length === keys.length && keys.every(key => Object.hasOwn(row, key));
  const natural = number => Number.isSafeInteger(number) && number >= 0;
  const phases = new Set(['dealer', 'snapshot', 'counts', 'green', 'greenPricing', 'catalogPricing', 'dealerRail', 'japanRail',
    'snapshotContext', 'snapshotBody', 'snapshotPrepared', 'snapshotManifest', 'snapshotOverview', 'snapshotProjection',
    'snapshotEditorialPrepared', ...['china', 'japan', 'korea', 'uae', 'europe', 'georgia'].map(market => 'snapshotEditorial:' + market)]);
  const date = text => typeof text === 'string' && /^\d{4}-\d\d-\d\d$/.test(text)
    && Number.isFinite(Date.parse(text)) && new Date(text).toISOString().slice(0, 10) === text && !text.startsWith('0000-');
  const valid = condition => need(condition, 'home_phase_timing_report');
  valid(exact(value, ['version', 'kind', 'runtimeSha', 'nonce', 'logBytes', 'logLines', 'rejectedRows', 'limited', 'rows'])
    && value.version === 1 && value.kind === 'china-home-phase-timing-v1'
    && typeof value.runtimeSha === 'string' && /^[a-f0-9]{40}$/.test(value.runtimeSha)
    && typeof value.nonce === 'string' && /^[a-f0-9]{32}$/.test(value.nonce)
    && natural(value.logBytes) && value.logBytes <= 512 * 1024 && natural(value.logLines) && value.logLines <= 2048
    && natural(value.rejectedRows) && typeof value.limited === 'boolean' && Array.isArray(value.rows)
    && value.rows.length <= 512 && value.rows.length + value.rejectedRows <= value.logLines);
  if (binding !== undefined) valid(value.runtimeSha === binding.runtimeSha && value.nonce === binding.nonce);
  for (const row of value.rows) {
    const keys = ['trace', 'phase', 'ms', 'ok', 'policyDate', 'completedPolicyDate'];
    if (row !== null && typeof row === 'object' && Object.hasOwn(row, 'generation')) {
      keys.push('generation');
      valid(typeof row.generation === 'string' && /^gen_[0-9]{1,20}_[a-z0-9-]{1,80}$/.test(row.generation));
    }
    valid(exact(row, keys) && typeof row.trace === 'string'
      && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(row.trace)
      && phases.has(row.phase) && Number.isFinite(row.ms) && row.ms >= 0 && row.ms <= 86400000
      && typeof row.ok === 'boolean' && date(row.policyDate) && date(row.completedPolicyDate));
  }
  const raw = JSON.stringify(value); valid(Buffer.byteLength(raw) <= 256 * 1024);
  return JSON.parse(raw);
}

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
    const startup = value.kind === 'error' && value.startup !== undefined ? checkedStartupReport(value.startup) : undefined;
    const retainedFence = value.kind === 'error' && value.retainedFence !== undefined ? checkedRetainedFenceReport(value.retainedFence) : undefined;
    clearTimeout(row.timer); this.pending.delete(value.id);
    if (value.kind === 'result') {
      let result = value.value;
      if (row.method === 'speed' && result && typeof result === 'object' && Object.hasOwn(result, 'homePhaseTiming')) {
        const {homePhaseTiming, ...safe} = result;
        try { safe.homePhaseTiming = checkedHomePhaseTimingReport(homePhaseTiming); } catch {}
        result = safe;
      }
      row.resolve(result); row.readyResolve(false);
    }
    else if (value.kind === 'error') {
      const error = Error(/^china_host_[a-z0-9_]+$/.test(value.code ?? '') ? value.code : 'china_ssh_remote_error');
      if (startup !== undefined) error.startup = startup;
      if (retainedFence !== undefined) error.retainedFence = retainedFence;
      if (value.serverSpeed !== undefined) {
        // Optional evidence can be omitted when malformed. Keep the original
        // authenticated gate failure so rollback/recovery behavior is unchanged.
        try { error.serverSpeed = checkedServerSpeedReport(value.serverSpeed); } catch {}
      }
      if (value.homePhaseTiming !== undefined) {
        try { error.homePhaseTiming = checkedHomePhaseTimingReport(value.homePhaseTiming); } catch {}
      }
      row.reject(error); row.readyReject(error);
    } else throw Error('china_ssh_reply_kind');
  }
  request(method, params = {}) {
    need(methods.has(method) && this.pending.size === 0, 'request_order');
    const id = ++this.sequence;
    let resolve, reject, readyResolve, readyReject;
    const result = new Promise((yes, no) => { resolve = yes; reject = no; }); result.catch(() => {});
    const ready = new Promise((yes, no) => { readyResolve = yes; readyReject = no; }); ready.catch(() => {});
    const timeout = method === 'speed' ? 1600000 : method === 'start' ? 1200000 : ['upload', 'resume_init', 'prune_failed_uploads', 'prune_failed_witness', 'prune_resolved_failed_uploads'].includes(method) ? 1800000 : 300000;
    const timer = setTimeout(() => this.abort(Error('china_ssh_' + method + '_timeout')), timeout);
    this.pending.set(id, {method, resolve, reject, readyResolve, readyReject, timer});
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
