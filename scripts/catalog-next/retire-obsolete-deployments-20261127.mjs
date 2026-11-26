import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {createChinaStateStorage, createChinaState, inspectChinaPublicationState} from './china-state.mjs';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PYTHON = 'scripts/catalog-next/retire-obsolete-deployments-20261127.py';
export const MARKER = '.github/market-runs/catalog-next-obsolete-deployments-20261127-retire.json';
export const REPORT = 'catalog-next-obsolete-deployments-20261127-retire-report.json';
export const OPERATION = 'retire-exact-obsolete-deployments-20261127';
const WORKFLOW = 'jeep-jim/AvtoCena/.github/workflows/catalog-next-obsolete-deployments-20261127-retire.yml@refs/heads/main';
const CURRENT = '077cbb17626ab0c64e7f06db055fef9252ad21c0', ROLLBACK = '36c7ea726e7f070d10dbc65afc6538f13c0c1a24';
const HOST_KEY_SHA = 'fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c';
const hash = value => createHash('sha256').update(value).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const encoded = value => JSON.stringify(ordered(value));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) => object(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',');
const same = (left, right) => left.found === right.found && left.etag === right.etag && left.sha256 === right.sha256;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const need = (value, code) => { if (!value) throw Error('obsolete_retirement_' + code); };
const SAFE = new Set(['arguments', 'workflow', 'privacy', 'state', 'state_changed', 'lease_lost', 'storage_scope',
  'known_host', 'ssh_key', 'transport', 'timeout', 'output', 'protocol', 'remote_refused', 'remote_unknown',
  'preparation', 'step', 'result', 'exit', 'report', 'failed'].map(code => 'obsolete_retirement_' + code));
const safeError = error => SAFE.has(error?.message) ? error.message : 'obsolete_retirement_failed';
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";

export function localDefinition(root = ROOT) {
  return JSON.parse(execFileSync('python3', ['-B', path.join(root, PYTHON), '--verify-targets'],
    {encoding: 'utf8', timeout: 10000, maxBuffer: 32 * 1024, stdio: ['ignore', 'pipe', 'pipe']}));
}

export function verifyInvocation({root = ROOT, environment = process.env} = {}) {
  need(environment.GITHUB_EVENT_NAME === 'push' && environment.GITHUB_WORKFLOW_REF === WORKFLOW
    && environment.GITHUB_JOB === 'retire', 'workflow');
  return verifyReadonlyInvocation({root, env: environment, markerPath: MARKER, operation: OPERATION});
}

/** Native CAS remains available only for the China lease. Neither accepted and
 * intent state nor REG generations/queue/source can be written by this driver. */
export function leaseOnlyStorage({environment = process.env, fetcher = fetch} = {}) {
  const storage = createChinaStateStorage({environment, fetcher});
  return Object.freeze({assertPrivateBucket: () => storage.assertPrivateBucket(), read: name => storage.read(name),
    compareAndSwap(name, previous, value) { need(name === 'lease', 'storage_scope'); return storage.compareAndSwap(name, previous, value); }});
}

export function verifyState(view, definition) {
  need(inspectChinaPublicationState(view).status === 'resolved' && view.accepted.value?.pending === null
    && view.accepted.value.current?.runtimeSha === CURRENT && view.accepted.value.rollback?.runtimeSha === ROLLBACK, 'state');
  for (const name of ['accepted', 'intent']) need(view[name].sha256 === definition.capture[name + 'Sha256']
    && hash(view[name].etag) === definition.capture[name + 'ETagSha256'], 'state_changed');
  for (const name of ['current', 'rollback']) need(hash(encoded(view.accepted.value[name])) === definition.referenceSha256[name], 'state');
}

