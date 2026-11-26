import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createReadonlyStateReader} from './inspect-code-outcome-45841493341.mjs';
import {createChinaGenerationGcQueueStorage, CHINA_GC_QUEUE_KEY} from './china-generation-gc-queue.mjs';
import {validateChinaGenerationRetirementWitness} from './china-generation-gc.mjs';
import {inspectChinaPublicationState, validateChinaAcceptedState, validateChinaPublicationIntent,
  validateChinaLease} from './china-state.mjs';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {verifyFrozenSpeedBaselines} from '../verify-frozen-speed-baselines.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PYTHON = 'scripts/catalog-next/inspect-obsolete-deployments-20261127.py';
export const MARKER = '.github/market-runs/catalog-next-obsolete-deployments-20261127-readonly.json';
export const REPORT = 'catalog-next-obsolete-deployments-20261127-readonly-report.json';
export const OPERATION = 'inspect-obsolete-deployments-20261127';
const WORKFLOW = 'jeep-jim/AvtoCena/.github/workflows/catalog-next-obsolete-deployments-20261127-readonly.yml@refs/heads/main';
const HOST_KEY_SHA = 'fd37f98aab3eeb16f131fcd4033adbb56f7e9616208c2f1ab5ef7a446caa4e4c';
const TARGET_GENERATIONS = new Set(['gen_china_45369451603_1', 'gen_china_45655051136_1']);
const NAMES = ['accepted', 'intent', 'lease'];
const HASH = /^[a-f0-9]{64}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) => object(value) && Object.keys(value).sort().join(',') === [...names].sort().join(',');
const ordered = value => Array.isArray(value) ? value.map(ordered) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const bytes = value => Buffer.from(JSON.stringify(ordered(value)));
const same = (a, b) => a.found === b.found && a.etag === b.etag && a.sha256 === b.sha256;
const need = (value, code) => { if (!value) throw Error('obsolete_capture_' + code); };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const safeErrors = new Set(['arguments', 'workflow', 'privacy', 'readonly_request', 'unindexed_task', 'observation',
  'state', 'lease_active', 'task', 'state_changed', 'host_report', 'host_binding', 'host_refused', 'host_transport',
  'host_timeout', 'host_output', 'host_exit', 'known_host', 'ssh_key', 'report_size', 'failed'].map(code => 'obsolete_capture_' + code));
const safeError = error => safeErrors.has(error?.message) ? error.message : 'obsolete_capture_failed';

export function verifyInvocation({root = ROOT, environment = process.env} = {}) {
  need(environment.GITHUB_EVENT_NAME === 'push' && environment.GITHUB_WORKFLOW_REF === WORKFLOW
    && environment.GITHUB_JOB === 'inspect', 'workflow');
  return verifyReadonlyInvocation({root, env: environment, markerPath: MARKER, operation: OPERATION});
}

export function localDefinition(root = ROOT) {
  return JSON.parse(execFileSync('python3', ['-B', path.join(root, PYTHON), '--verify-targets'],
    {encoding: 'utf8', timeout: 10000, maxBuffer: 32 * 1024, stdio: ['ignore', 'pipe', 'pipe']}));
}

/** GETs only: the exact queue, then only the two generations' task IDs actually
 * present in that validated queue. No list, CAS, task creation or lease capability. */
