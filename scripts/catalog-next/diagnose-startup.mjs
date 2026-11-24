import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';
import {openChinaSshSession} from './release-ssh.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MARKER = '.github/market-runs/catalog-next-china-startup-diagnosis.json';
const OPERATION = 'inspect-china-startup';
const REPORT = 'catalog-next-china-startup-diagnosis-report.json';
const FAILED_RUN = '45382186572';
export const CHINA_STARTUP_DIAGNOSIS_SELECTOR = Object.freeze({
  runtimeSha: '822f925bb30c4e07010f6e14b6574f1b4bd6306e',
  pricingRuntimeSha: '64c6338e0db23c8999096bceefbf113c0136fe15',
  generationId: 'gen_china_45369451603_1',
  generationManifestSha256: 'd5745797cc162b82e0c0f0b1f49fef65f18f0d6649666562337183b18084dd75',
  controllerSha: 'ee8ba8def13a15333fae9dd4ece53e574e37cc14',
  imageId: 'sha256:443e87ed141838f003ce6209fc290f4a2435113b7cfb83126e3d88fb6877cf83',
  since: '2026-11-24T11:36:00Z',
  until: '2026-11-24T11:39:30Z',
});
const FILES = Object.freeze(['GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json',
  'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson', 'image.tar', 'acceptance.json',
  'regcloud-performance-gate.py', 'accepted-speed-baseline.json']);
