import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';
import {checkedStartupReport, openChinaSshSession} from './release-ssh.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MARKER = '.github/market-runs/catalog-next-china-startup-diagnosis.json';
const OPERATION = 'inspect-china-startup';
const REPORT = 'catalog-next-china-startup-diagnosis-report.json';
const FAILED_RUN = '45523654629';
export const CHINA_STARTUP_DIAGNOSIS_SELECTOR = Object.freeze({
  runtimeSha: '38895e53f7f770ee68edb0b8ad53056468b928a5',
  pricingRuntimeSha: '64c6338e0db23c8999096bceefbf113c0136fe15',
  generationId: 'gen_china_45369451603_1',
  generationManifestSha256: 'd5745797cc162b82e0c0f0b1f49fef65f18f0d6649666562337183b18084dd75',
  controllerSha: '0a42902df8b92904fda0a3fea9d1fb2974f93a0f',
  imageId: 'sha256:c883ec9bd2203f5fbdac0da2860826da9ed8cd2233008feb567d128699dcbb54',
  since: '2026-11-25T01:35:00Z',
  until: '2026-11-25T01:40:00Z',
});
const FILES = Object.freeze(['GENERATION.json', 'details.sqlite', 'query.sqlite', 'FILTER_SEMANTICS.json',
  'FX_RECEIPT.json', 'RECONCILIATION.json', 'DISPOSITIONS.ndjson', 'image.tar', 'acceptance.json',
  'regcloud-performance-gate.py', 'accepted-speed-baseline.json']);
// Exact public paths in the frozen server baseline, plus the China scope route.
// No arbitrary URL, query, exception text or private response can be forwarded.
const SPEED_PATHS = new Set(['/', '/api/health', '/api/leads', '/autocalc', '/cars', '/login',
  '/cars/autocatalog', '/cars/autocatalog?make=Changan', '/cars?sort=totalRub',
  '/cars?market=china', '/cars?market=china&make=Volkswagen&page=2', '/cars?market=europe&make=BMW&page=2',
  '/cars?market=china&city=%D0%9D%D0%BE%D0%B2%D0%BE%D0%BA%D1%83%D0%B7%D0%BD%D0%B5%D1%86%D0%BA',
  '/api/catalog/search?market=europe&make=BMW&page=2', '/api/catalog/search?market=china&marketPage=1&page=9',
  '/api/catalog/search?market=china&budgetTo=1500000&pageSize=6',
  '/cars/china/BMW/3%20SERIES?powerTo=160&sort=totalRub', '/cars/china/BMW/3?powerTo=160&sort=totalRub']);
const SPEED_PHASES = new Set(['warm', 'after_ttl', 'after_directory_ttl']);
const SPEED_ERRORS = new Set(['AssertionError', 'HTTPError', 'URLError', 'TimeoutError', 'JSONDecodeError',
  'RemoteDisconnected', 'IncompleteRead', 'ConnectionResetError', 'ConnectionRefusedError', 'ValueError',
  'KeyError', 'TypeError', 'OSError', 'SSLError', 'UnicodeDecodeError', 'other']);