export function createReadonlyQueueReader({environment = process.env, fetcher = fetch} = {}) {
  const bucket = '/avtocena-staging-8120751', prefix = bucket + '/migration-staging/full-20261011/';
  const allowed = new Set([prefix + CHINA_GC_QUEUE_KEY]);
  const indexed = new Set();
  const storage = createChinaGenerationGcQueueStorage({environment,
    assertAuthority: async () => { need(false, 'readonly_request'); },
    fetcher: async (url, init) => {
      const target = new URL(url), query = [...target.searchParams];
      need(init?.method === 'GET' && init.body === undefined && init.redirect === 'error'
        && target.origin === 'https://s3.regru.cloud' && !target.username && !target.password && !target.hash
        && (target.pathname === bucket ? query.length === 1 && ['acl', 'policy'].includes(query[0][0]) && query[0][1] === ''
          : allowed.has(target.pathname) && (query.length === 0 || query.length === 1 && query[0][0] === 'acl' && query[0][1] === '')),
      'readonly_request');
      return fetcher(url, init);
    }});
  return Object.freeze({assertPrivateBucket: () => storage.assertPrivateBucket(),
    async readQueue() {
      const value = await storage.readQueue();
      indexed.clear(); allowed.clear(); allowed.add(prefix + CHINA_GC_QUEUE_KEY);
      for (const row of value.value?.items ?? []) if (TARGET_GENERATIONS.has(row.generationId)) {
        indexed.add(row.id); allowed.add(prefix + 'catalog/market-rebuild/v1/china/gc/tasks/' + row.id + '.json');
      }
      need(indexed.size <= 2, 'task');
      return value;
    },
    readTask(id) { need(indexed.has(id), 'unindexed_task'); return storage.readTask(id); }});
}

function observation(value, validator) {
  need(keys(value, ['found', 'etag', 'sha256', 'value']) && typeof value.found === 'boolean', 'observation');
  if (!value.found) need(value.etag === null && value.sha256 === null && value.value === null, 'observation');
  else {
    need(typeof value.etag === 'string' && /^"[^"\x00-\x20\x7f]{1,250}"$/.test(value.etag)
      && HASH.test(value.sha256 ?? '') && sha(bytes(value.value)) === value.sha256, 'observation');
    if (validator) validator(value.value);
  }
  return value;
}
const identity = value => ({found: value.found, sha256: value.sha256, etagSha256: value.etag === null ? null : sha(value.etag)});

export function checkedTask(value, item) {
  need(value?.found === true && Buffer.isBuffer(value.data) && value.data.length === value.size
    && value.size > 0 && value.size <= 2 * 1024 * 1024 && sha(value.data) === item.taskSha256
    && typeof value.etag === 'string' && /^"[^"\x00-\x20\x7f]{1,250}"$/.test(value.etag), 'task');
  const task = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(value.data));
  need(bytes(task).equals(value.data) && keys(task, ['version', 'kind', 'market', 'id', 'reference', 'previousAccepted', 'acceptedPublication'])
    && task.version === 1 && task.kind === 'china-generation-gc-task-v1' && task.market === 'china' && task.id === item.id, 'task');
  const witness = validateChinaGenerationRetirementWitness(task);
  need(witness && bytes(witness.reference).equals(bytes(task.reference)), 'task');
  const publication = {acceptedRevision: task.acceptedPublication.accepted.value.revision,
    acceptedSha256: task.acceptedPublication.accepted.sha256, intentSha256: task.acceptedPublication.intent.sha256,
    publicationNonce: task.acceptedPublication.intent.value.nonce};
  need(sha(bytes({generationId: task.reference.generationId, owner: task.reference.owner, receiptSha256: task.reference.receiptSha256,
    previousETag: task.previousAccepted.etag, previousSha256: task.previousAccepted.sha256, publication})) === item.id
    && item.generationId === task.reference.generationId && bytes(item.owner).equals(bytes(task.reference.owner))
    && item.receiptSha256 === task.reference.receiptSha256 && item.publicationNonce === publication.publicationNonce, 'task');
  return {id: item.id, generationId: item.generationId, phase: item.phase, taskSha256: item.taskSha256,
    etagSha256: sha(value.etag), referenceSha256: sha(bytes(task.reference)),
    hostReceiptSha256: task.reference.proof.hostReceiptSha256,
    previousAcceptedSha256: task.previousAccepted.sha256, successorAcceptedSha256: publication.acceptedSha256,
    successorIntentSha256: publication.intentSha256, witnessVerified: true};
}