const HASH = /^[a-f0-9]{64}$/, NONCE = /^[a-f0-9]{32}$/;
const need = (value, code) => { if (!value) throw Error('china_startup_diagnosis_' + code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).length === expected.length
  && expected.every(key => Object.hasOwn(value, key));
const natural = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => Number.isSafeInteger(value) && value > 0;
const bool = value => typeof value === 'boolean';
const sameSelector = value => keys(value, Object.keys(CHINA_STARTUP_DIAGNOSIS_SELECTOR))
  && Object.entries(CHINA_STARTUP_DIAGNOSIS_SELECTOR).every(([key, expected]) => value[key] === expected);
const safeCode = error => /^(?:china_(?:startup_diagnosis|host|ssh)|readonly_invocation)_[a-z0-9_]{1,140}$/.test(error?.message ?? '')
  ? error.message : 'china_startup_diagnosis_failed';

/** Real immutable marker-only push; neither selector nor operation comes from
 * workflow inputs, environment overrides or an unreviewed argument. */
export function verifyChinaStartupDiagnosisInvocation({root = ROOT, environment = process.env} = {}) {
  need(environment.GITHUB_EVENT_NAME === 'push'
    && environment.GITHUB_WORKFLOW_REF === 'jeep-jim/AvtoCena/.github/workflows/catalog-next-china-startup-diagnosis.yml@refs/heads/main', 'workflow');
  return verifyReadonlyInvocation({root, env: environment, markerPath: MARKER, operation: OPERATION});
}

/** Only bounded typed aggregates are permitted outside the authenticated host.
 * Reject added fields instead of forwarding environment, raw logs or plans. */
export function validateChinaStartupDiagnosis(value) {
  need(keys(value, ['version', 'kind', 'readOnly', 'selector', 'nonce', 'planSha256', 'rollbackSha256',
    'outcome', 'files', 'generationVerified', 'diskFreeBytes', 'image', 'retained', 'candidate', 'events'])
    && value.version === 1 && value.kind === 'china-host-startup-diagnosis-v1' && value.readOnly === true
    && sameSelector(value.selector) && NONCE.test(value.nonce ?? '')
    && HASH.test(value.planSha256 ?? '') && HASH.test(value.rollbackSha256 ?? '')
    && value.outcome === 'rolled_back' && value.generationVerified === true
    && natural(value.diskFreeBytes), 'report_identity');
  need(Array.isArray(value.files) && value.files.length === FILES.length
    && new Set(value.files.map(row => row?.name)).size === FILES.length, 'report_files');
  for (const file of value.files) {
    need(keys(file, ['name', 'present', 'bytes', 'expectedBytes', 'sizeMatches', 'private'])
      && FILES.includes(file.name) && bool(file.present) && positive(file.expectedBytes)
      && bool(file.sizeMatches) && bool(file.private)
      && (file.present ? natural(file.bytes) : file.bytes === null && file.sizeMatches === false && file.private === false)
      && file.sizeMatches === (file.present && file.bytes === file.expectedBytes), 'report_file');
  }
  need(keys(value.image, ['present', 'identityMatches']) && bool(value.image.present) && bool(value.image.identityMatches)
    && (value.image.present || value.image.identityMatches === false), 'report_image');
  need(keys(value.retained, ['identityConfirmed', 'running']) && value.retained.identityConfirmed === true && value.retained.running === true,
    'report_retained');
  const candidate = value.candidate;
  need(keys(candidate, ['present', 'running', 'status', 'exitCode', 'oomKilled']) && bool(candidate.present), 'report_candidate');
  if (candidate.present) need(bool(candidate.running) && bool(candidate.oomKilled) && Number.isSafeInteger(candidate.exitCode)
    && ['created', 'restarting', 'running', 'removing', 'paused', 'exited', 'dead'].includes(candidate.status), 'report_candidate_state');
  else need(['running', 'status', 'exitCode', 'oomKilled'].every(key => candidate[key] === null), 'report_candidate_absent');
  const events = value.events;
  need(keys(events, ['available', 'reason', 'rows']) && bool(events.available) && Array.isArray(events.rows)
    && events.rows.length <= 1024, 'report_events');
  need(events.available ? events.reason === (events.rows.length ? null : 'empty')
    : events.reason === 'unavailable' && events.rows.length === 0, 'report_events_availability');
  const first = Date.parse(CHINA_STARTUP_DIAGNOSIS_SELECTOR.since) / 1000, last = Date.parse(CHINA_STARTUP_DIAGNOSIS_SELECTOR.until) / 1000;
  for (const row of events.rows) need(keys(row, ['action', 'time', 'exitCode', 'oom'])
    && ['create', 'start', 'die', 'oom', 'stop', 'kill', 'destroy', 'restart'].includes(row.action)
    && Number.isSafeInteger(row.time) && row.time >= first && row.time <= last
    && (row.exitCode === null || Number.isSafeInteger(row.exitCode)) && bool(row.oom), 'report_event');
  need(Buffer.byteLength(JSON.stringify(value)) <= 256 * 1024, 'report_size');
  return structuredClone(value);
}

/** No init, upload, exec, public HTTP request, storage or provider capability is
 * called. The host diagnoses the one already rolled-back attempt, then closes.
 * Dependencies can be replaced only in-process by the local test harness. */
export async function runChinaStartupDiagnosis({root = ROOT, environment = process.env,
  capabilities = {}, now = () => new Date().toISOString(), log = () => {}} = {}) {
  const defaults = {verifyInvocation: verifyChinaStartupDiagnosisInvocation,
    verifyBaselines: verifyFrozenSpeedBaselines, openSession: openChinaSshSession};
  need(object(capabilities) && Object.keys(capabilities).every(key => Object.hasOwn(defaults, key) && typeof capabilities[key] === 'function'),
    'capabilities');
  need(path.isAbsolute(root) && typeof now === 'function' && typeof log === 'function', 'arguments');
  const use = {...defaults, ...capabilities};
  const report = {version: 1, kind: 'china-startup-diagnosis-v1', market: 'china', readOnly: true,
    failedRunId: FAILED_RUN, selector: CHINA_STARTUP_DIAGNOSIS_SELECTOR, completed: false, status: 'starting',
    hostMutations: 0, storageWrites: 0, providerCalls: 0, pageRequests: 0};
  const reportPath = path.join(root, REPORT); let session, directory, failure;
  try {
    const invocation = use.verifyInvocation({root, environment});
    report.diagnosisControllerSha = invocation.sourceSha; report.approvedControllerSha = invocation.approvedSourceSha;
    use.verifyBaselines(root);
    const privateKey = environment.SSH_PRIVATE_KEY;
    need(typeof privateKey === 'string' && privateKey.length > 0, 'ssh_key');
    const temporary = await fs.realpath(environment.RUNNER_TEMP);
    directory = await fs.mkdtemp(path.join(temporary, 'china-startup-diagnosis-')); await fs.chmod(directory, 0o700);
    session = await use.openSession({root, directory, privateKey});
    const result = await session.call('diagnose', CHINA_STARTUP_DIAGNOSIS_SELECTOR);
    report.diagnosis = validateChinaStartupDiagnosis(result);
    const closed = await session.close();
    need(closed?.closed === true && closed.readOnly === true, 'close'); session = null;
    report.completed = true; report.status = 'complete';
  } catch (error) {
    failure = Error(safeCode(error)); report.status = 'failed'; report.errorCode = failure.message;
  } finally {
    if (session) { session.abort(); await session.exited; }
    if (directory) await fs.rm(directory, {recursive: true, force: true});
  }
  report.finishedAt = now();
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', {flag: 'wx', mode: 0o600});
  log(report);
  if (failure) { failure.report = report; throw failure; }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(process.argv.length === 3 && ['--verify', '--run'].includes(process.argv[2]), 'cli_arguments');
    if (process.argv[2] === '--verify') {
      const invocation = verifyChinaStartupDiagnosisInvocation(); verifyFrozenSpeedBaselines(ROOT);
      process.stdout.write(JSON.stringify({phase: 'china_startup_diagnosis_verified', controllerSha: invocation.sourceSha,
        failedRunId: FAILED_RUN, readOnly: true}) + '\n');
    } else await runChinaStartupDiagnosis({log: value => process.stdout.write(JSON.stringify(value) + '\n')});
  } catch (error) { process.stderr.write(safeCode(error) + '\n'); process.exitCode = 1; }
}
