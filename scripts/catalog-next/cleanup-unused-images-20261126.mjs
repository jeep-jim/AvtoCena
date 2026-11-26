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
const PYTHON = 'scripts/catalog-next/cleanup-unused-images-20261126.py';
const WORKFLOW = 'jeep-jim/AvtoCena/.github/workflows/catalog-next-unused-images-cleanup-20261126.yml@refs/heads/main';
const MARKER = '.github/market-runs/catalog-next-unused-images-cleanup-20261126.json';
const CURRENT = 'd536c1547c4d82a339ed68ced7d8503f09b6810b';
const HOST_KEY_SHA = 'fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c';
const need = (value, code) => { if (!value) throw Error('unused_images_' + code); };
const hash = value => createHash('sha256').update(value).digest('hex');
const same = (a, b) => a.found === b.found && a.etag === b.etag && a.sha256 === b.sha256;
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const safe = error => /^(?:unused_images|china_state|china_host|readonly_invocation)_[a-z0-9_]{1,140}$/.test(error?.message ?? '')
  ? error.message : 'unused_images_failed';

export function verifyUnusedImagesState(view) {
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
    operation: 'prune-exact-unused-application-images'});
  verifyFrozenSpeedBaselines(ROOT);
  const plan = JSON.parse(execFileSync('python3', [path.join(ROOT, PYTHON), '--verify-targets'],
    {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 10000}));
  need(plan.imagesPlanned === 4 && /^[a-f0-9]{64}$/.test(plan.planSha256), 'plan');
  return {...invocation, ...plan};
}

async function run() {
  const invocation = verifyInvocation();
  const storage = createChinaStateStorage();
  need((await storage.assertPrivateBucket())?.verified === true, 'privacy');
  const state = createChinaState({storage});
  const pair = async () => { const [accepted, intent] = await Promise.all([state.read('accepted'), state.read('intent')]); return {accepted, intent}; };
  const expected = await pair(); verifyUnusedImagesState(expected);
  let lease, child, exited, directory, settled = true, failure;
  const report = {version: 1, kind: 'unused-images-cleanup-20261126', controllerSha: invocation.sourceSha,
    completed: false, steps: [], leaseRelease: 'not_acquired', planSha256: invocation.planSha256};
  const authority = async () => {
    const currentLease = await state.read('lease');
    need(same(currentLease, lease) && currentLease.value.status === 'held'
      && Date.parse(currentLease.value.expiresAt) > Date.now(), 'lease_lost');
    const view = await pair(); verifyUnusedImagesState(view);
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
    directory = await fs.mkdtemp(path.join(await fs.realpath(process.env.RUNNER_TEMP), 'unused-images-'));
    await fs.chmod(directory, 0o700);
    const key = path.join(directory, 'key'); await fs.writeFile(key, process.env.SSH_PRIVATE_KEY + '\n', {mode: 0o600});
    const source = await fs.readFile(path.join(ROOT, PYTHON), 'utf8');
    const hostSource = await fs.readFile(path.join(ROOT, 'scripts/catalog-next/release-host.py'), 'utf8');
    const policySource = await fs.readFile(path.join(ROOT, 'scripts/regcloud-release-retention.py'), 'utf8');
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
          timer = setTimeout(() => reject(Error('unused_images_reply_timeout')), 300000);
        })]);
        need(!row.done && row.value.length <= 65536, 'reply_missing');
        const value = JSON.parse(row.value); settled = value.uncertain !== true;
        if (value.errorCode) {
          const d = value.closedCandidateStateCheck;
          if (d && ['previousRevision','currentRevision'].every(key => Number.isSafeInteger(d[key]) && d[key] >= 0)
            && ['currentEqualsPrevious','exactRolledBackState','matchingResolvedRollbackIntent','imageReferencedByAuthority'].every(key => typeof d[key] === 'boolean')
            && ['currentValueSha256','previousValueSha256'].every(key => /^[a-f0-9]{64}$/.test(d[key])))
            report.closedCandidateStateCheck = Object.fromEntries(['previousRevision','currentRevision','currentEqualsPrevious',
              'exactRolledBackState','matchingResolvedRollbackIntent','imageReferencedByAuthority','currentValueSha256','previousValueSha256'].map(key => [key,d[key]]));
          throw Error(safe({message: value.errorCode}));
        }
        return value;
      } finally { clearTimeout(timer); }
    };
    const prep = await call({hostSource, hostSourceSha256: hash(hostSource), policySource,
      policySourceSha256: hash(policySource), authority: await authority()});
    need(prep.kind === 'unused-images-prepared-v1' && prep.imagesPlanned === invocation.imagesPlanned
      && prep.planSha256 === invocation.planSha256 && prep.containersPreserved === 12
      && Array.isArray(prep.targets) && prep.targets.length === 4, 'preparation');
    report.plan = prep;
    // The exact reviewed image list is observable before the first removal.
    process.stdout.write(JSON.stringify({phase: 'verified_unused_images_plan', ...prep}) + '\n');
    for (let index = 0; index < prep.imagesPlanned; index++) {
      const step = await call({action: 'remove', index, authority: await authority()});
      need(step.kind === 'unused-image-removed-v1' && step.index === index && step.imageId === prep.targets[index].id
        && Number.isSafeInteger(step.diskFreeBytesBefore) && Number.isSafeInteger(step.diskFreeBytesAfter)
        && step.measuredFreeBytesChange === step.diskFreeBytesAfter - step.diskFreeBytesBefore, 'step');
      report.steps.push(step);
      process.stdout.write(JSON.stringify({phase: 'exact_unused_image_removed', ...step}) + '\n');
    }
    const result = await call({action: 'finish', authority: await authority()});
    need(result.kind === 'unused-images-result-v1' && result.completed === true && result.liveRuntimeSha === CURRENT
      && result.planSha256 === invocation.planSha256 && result.containersPreserved === 12
      && JSON.stringify(result.imagesRemoved) === JSON.stringify(report.steps.map(row => row.imageId))
      && result.measuredFreeBytesChange === result.diskFreeBytesAfter - result.diskFreeBytesBefore
      && ['containersDeleted', 'filesDeleted', 'volumesDeleted', 'acceptedStateWrites', 'intentStateWrites'].every(key => result[key] === 0), 'result');
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
    await fs.writeFile(path.join(ROOT, 'catalog-next-unused-images-cleanup-20261126-report.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600, flag: 'wx'});
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