export async function readSnapshot(stateReader, queueReader, now = () => new Date().toISOString()) {
  const startedAt = now(), raw = {};
  const observations = await Promise.all(NAMES.map(name => stateReader.read(name)));
  NAMES.forEach((name, index) => { raw[name] = observation(observations[index],
    {accepted: validateChinaAcceptedState, intent: validateChinaPublicationIntent, lease: validateChinaLease}[name]); });
  const queue = observation(await queueReader.readQueue());
  const tasks = [];
  for (const item of queue.value?.items ?? []) if (TARGET_GENERATIONS.has(item.generationId))
    tasks.push(checkedTask(await queueReader.readTask(item.id), item));
  need(tasks.length <= 2, 'task');
  const summary = {startedAt, finishedAt: now(), state: inspectChinaPublicationState(raw).status,
    observations: Object.fromEntries(NAMES.map(name => [name, identity(raw[name])])),
    acceptedRevision: raw.accepted.value?.revision ?? null, leaseStatus: raw.lease.value?.status ?? null,
    intentStatus: raw.intent.value?.status ?? null, queue: {...identity(queue),
      revision: queue.value?.revision ?? null, itemCount: queue.value?.items.length ?? 0,
      matchingTasks: tasks, otherGenerationItems: (queue.value?.items.length ?? 0) - tasks.length}};
  return {raw, queue, summary};
}

export function verifyState(snapshot, definition) {
  const state = snapshot.raw.accepted.value;
  need(snapshot.summary.state === 'resolved' && state?.pending === null, 'state');
  need(snapshot.raw.lease.value?.status === 'released', 'lease_active');
  for (const name of ['current', 'rollback']) {
    const pin = definition.history[name], ref = state[name];
    need(ref?.runtimeSha === pin.runtimeSha && ref.imageId === pin.imageId && ref.generationId === pin.generationId
      && ref.generationManifestSha256 === pin.manifestSha256, 'state');
  }
}

/** Rebuild the report solely from fixed identities, hashes, booleans and bounded
 * integers. Private state, original receipts and unexpected host fields are rejected. */