export function copyReply(value, phase, plan, index, prepared, steps = []) {
  if (keys(value, ['kind', 'errorCode', 'uncertain']) && value.kind === 'obsolete-deployments-retirement-refused-v1'
    && typeof value.uncertain === 'boolean') {
    const error = Error(value.uncertain ? 'obsolete_retirement_remote_unknown' : 'obsolete_retirement_remote_refused');
    error.uncertain = value.uncertain; throw error;
  }
  const {definition, definitionSha256} = plan;
  if (phase === 'prepare') {
    need(keys(value, ['kind', 'captureReportSha256', 'definitionSha256', 'targets', 'alreadyAbsentContainers', 'imagesPreserved', 'diskAvailableBytes'])
      && value.kind === 'obsolete-deployments-retirement-prepared-v1'
      && value.captureReportSha256 === definition.capture.reportSha256 && value.definitionSha256 === definitionSha256
      && encoded(value.targets) === encoded(definition.targets)
      && integer(value.alreadyAbsentContainers) && value.alreadyAbsentContainers <= 2
      && integer(value.imagesPreserved) && value.imagesPreserved > 0 && integer(value.diskAvailableBytes), 'preparation');
  } else if (phase === 'retire') {
    const target = definition.targets[index];
    need(keys(value, ['kind', 'index', 'name', 'containerId', 'retiredContainers', 'filesDeleted', 'verifiedContentBytesDeleted',
      'diskAvailableBytesBefore', 'diskAvailableBytesAfter', 'measuredFreeBytesChange', 'allTargetBulkAbsent', 'proofsPreserved', 'imagesDeleted', 'directoriesDeleted'])
      && value.kind === 'obsolete-deployment-retired-v1' && value.index === index && value.name === target.name && value.containerId === target.containerId
      && [0, 1].includes(value.retiredContainers) && integer(value.filesDeleted) && value.filesDeleted <= target.files
      && integer(value.verifiedContentBytesDeleted) && value.verifiedContentBytesDeleted <= target.bytes
      && integer(value.diskAvailableBytesBefore) && integer(value.diskAvailableBytesAfter)
      && value.measuredFreeBytesChange === value.diskAvailableBytesAfter - value.diskAvailableBytesBefore
      && value.allTargetBulkAbsent === true && value.proofsPreserved === true && value.imagesDeleted === 0 && value.directoriesDeleted === 0, 'step');
  } else {
    need(phase === 'finish' && keys(value, ['kind', 'completed', 'captureReportSha256', 'definitionSha256', 'currentRuntimeSha', 'rollbackRuntimeSha',
      'retiredContainers', 'alreadyAbsentContainers', 'filesDeleted', 'verifiedContentBytesDeleted', 'diskAvailableBytesBefore', 'diskAvailableBytesAfter',
      'measuredFreeBytesChange', 'remainingContainers', 'imagesPreserved', 'imagesDeleted', 'directoriesDeleted', 'proofsPreserved', 'manifestsPreserved',
      'ingressUnchanged', 'acceptedStateWrites', 'intentStateWrites', 'generationStorageWrites', 'supplierRequests'])
      && value.kind === 'obsolete-deployments-retirement-result-v1' && value.completed === true
      && value.captureReportSha256 === definition.capture.reportSha256 && value.definitionSha256 === definitionSha256
      && value.currentRuntimeSha === CURRENT && value.rollbackRuntimeSha === ROLLBACK && value.remainingContainers === 4
      && value.retiredContainers === steps.reduce((sum, step) => sum + step.retiredContainers, 0)
      && value.alreadyAbsentContainers === prepared.alreadyAbsentContainers && value.retiredContainers + value.alreadyAbsentContainers === 2
      && value.filesDeleted === steps.reduce((sum, step) => sum + step.filesDeleted, 0)
      && value.verifiedContentBytesDeleted === steps.reduce((sum, step) => sum + step.verifiedContentBytesDeleted, 0)
      && value.diskAvailableBytesBefore === prepared.diskAvailableBytes && integer(value.diskAvailableBytesAfter)
      && value.measuredFreeBytesChange === value.diskAvailableBytesAfter - value.diskAvailableBytesBefore
      && value.imagesPreserved === prepared.imagesPreserved
      && ['proofsPreserved', 'manifestsPreserved', 'ingressUnchanged'].every(key => value[key] === true)
      && ['imagesDeleted', 'directoriesDeleted', 'acceptedStateWrites', 'intentStateWrites', 'generationStorageWrites', 'supplierRequests']
        .every(key => value[key] === 0), 'result');
  }
  return structuredClone(value);
}