const HASH = /^[a-f0-9]{64}$/, NONCE = /^[a-f0-9]{32}$/;
const need = (value, code) => { if (!value) throw Error('china_startup_diagnosis_' + code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, expected) => object(value) && Object.keys(value).length === expected.length
  && expected.every(key => Object.hasOwn(value, key));
const natural = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => Number.isSafeInteger(value) && value > 0;
const bool = value => typeof value === 'boolean';
const seconds = value => Number.isFinite(value) && value >= 0 && value <= 86400;
const sameSelector = value => keys(value, Object.keys(CHINA_STARTUP_DIAGNOSIS_SELECTOR))
  && Object.entries(CHINA_STARTUP_DIAGNOSIS_SELECTOR).every(([key, expected]) => value[key] === expected);
const safeCode = error => /^(?:china_(?:startup_diagnosis|host|ssh)|readonly_invocation)_[a-z0-9_]{1,140}$/.test(error?.message ?? '')
  ? error.message : 'china_startup_diagnosis_failed';

function validateSpeedSample(row) {
  need(object(row), 'report_speed_sample');
  if (row.performanceGate === 'summary') {
    need(keys(row, ['performanceGate', 'marketScope', 'routes', 'acceptedBaselineRoutes', 'samples', 'slowSamples',
      'functionalPassed', 'performanceAccepted', 'latencyBlocking', 'acceptedBaselineEnforced']) && row.marketScope === 'china'
      && ['routes', 'acceptedBaselineRoutes'].every(key => Array.isArray(row[key]) && row[key].length <= 64
        && row[key].every(route => SPEED_PATHS.has(route)))
      && ['samples', 'slowSamples'].every(key => natural(row[key]) && row[key] <= 10000)
      && ['functionalPassed', 'performanceAccepted', 'latencyBlocking', 'acceptedBaselineEnforced'].every(key => bool(row[key])),
      'report_speed_summary');
    return;
  }
  need(SPEED_PATHS.has(row.path), 'report_speed_path');
  if (row.performanceRequest === 'started') {
    need(keys(row, ['performanceRequest', 'path']), 'report_speed_request');
  } else if (row.performanceRequest === 'complete') {
    need(keys(row, ['performanceRequest', 'path', 'seconds', 'functionalPassed'])
      && seconds(row.seconds) && bool(row.functionalPassed), 'report_speed_request');
  } else if (row.performanceRequest === 'failed') {
    need(keys(row, ['performanceRequest', 'path', 'seconds', 'errorType'])
      && seconds(row.seconds) && SPEED_ERRORS.has(row.errorType), 'report_speed_request');
  } else if (SPEED_PHASES.has(row.speedBaseline)) {
    const fields = ['speedBaseline', 'path', 'referenceSeconds', 'measurementNoiseSeconds', 'ceilingSeconds', 'seconds', 'blocking', 'passed'];
    if (Object.hasOwn(row, 'recheckSeconds') || Object.hasOwn(row, 'recheckMedianSeconds')) {
      fields.push('recheckSeconds', 'recheckMedianSeconds');
      need(Array.isArray(row.recheckSeconds) && row.recheckSeconds.length === 3 && row.recheckSeconds.every(seconds)
        && seconds(row.recheckMedianSeconds), 'report_speed_recheck');
    }
    need(keys(row, fields) && ['referenceSeconds', 'measurementNoiseSeconds', 'ceilingSeconds', 'seconds'].every(key => seconds(row[key]))
      && bool(row.blocking) && bool(row.passed), 'report_speed_baseline');
  } else if (SPEED_PHASES.has(row.performanceGate)) {
    need(keys(row, ['performanceGate', 'path', 'seconds', 'ceiling', 'passed', 'functionalPassed', 'latencyBlocking'])
      && seconds(row.seconds) && seconds(row.ceiling)
      && ['passed', 'functionalPassed', 'latencyBlocking'].every(key => bool(row[key])), 'report_speed_gate');
  } else need(false, 'report_speed_sample');
}

function validateServerSpeed(value) {
  need(keys(value, ['present', 'sha256', 'exitCode', 'samples', 'rejectedSamples']) && bool(value.present)
    && Array.isArray(value.samples) && natural(value.rejectedSamples) && value.samples.length + value.rejectedSamples <= 512,
    'report_speed');
  if (!value.present) {
    need(value.sha256 === null && value.exitCode === null && value.samples.length === 0 && value.rejectedSamples === 0,
      'report_speed_absent');
    return;
  }
  need(typeof value.sha256 === 'string' && HASH.test(value.sha256) && Number.isSafeInteger(value.exitCode) && Math.abs(value.exitCode) <= 255,
    'report_speed_identity');
  value.samples.forEach(validateSpeedSample);
}

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
    'outcome', 'files', 'generationVerified', 'diskFreeBytes', 'image', 'retained', 'candidate', 'events', 'startup', 'serverSpeed'])
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
  if (value.startup !== null) {
    try { checkedStartupReport(value.startup); } catch { need(false, 'report_startup'); }
  }
  validateServerSpeed(value.serverSpeed);
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
