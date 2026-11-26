import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {createHash, randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';
import {createChinaStateStorage, createChinaState, inspectChinaPublicationState} from './china-state.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PYTHON = 'scripts/catalog-next/cleanup-stopped-cache-containers-20261126.py';
const WORKFLOW = 'jeep-jim/AvtoCena/.github/workflows/catalog-next-stopped-cache-cleanup-20261126.yml@refs/heads/main';
const MARKER = '.github/market-runs/catalog-next-stopped-cache-cleanup-20261126.json';
const CURRENT = 'd536c1547c4d82a339ed68ced7d8503f09b6810b';
const HOST_KEY_SHA = 'fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c';
const need = (value, code) => { if (!value) throw Error('stopped_cleanup_' + code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => a.found === b.found && a.etag === b.etag && a.sha256 === b.sha256;
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const safe = error => /^(?:stopped_cleanup|stopped_layers|resource_inventory|china_state|china_host|readonly_invocation)_[a-z0-9_]{1,140}$/.test(error?.message ?? '')
  ? error.message : 'stopped_cleanup_failed';

export function verifyStoppedCleanupState(view) {
  need(['idle', 'resolved'].includes(inspectChinaPublicationState(view).status)
    && view.accepted.found && view.accepted.value.pending === null
    && view.accepted.value.current?.runtimeSha === CURRENT
    && view.accepted.value.current?.generationId === 'gen_china_45655051136_1'
    && view.accepted.value.current?.generationManifestSha256 === '6711203fb59a70c99cda3c725eb4ee70654142b1871b0784516209d2903c0b8d'
    && view.accepted.value.rollback?.runtimeSha === CURRENT
    && view.accepted.value.rollback?.generationId === 'gen_china_45369451603_1', 'state');
}

export function verifyInvocation(environment = process.env) {
  need(environment.GITHUB_WORKFLOW_REF === WORKFLOW && environment.GITHUB_JOB === 'cleanup', 'workflow');
  const invocation = verifyReadonlyInvocation({root: ROOT, env: environment, markerPath: MARKER,
    operation: 'remove-exact-stopped-cache-containers'});
  verifyFrozenSpeedBaselines(ROOT);
  const plan = JSON.parse(execFileSync('python3', [path.join(ROOT, PYTHON), '--verify-targets'],
    {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000}));
  need(plan.containersPlanned === 8 && /^[a-f0-9]{64}$/.test(plan.planSha256), 'plan');
  return {...invocation, ...plan};
}

async function run() {
  const invocation = verifyInvocation();
  const storage = createChinaStateStorage();
  need((await storage.assertPrivateBucket())?.verified === true, 'privacy');
  const state = createChinaState({storage});
  const pair = async () => { const [accepted, intent] = await Promise.all([state.read('accepted'), state.read('intent')]); return {accepted, intent}; };
  const expected = await pair(); verifyStoppedCleanupState(expected);
  let lease, child, exited, directory, settled = true, failure;
  const report = {version: 1, kind: 'stopped-cache-cleanup-20261126', controllerSha: invocation.sourceSha,
    completed: false, steps: [], leaseRelease: 'not_acquired', planSha256: invocation.planSha256};
  const authority = async () => {
    const currentLease = await state.read('lease');
    need(same(currentLease, lease) && currentLease.value.status === 'held'
      && Date.parse(currentLease.value.expiresAt) > Date.now(), 'lease_lost');
    const view = await pair(); verifyStoppedCleanupState(view);
    need(same(view.accepted, expected.accepted) && same(view.intent, expected.intent), 'state_changed');
    need(same(await state.read('lease'), lease), 'lease_lost');
    return {publicationState: view, lease};
  };
  try {
    lease = await state.acquireLease({previous: await state.read('lease'),
      owner: {runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, revision: invocation.sourceSha},
      nonce: randomBytes(16).toString('hex'), expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString()});
    report.leaseRelease = 'held';
    const known = path.join(ROOT, 'docs/operations/regcloud-staging-known-hosts');
    need(hash(await fs.readFile(known)) === HOST_KEY_SHA, 'known_host');
    need(typeof process.env.SSH_PRIVATE_KEY === 'string' && process.env.SSH_PRIVATE_KEY.length > 0, 'ssh_key');
    directory = await fs.mkdtemp(path.join(await fs.realpath(process.env.RUNNER_TEMP), 'stopped-cache-cleanup-'));
    await fs.chmod(directory, 0o700);
    const key = path.join(directory, 'key'); await fs.writeFile(key, process.env.SSH_PRIVATE_KEY + '\n', {mode: 0o600});
    const source = await fs.readFile(path.join(ROOT, PYTHON), 'utf8');
    const hostSource = await fs.readFile(path.join(ROOT, 'scripts/catalog-next/release-host.py'), 'utf8');
    const inventorySource = await fs.readFile(path.join(ROOT, 'scripts/regcloud-resource-inventory-20261126.py'), 'utf8');
    const readerSource = await fs.readFile(path.join(ROOT, 'scripts/regcloud-stopped-layers-20261126.py'), 'utf8');
    const command = '/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -B -c ' + quote(source);
    child = spawn('/usr/bin/ssh', ['-F', '/dev/null', '-T', '-i', key, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
      '-o', 'ForwardAgent=no', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + known,
      '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=15',
      '-o', 'ClearAllForwardings=yes', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3',
      'root@151.248.113.177', command], {env: {PATH: '/usr/bin:/bin', LANG: 'C.UTF-8'}, stdio: ['pipe', 'pipe', 'pipe']});
    exited = new Promise(resolve => child.once('close', (code, signal) => resolve({code, signal})));
    child.on('error', () => {}); child.stdin.on('error', () => {}); child.stderr.on('data', () => {});
    const lines = createInterface({input: child.stdout, crlfDelay: Infinity})[Symbol.asyncIterator]();
    const call = async payload => {
      settled = false;
      need(child.stdin.write(JSON.stringify(payload) + '\n') !== undefined, 'transport_write');
      let timer;
      try {
        const row = await Promise.race([lines.next(), new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('stopped_cleanup_reply_timeout')), 300000);
        })]);
        need(!row.done && row.value.length <= 65536, 'reply_missing');
        const value = JSON.parse(row.value); settled = value.uncertain !== true;
        if (value.errorCode) {
          const d = value.noncachePathEvidence;
          if (d && /^[a-f0-9]{64}$/.test(d.containerId) && Array.isArray(d.metadata) && d.metadata.length <= 32)
            report.noncachePathEvidence = d;
          if (Array.isArray(value.removedContainerIds) && value.removedContainerIds.length <= 8
            && value.removedContainerIds.every(id => /^[a-f0-9]{64}$/.test(id)))
            report.removedContainerIdsAtFailure = value.removedContainerIds;
          throw Error(safe({message: value.errorCode}));
        }
        return value;
      } finally { clearTimeout(timer); }
    };
    const prep = await call({hostSource, hostSourceSha256: hash(hostSource), inventorySource,
      inventorySourceSha256: hash(inventorySource), readerSource, readerSourceSha256: hash(readerSource), authority: await authority()});
    need(prep.kind === 'stopped-cache-cleanup-prepared-v1' && prep.containersPlanned === invocation.containersPlanned
      && prep.planSha256 === invocation.planSha256 && prep.containersRetained === 4 && prep.imagesPreserved === 13
      && Array.isArray(prep.targets) && prep.targets.length === 8 && Array.isArray(prep.cacheOnlyProofs)
      && prep.cacheOnlyProofs.length === 8 && prep.cacheOnlyProofs.every((row, index) =>
        row.containerId === prep.targets[index].id && row.changesComplete === true && row.noncacheMetadataComplete === true), 'preparation');
    report.plan = prep;
    process.stdout.write(JSON.stringify({phase: 'verified_all_eight_cache_only_layers', ...prep}) + '\n');
    for (let index = 0; index < prep.containersPlanned; index++) {
      const step = await call({action: 'remove', index, authority: await authority()});
      need(step.kind === 'stopped-cache-container-removed-v1' && step.index === index && step.containerId === prep.targets[index].id
        && step.currentAndRollbackHealthy === true && step.allImagesAndVolumesPreserved === true
        && Number.isSafeInteger(step.diskBefore.availableBytes) && Number.isSafeInteger(step.diskAfter.availableBytes)
        && step.measuredFreeBytesChange === step.diskAfter.availableBytes - step.diskBefore.availableBytes, 'step');
      report.steps.push(step);
      process.stdout.write(JSON.stringify({phase: 'exact_stopped_cache_container_removed', ...step}) + '\n');
    }
    const result = await call({action: 'finish', authority: await authority()});
    need(result.kind === 'stopped-cache-cleanup-result-v1' && result.completed === true && result.liveRuntimeSha === CURRENT
      && result.planSha256 === invocation.planSha256 && result.currentAndRollbackHealthy === true
      && Array.isArray(result.containersRetained) && result.containersRetained.length === 4 && result.imagesPreserved === 13
      && JSON.stringify(result.removedContainerIds) === JSON.stringify(report.steps.map(row => row.containerId))
      && result.measuredFreeBytesChange === result.diskAfter.availableBytes - result.diskBefore.availableBytes
      && ['imagesDeleted', 'hostFilesDeleted', 'volumesDeleted', 'memoryLimitsChanged', 'acceptedStateWrites', 'intentStateWrites'].every(key => result[key] === 0), 'result');
    child.stdin.end();
    const status = await exited; need(status.code === 0, 'remote_exit'); child = null;
    await authority(); report.result = result; report.completed = true;
  } catch (error) { failure = Error(safe(error)); report.errorCode = failure.message; }
  finally {
    if (child) { child.stdin.end(); child.kill('SIGTERM'); await exited; }
    if (lease) {
      if (settled) {
        try { await state.releaseLease({lease}); report.leaseRelease = 'released'; }
        catch { report.leaseRelease = 'unconfirmed'; }
      } else report.leaseRelease = 'expires';
    }
    if (directory) await fs.rm(directory, {recursive: true, force: true});
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(ROOT, 'catalog-next-stopped-cache-cleanup-20261126-report.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
  }
  process.stdout.write(JSON.stringify(report) + '\n');
  if (failure) throw failure;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 3 && ['--verify', '--run'].includes(process.argv[2]), 'arguments');
    if (process.argv[2] === '--verify') process.stdout.write(JSON.stringify(verifyInvocation()) + '\n');
    else await run();
  } catch (error) { process.stderr.write(safe(error) + '\n'); process.exitCode = 1; }
}