export async function openSession({root = ROOT, environment = process.env}) {
  const known = path.join(root, 'docs/operations/regcloud-staging-known-hosts');
  need(hash(await fs.readFile(known)) === HOST_KEY_SHA, 'known_host');
  need(typeof environment.SSH_PRIVATE_KEY === 'string' && environment.SSH_PRIVATE_KEY.length > 0, 'ssh_key');
  const directory = await fs.mkdtemp(path.join(await fs.realpath(environment.RUNNER_TEMP), 'obsolete-retirement-'));
  let child;
  try {
    await fs.chmod(directory, 0o700); const key = path.join(directory, 'key');
    await fs.writeFile(key, environment.SSH_PRIVATE_KEY + '\n', {mode: 0o600});
    const source = await fs.readFile(path.join(root, PYTHON), 'utf8');
    const hostSource = await fs.readFile(path.join(root, 'scripts/catalog-next/release-host.py'), 'utf8');
    const captureSource = await fs.readFile(path.join(root, 'scripts/catalog-next/inspect-obsolete-deployments-20261127.py'), 'utf8');
    child = spawn('/usr/bin/ssh', ['-F', '/dev/null', '-T', '-i', key, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
      '-o', 'ForwardAgent=no', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + known,
      '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=15',
      '-o', 'ClearAllForwardings=yes', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3',
      'root@151.248.113.177', '/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -B -c ' + quote(source)],
    {env: {PATH: '/usr/bin:/bin', LANG: 'C.UTF-8'}, stdio: ['pipe', 'pipe', 'pipe']});
    let failure, size = 0, closed = false;
    const exited = new Promise(resolve => child.once('close', (code, signal) => { closed = true; resolve({code, signal}); }));
    child.on('error', () => { failure = Error('obsolete_retirement_transport'); });
    child.stdin.on('error', () => { failure = Error('obsolete_retirement_transport'); });
    child.stderr.on('data', () => {});
    child.stdout.on('data', chunk => { size += chunk.length; if (size > 128 * 1024) { failure = Error('obsolete_retirement_output'); child.kill('SIGTERM'); } });
    const lines = createInterface({input: child.stdout, crlfDelay: Infinity})[Symbol.asyncIterator]();
    const call = async value => {
      need(!closed && !failure, 'transport');
      child.stdin.write(JSON.stringify(value) + '\n'); let timer;
      try {
        const row = await Promise.race([lines.next(), new Promise((_, reject) => {
          timer = setTimeout(() => { child.kill('SIGTERM'); reject(Error('obsolete_retirement_timeout')); }, 10 * 60 * 1000);
        })]);
        need(!failure && !row.done && row.value.length <= 64 * 1024, 'protocol');
        return JSON.parse(row.value);
      } finally { clearTimeout(timer); }
    };
    return {bootstrap: authority => call({hostSource, hostSourceSha256: hash(hostSource), captureSource,
        captureSourceSha256: hash(captureSource), authority}), call,
      async finish() { child.stdin.end(); const status = await exited; need(status.code === 0, 'exit'); },
      async close() {
        if (!closed) { child.stdin.end(); child.kill('SIGTERM'); }
        await exited; await fs.rm(directory, {recursive: true, force: true});
      }};
  } catch (error) {
    child?.kill('SIGTERM'); await fs.rm(directory, {recursive: true, force: true}); throw error;
  }
}