export function sanitizeHostReport(value, expected, definition, definitionSha256) {
  const top = ['version', 'kind', 'readOnly', 'inventoryReportSha256', 'definitionSha256', 'acceptedStateSha256',
    'intentSha256', 'leaseSha256', 'containersChecked', 'containersUnchanged', 'ingressSha256', 'ingressUnchanged',
    'history', 'bulkFiles', 'allocatedBulkBytes', 'diskAvailableBytes', 'bulkContentHashesVerified',
    'supplierRequests', 'storageWrites', 'hostWrites', 'localHealthRequests'];
  need(keys(value, top) && value.version === 1 && value.kind === 'obsolete-deployments-host-readonly-v1'
    && value.readOnly === true && value.inventoryReportSha256 === definition.inventoryReportSha256
    && value.definitionSha256 === definitionSha256 && value.containersChecked === 6
    && value.containersUnchanged === true && value.ingressUnchanged === true && HASH.test(value.ingressSha256 ?? '')
    && value.bulkContentHashesVerified === false && value.supplierRequests === 0 && value.storageWrites === 0
    && value.hostWrites === 0 && value.localHealthRequests === 2
    && integer(value.allocatedBulkBytes) && integer(value.diskAvailableBytes), 'host_report');
  for (const [name, key] of [['accepted', 'acceptedStateSha256'], ['intent', 'intentSha256'], ['lease', 'leaseSha256']])
    need(value[key] === expected.raw[name].sha256, 'host_binding');
  need(keys(value.history, Object.keys(definition.history)), 'host_report');
  const history = {};
  for (const [name, pin] of Object.entries(definition.history)) {
    const row = value.history[name], old = name.startsWith('obsolete');
    const extra = ['referenceSha256', 'nonceSha256', 'hostReceiptSha256', 'running', 'generationVerified',
      ...(old ? ['predecessorOf', 'previousAcceptedStateSha256', 'previousAcceptedETagSha256'] : [])];
    need(keys(row, [...Object.keys(pin), ...extra]) && Object.entries(pin).every(([key, actual]) => row[key] === actual)
      && row.running === !old && row.generationVerified === true
      && ['referenceSha256', 'nonceSha256', 'hostReceiptSha256', ...(old ? ['previousAcceptedStateSha256', 'previousAcceptedETagSha256'] : [])]
        .every(key => HASH.test(row[key] ?? ''))
      && (!old || row.predecessorOf === (name === 'obsoleteA' ? 'rollback' : 'current')), 'host_binding');
    if (!old) need(row.referenceSha256 === sha(bytes(expected.raw.accepted.value[name])), 'host_binding');
    history[name] = Object.fromEntries([...Object.keys(pin), ...extra].map(key => [key, row[key]]));
  }
  need(Array.isArray(value.bulkFiles) && value.bulkFiles.length <= 14, 'host_report');
  const unique = new Set();
  const bulkFiles = value.bulkFiles.map(row => {
    need(keys(row, ['deployment', 'name', 'present', 'declaredBytes', 'declaredSha256', 'allocatedBytes', 'contentHashVerified'])
      && ['obsoleteA', 'obsoleteB'].includes(row.deployment)
      && ['details.sqlite', 'query.sqlite', 'DISPOSITIONS.ndjson', 'FILTER_SEMANTICS.json', 'FX_RECEIPT.json', 'RECONCILIATION.json', 'image.tar'].includes(row.name)
      && typeof row.present === 'boolean' && integer(row.declaredBytes) && row.declaredBytes > 0
      && integer(row.allocatedBytes) && (row.present || row.allocatedBytes === 0)
      && HASH.test(row.declaredSha256 ?? '') && row.contentHashVerified === false
      && !unique.has(row.deployment + '/' + row.name), 'host_report');
    unique.add(row.deployment + '/' + row.name);
    return Object.fromEntries(Object.keys(row).map(key => [key, row[key]]));
  });
  need(bulkFiles.reduce((sum, row) => sum + row.allocatedBytes, 0) === value.allocatedBulkBytes, 'host_report');
  return {...Object.fromEntries(top.filter(key => !['history', 'bulkFiles'].includes(key)).map(key => [key, value[key]])), history, bulkFiles};
}

export async function readHost({root = ROOT, environment = process.env, publicationState}) {
  const known = path.join(root, 'docs/operations/regcloud-staging-known-hosts');
  need(sha(await fs.readFile(known)) === HOST_KEY_SHA, 'known_host');
  need(typeof environment.SSH_PRIVATE_KEY === 'string' && environment.SSH_PRIVATE_KEY.length > 0, 'ssh_key');
  let directory;
  try {
    directory = await fs.mkdtemp(path.join(await fs.realpath(environment.RUNNER_TEMP), 'obsolete-readonly-'));
    await fs.chmod(directory, 0o700);
    const key = path.join(directory, 'key'); await fs.writeFile(key, environment.SSH_PRIVATE_KEY + '\n', {mode: 0o600});
    const source = await fs.readFile(path.join(root, PYTHON), 'utf8');
    const hostSource = await fs.readFile(path.join(root, 'scripts/catalog-next/release-host.py'), 'utf8');
    const args = ['-F', '/dev/null', '-T', '-i', key, '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
      '-o', 'ForwardAgent=no', '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + known,
      '-o', 'GlobalKnownHostsFile=/dev/null', '-o', 'UpdateHostKeys=no', '-o', 'ConnectTimeout=15',
      '-o', 'ClearAllForwardings=yes', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3',
      'root@151.248.113.177', '/usr/bin/env -i PATH=/usr/bin:/bin /usr/bin/python3 -I -B -c ' + quote(source)];
    const output = await new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/ssh', args, {env: {PATH: '/usr/bin:/bin', LANG: 'C.UTF-8'}, stdio: ['pipe', 'pipe', 'pipe']});
      const chunks = []; let size = 0, failed;
      const fail = code => { failed ??= Error('obsolete_capture_' + code); child.kill('SIGTERM'); };
      const timer = setTimeout(() => fail('host_timeout'), 90000);
      child.on('error', () => fail('host_transport')); child.stdin.on('error', () => fail('host_transport'));
      child.stderr.on('data', () => {});
      child.stdout.on('data', chunk => { size += chunk.length; if (size > 128 * 1024) fail('host_output'); else chunks.push(chunk); });
      child.once('close', code => { clearTimeout(timer); if (failed) reject(failed);
        else if (code !== 0) reject(Error('obsolete_capture_host_refused')); else resolve(Buffer.concat(chunks)); });
      child.stdin.end(JSON.stringify({hostSource, hostSourceSha256: sha(hostSource), publicationState}));
    });
    return JSON.parse(output.toString('utf8'));
  } finally { if (directory) await fs.rm(directory, {recursive: true, force: true}); }
}