export async function runRetirement({root = ROOT, environment = process.env, capabilities = {},
  log = value => process.stdout.write(JSON.stringify(value) + '\n')} = {}) {
  const invocation = (capabilities.verifyInvocation ?? verifyInvocation)({root, environment});
  (capabilities.verifyBaselines ?? verifyFrozenSpeedBaselines)(root);
  const plan = (capabilities.localDefinition ?? localDefinition)(root);
  const storage = (capabilities.createStorage ?? leaseOnlyStorage)({environment});
  need((await storage.assertPrivateBucket()).verified === true, 'privacy');
  const state = createChinaState({storage});
  const pair = async () => { const [accepted, intent] = await Promise.all([state.read('accepted'), state.read('intent')]); return {accepted, intent}; };
  const expected = await pair(); verifyState(expected, plan.definition);
  const report = {version: 1, kind: 'obsolete-deployments-retirement-20261127', controllerSha: invocation.sourceSha,
    approvedControllerSha: invocation.approvedSourceSha, captureReportSha256: plan.definition.capture.reportSha256,
    definitionSha256: plan.definitionSha256, startedAt: new Date().toISOString(), completed: false, steps: [],
    leaseRelease: 'not_acquired', acceptedStateWrites: 0, intentStateWrites: 0, generationStorageWrites: 0, supplierRequests: 0};
  let lease, session, failure, settled = true;
  const authority = async () => {
    const current = await state.read('lease');
    need(same(current, lease) && current.value.status === 'held' && Date.parse(current.value.expiresAt) > Date.now(), 'lease_lost');
    const publicationState = await pair(); verifyState(publicationState, plan.definition);
    need(same(publicationState.accepted, expected.accepted) && same(publicationState.intent, expected.intent), 'state_changed');
    need(same(await state.read('lease'), lease), 'lease_lost');
    return {publicationState, lease};
  };
  const call = async (phase, operation, index) => {
    settled = false;
    try {
      const value = copyReply(await operation(), phase, plan, index, report.prepared, report.steps);
      settled = true; return value;
    } catch (error) { if (typeof error.uncertain === 'boolean') settled = !error.uncertain; throw error; }
  };
  try {
    lease = await state.acquireLease({previous: await state.read('lease'),
      owner: {runId: environment.GITHUB_RUN_ID, attempt: environment.GITHUB_RUN_ATTEMPT, revision: invocation.sourceSha},
      nonce: randomBytes(16).toString('hex'), expiresAt: new Date(Date.now() + 45 * 60 * 1000).toISOString()});
    report.leaseRelease = 'held';
    session = await (capabilities.openSession ?? openSession)({root, environment});
    let checkedAuthority = await authority();
    report.prepared = await call('prepare', () => session.bootstrap(checkedAuthority));
    log({phase: 'exact_obsolete_deployments_prepared', ...report.prepared});
    for (let index = 0; index < plan.definition.targets.length; index++) {
      checkedAuthority = await authority();
      const step = await call('retire', () => session.call({action: 'retire', index, authority: checkedAuthority}), index);
      report.steps.push(step); log({phase: 'exact_obsolete_deployment_retired', ...step});
    }
    checkedAuthority = await authority();
    report.result = await call('finish', () => session.call({action: 'finish', authority: checkedAuthority}));
    await session.finish(); await authority(); report.completed = true;
  } catch (error) { failure = Error(safeError(error)); report.errorCode = failure.message; }
  finally {
    try { await session?.close(); } catch { settled = false; failure ??= Error('obsolete_retirement_transport'); report.errorCode = failure.message; }
    if (lease) {
      if (settled) {
        try { await state.releaseLease({lease}); report.leaseRelease = 'released'; }
        catch { report.leaseRelease = 'unconfirmed'; failure ??= Error('obsolete_retirement_lease_lost'); report.errorCode = failure.message; }
      } else report.leaseRelease = 'expires';
    }
    if (failure) report.completed = false;
    report.status = report.completed ? 'retired' : settled ? 'refused' : 'needs_reconciliation';
    report.finishedAt = new Date().toISOString();
    const raw = JSON.stringify(report, null, 2) + '\n'; need(Buffer.byteLength(raw) <= 128 * 1024, 'report');
    await fs.writeFile(path.join(root, REPORT), raw, {mode: 0o600, flag: 'wx'});
  }
  log(report); if (failure) throw failure; return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 3 && ['--verify', '--run'].includes(process.argv[2]), 'arguments');
    if (process.argv[2] === '--verify') {
      const invocation = verifyInvocation(); verifyFrozenSpeedBaselines(ROOT);
      process.stdout.write(JSON.stringify({...invocation, ...localDefinition()}) + '\n');
    } else await runRetirement();
  } catch (error) { process.stderr.write(safeError(error) + '\n'); process.exitCode = 1; }
}