export async function runCapture({root = ROOT, environment = process.env, now = () => new Date().toISOString(),
  capabilities = {}, log = value => process.stdout.write(JSON.stringify(value) + '\n')} = {}) {
  const invocation = (capabilities.verifyInvocation ?? verifyInvocation)({root, environment});
  (capabilities.verifyBaselines ?? verifyFrozenSpeedBaselines)(root);
  const {definition, definitionSha256} = (capabilities.localDefinition ?? localDefinition)(root);
  const report = {version: 1, kind: 'obsolete-deployments-readonly-20261127', controllerSha: invocation.sourceSha,
    approvedControllerSha: invocation.approvedSourceSha, startedAt: now(), completed: false, readOnly: true,
    inventoryReportSha256: definition.inventoryReportSha256, definitionSha256,
    supplierRequests: 0, publicPageRequests: 0, storageWrites: 0, hostWrites: 0, cleanupAuthorized: false};
  let stateReader, queueReader, before, after, failure;
  try {
    stateReader = (capabilities.createStateReader ?? createReadonlyStateReader)({environment});
    queueReader = (capabilities.createQueueReader ?? createReadonlyQueueReader)({environment});
    need((await stateReader.assertPrivateBucket()).verified === true && (await queueReader.assertPrivateBucket()).verified === true, 'privacy');
    before = await readSnapshot(stateReader, queueReader, now); report.before = before.summary;
    verifyState(before, definition);
    const host = await (capabilities.readHost ?? readHost)({root, environment, publicationState: before.raw});
    report.host = sanitizeHostReport(host, before, definition, definitionSha256);
  } catch (error) { failure = Error(safeError(error)); }
  finally {
    if (before) {
      try {
        after = await readSnapshot(stateReader, queueReader, now); report.after = after.summary;
        report.stateStable = NAMES.every(name => same(before.raw[name], after.raw[name])) && same(before.queue, after.queue)
          && bytes(before.summary.queue.matchingTasks).equals(bytes(after.summary.queue.matchingTasks));
        if (!report.stateStable) failure ??= Error('obsolete_capture_state_changed');
      } catch { report.stateStable = false; failure ??= Error('obsolete_capture_state_changed'); }
    }
    report.completed = !failure && report.stateStable === true;
    report.status = report.completed ? 'predecessor_evidence_captured' : 'refused';
    if (failure) report.errorCode = failure.message;
    report.finishedAt = now();
    const raw = JSON.stringify(report, null, 2) + '\n'; need(Buffer.byteLength(raw) <= 128 * 1024, 'report_size');
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
    } else await runCapture();
  } catch (error) { process.stderr.write(safeError(error) + '\n'); process.exitCode = 1; }
}
