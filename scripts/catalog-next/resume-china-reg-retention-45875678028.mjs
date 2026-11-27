import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {verifyReadonlyInvocation} from '../lib/readonly-marker-invocation.mjs';
import {createChinaStateStorage, createChinaState, inspectChinaPublicationState,
  protectedChinaGenerations, validateChinaGenerationReference} from './china-state.mjs';
import {createChinaGenerationGcQueueStorage, maintainChinaGenerationGcQueue} from './china-generation-gc-queue.mjs';
import {readChinaDailyPlans, selectChinaDailyServingPlan} from './daily-entry.mjs';
import {createChinaDailyRelease} from './daily-release.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const MARKER = '.github/market-runs/china-reg-retention-resume-45875678028.json';
export const WORKFLOW = 'jeep-jim/AvtoCena/.github/workflows/china-reg-retention-resume-45875678028.yml@refs/heads/main';
export const REPORT = 'china-reg-retention-resume-45875678028-report.json';
export const OPERATION = 'resume-china-reg-retention-after-45875678028';
export const JOB_MINUTES = 30, FINALIZE_RESERVE_MS = 120000;
export const PINS = Object.freeze({
  current: 'gen_china_45875678028_1',
  currentOwner: Object.freeze({runId: '45875678028', attempt: '1', revision: '6ac99e79457bb7183a263017dbfd4e76e5ad5d1d'}),
  currentReceipt: 'fb887cb058f90c0c79308fa8d42801c622f96d7f26d3e97addf53f135a071793',
  currentManifest: '58263ea4dc5642c9ff6f544830e9d3536ba702fb729a7a8c33b049b70b737038',
  currentDescriptor: 'c6c69df61ccabfbc187f8e76bc0d2b47aa5f3561362cefcaa547e9f457acb5e9',
  currentSourceDate: '2026-11-26T19:04:39.089Z', currentCursor: 13340204,
  pricing: '64c6338e0db23c8999096bceefbf113c0136fe15',
  retainedRuntime: '077cbb17626ab0c64e7f06db055fef9252ad21c0',
  codeRuntime: 'a5ca426eec2663eb17c2df69fe2bfed46e2b8740',
  // Historical witnesses retain the runtimes above. A new maintenance run
  // additionally requires this exact accepted current/rollback pair.
  expectedRuntime: 'b9e9122b75f4e588088d0241476b18df7f047d96',
  expectedRollbackRuntime: 'a5ca426eec2663eb17c2df69fe2bfed46e2b8740',
  a: 'gen_china_45369451603_1', aTask: '5852cac7f4860548c075e3d761cb1d18e178867d6e4c34f305fdb22839276b69',
  b: 'gen_china_45655051136_1',
  bOwner: Object.freeze({runId: '45655051136', attempt: '1', revision: '5e6f1de8203352cbbb2d8296b2a2cb01e1273f47'}),
  bReceipt: 'c58ef43f978922dda200076565fe9e50084197d42ebbf487fe6baf86791b2e69'
});
const HASH = /^[a-f0-9]{64}$/, SHA = /^[a-f0-9]{40}$/;
const need = (ok, code) => { if (!ok) throw Error('china_retention_resume_' + code); };
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const same = (left, right) => JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
const sameObservation = (left, right) => left?.found === right?.found && left?.etag === right?.etag && left?.sha256 === right?.sha256;
const integer = value => Number.isSafeInteger(value) && value >= 0;
const iso = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value)
  && Number.isFinite(Date.parse(value));
const localCodes = new Set(['arguments','workflow','event','deadline','deadline_auth','deadline_job','deadline_http','deadline_size',
  'state','state_changed','current_binding','rollback_binding','lease_lost','storage_scope','queue_scope','task_scope',
  'target_protected','result','privacy','report_write','plans']);
export function safeError(error) {
  const message = error?.message;
  if (typeof message !== 'string') return 'operation_failed';
  const prefix = 'china_retention_resume_';
  if (message.startsWith(prefix) && localCodes.has(message.slice(prefix.length))) return message.slice(prefix.length);
  if (message === 'china_gc_storage_transport') return 'storage_transport';
  if (message === 'china_gc_storage_incomplete') return 'storage_incomplete';
  if (message === 'china_gc_queue_deadline') return 'deadline';
  if (message === 'china_state_lease_held') return 'lease_busy';
  if (['china_state_lease_changed','china_state_lease_not_active','china_state_lease_expired'].includes(message)) return 'lease_lost';
  if (['china_gc_delete_outcome_unknown','china_gc_queue_task_delete_outcome_unknown'].includes(message)) return 'outcome_unknown';
  return 'operation_failed';
}

const AUTHORITY_FAILURE_REASONS = new Map([
  ['china_state_storage_transport','storage_transport'],
  ['china_state_storage_response_incomplete','storage_incomplete'],
  ['china_state_conflict','conflict'],
  ['china_state_write_not_committed','write_not_committed'],
  ['china_state_lease_not_active','lease_not_active'],
  ['china_state_lease_extension','lease_extension'],
  ['china_state_read','storage_read'],
  ['china_state_object_acl','object_acl'],
  ['china_state_canonical_document','invalid_document'],
  ['china_retention_resume_lease_lost','lease_lost']
]);
function authorityFailureReason(error) {
  try { return AUTHORITY_FAILURE_REASONS.get(error?.message) ?? 'operation_failed'; }
  catch { return 'operation_failed'; }
}
function gcTransportCategory(error) {
  try {
    if (error?.name === 'TimeoutError') return 'timeout';
    if (error?.name === 'AbortError') return 'aborted';
    const code = error?.cause?.code ?? error?.code;
    if (['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT'].includes(code)) return 'timeout';
    if (['ENOTFOUND','EAI_AGAIN'].includes(code)) return 'dns';
    if (['ECONNRESET','ECONNREFUSED','EPIPE','UND_ERR_SOCKET'].includes(code)) return 'connection';
    if (['ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT',
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code)) return 'tls';
    if (error?.name === 'TypeError') return 'network';
  } catch {}
  return 'unknown';
}
// Observe only an existing request rejection. Never inspect its URL, headers or
// body, retry it, replace its signal, or change the original thrown error.
function observedGcFetcher(fetcher, report) {
  return async (...args) => {
    let started; try { started = performance.now(); } catch {}
    try { return await fetcher(...args); }
    catch (error) {
      if (!report.gcTransportFailure) {
        try {
          const method = args[1]?.method, elapsed = performance.now() - started;
          report.gcTransportFailure = {category:gcTransportCategory(error),
            method:['GET','HEAD','PUT','POST'].includes(method) ? method : 'unknown',
            durationMs:Number.isFinite(elapsed) && elapsed >= 0 ? Math.round(elapsed) : null};
        } catch {}
      }
      throw error;
    }
  };
}

export function verifyInvocation({root = ROOT, environment = process.env} = {}) {
  need(environment.GITHUB_WORKFLOW_REF === WORKFLOW && environment.GITHUB_JOB === 'resume-retention', 'workflow');
  // This maintenance has no schedule/manual shortcut: a reviewed marker-only
  // push is the sole production trigger. The shared guard verifies its parent.
  need(environment.GITHUB_EVENT_NAME === 'push', 'event');
  return verifyReadonlyInvocation({root, env: environment, markerPath: MARKER, operation: OPERATION});
}
export function leaseOnlyStorage(storage) {
  need(storage && ['assertPrivateBucket','read','compareAndSwap'].every(key => typeof storage[key] === 'function'), 'arguments');
  return Object.freeze({
    assertPrivateBucket: () => storage.assertPrivateBucket(),
    read(name) { need(['accepted','intent','lease'].includes(name), 'storage_scope'); return storage.read(name); },
    compareAndSwap(name, previous, value) {
      need(name === 'lease', 'storage_scope'); return storage.compareAndSwap(name, previous, value);
    }
  });
}
export function verifyState(view) {
  need(inspectChinaPublicationState(view).status === 'resolved' && !view.accepted.value.pending
    && view.intent.value.status === 'committed', 'state');
  const current = validateChinaGenerationReference(view.accepted.value.current, {requireAccepted: true});
  need(current.generationId === PINS.current && same(current.owner, PINS.currentOwner)
    && current.receiptSha256 === PINS.currentReceipt && current.generationManifestSha256 === PINS.currentManifest
    && current.sourceDescriptorSha256 === PINS.currentDescriptor && current.sourceObservedAt === PINS.currentSourceDate
    && current.sourceCursor === PINS.currentCursor && current.pricingRuntimeSha === PINS.pricing
    && current.runtimeSha === PINS.expectedRuntime, 'current_binding');
  const rollback = validateChinaGenerationReference(view.accepted.value.rollback, {requireAccepted: true});
  need(rollback.generationId === PINS.current && rollback.runtimeSha === PINS.expectedRollbackRuntime
    && rollback.pricingRuntimeSha === PINS.pricing && rollback.receiptSha256 === PINS.currentReceipt
    && rollback.generationManifestSha256 === PINS.currentManifest && same(rollback.owner, PINS.currentOwner)
    && rollback.sourceDescriptorSha256 === PINS.currentDescriptor
    && rollback.sourceObservedAt === PINS.currentSourceDate && rollback.sourceCursor === PINS.currentCursor, 'rollback_binding');
  return current;
}
function target(value, id) {
  need(value && HASH.test(id ?? '') && value.owner && value.owner.attempt === '1'
    && SHA.test(value.owner.revision ?? '') && HASH.test(value.receiptSha256 ?? ''), 'task_scope');
  if (value.generationId === PINS.a)
    need(id === PINS.aTask && value.owner.runId === '45369451603', 'task_scope');
  else need(value.generationId === PINS.b && same(value.owner, PINS.bOwner)
    && value.receiptSha256 === PINS.bReceipt, 'task_scope');
}
export function verifyTask(task) {
  need(task && task.version === 1 && task.kind === 'china-generation-gc-task-v1' && task.market === 'china'
    && task.reference?.market === 'china', 'task_scope');
  target(task.reference, task.id);
  // Full task identity, private receipt and historical publication proofs are
  // additionally verified by existing checkedTask before any GC operation.
  return task.reference;
}
export function scopedQueueStorage(storage) {
  need(storage && ['assertPrivateBucket','readQueue','compareAndSwapQueue','readTask','createTask','deleteTask']
    .every(key => typeof storage[key] === 'function'), 'arguments');
  const known = new Set();
  function queue(value) {
    need(value && Array.isArray(value.items) && value.items.length <= 2, 'queue_scope');
    const generations = new Set();
    for (const item of value.items) {
      target(item, item.id); need(!generations.has(item.generationId), 'queue_scope');
      generations.add(item.generationId); known.add(item.id);
    }
  }
  function task(bytes, id) {
    need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 2 * 1024 * 1024, 'task_scope');
    let value; try { value = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
    catch { throw Error('china_retention_resume_task_scope'); }
    need(value.id === id, 'task_scope'); verifyTask(value); known.add(id);
  }
  return Object.freeze({
    assertPrivateBucket: () => storage.assertPrivateBucket(),
    async readQueue() { const value = await storage.readQueue(); if (value.found) queue(value.value); return value; },
    compareAndSwapQueue(previous, next) { if (previous.found) queue(previous.value); queue(next); return storage.compareAndSwapQueue(previous, next); },
    async readTask(id) { need(HASH.test(id ?? ''), 'task_scope'); const value = await storage.readTask(id);
      if (value.found) task(value.data, id); return value; },
    createTask(id, bytes, condition) { task(bytes, id); return storage.createTask(id, bytes, condition); },
    deleteTask(id, condition) { need(known.has(id), 'task_scope'); return storage.deleteTask(id, condition); }
  });
}
export function aggregateGc(value) {
  need(value?.version === 1 && value.kind === 'china-generation-gc-queue-report-v1' && value.market === 'china'
    && value.mode === 'drain' && typeof value.completed === 'boolean'
    && ['complete','paused','needs_reconciliation','deadline'].includes(value.status)
    && (value.pending === null || integer(value.pending) && value.pending <= 2)
    && value.otherMarketWrites === 0 && value.encyclopediaWrites === 0 && value.liveCatalogWrites === 0, 'result');
  need(value.completed ? value.status === 'complete' && value.pending === 0 : value.status !== 'complete', 'result');
  const output = {completed:value.completed, status:value.status, pending:value.pending};
  for (const key of ['enqueued','collected','pruned','deletedObjects','deletedBytes','alreadyAbsentObjects',
    'hostCleanupsCompleted','retiredContainers','filesDeleted','freedBytes']) {
    need(integer(value[key]), 'result'); output[key] = value[key];
  }
  if (value.errorCode !== undefined) output.errorCode = safeError({message:value.errorCode});
  return output;
}

export async function readDeadline({environment = process.env, fetcher = globalThis.fetch, now = () => Date.now()} = {}) {
  need(/^[1-9]\d{0,19}$/.test(environment.GITHUB_RUN_ID ?? '') && SHA.test(environment.GITHUB_SHA ?? '')
    && typeof environment.GITHUB_TOKEN === 'string' && environment.GITHUB_TOKEN.length > 0, 'deadline_auth');
  const response = await fetcher('https://api.github.com/repos/jeep-jim/AvtoCena/actions/runs/' +
    environment.GITHUB_RUN_ID + '/jobs?filter=latest&per_page=100', {
      headers:{accept:'application/vnd.github+json', authorization:'Bearer ' + environment.GITHUB_TOKEN,
        'x-github-api-version':'2022-11-28'}, redirect:'error', signal:AbortSignal.timeout(15000)});
  need(response.status === 200, 'deadline_http');
  const chunks = []; let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength; need(size <= 256 * 1024, 'deadline_size'); chunks.push(Buffer.from(chunk));
  }
  let value; try { value = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw Error('china_retention_resume_deadline_job'); }
  need(value?.total_count === 2 && Array.isArray(value.jobs) && value.jobs.length === 2, 'deadline_job');
  const checks = value.jobs.filter(job => job.name === 'verify'), active = value.jobs.filter(job => job.name === 'resume-retention');
  need(checks.length === 1 && active.length === 1 && checks[0].status === 'completed' && checks[0].conclusion === 'success'
    && value.jobs.every(job => String(job.run_id) === environment.GITHUB_RUN_ID && job.head_sha === environment.GITHUB_SHA), 'deadline_job');
  const job = active[0], started = Date.parse(job.started_at), clock = now();
  need(job.status === 'in_progress' && job.conclusion === null && Number.isFinite(started)
    && started <= clock, 'deadline_job');
  const deadline = started + JOB_MINUTES * 60000 - FINALIZE_RESERVE_MS;
  need(clock < deadline, 'deadline');
  return new Date(deadline).toISOString();
}

async function retireOnly({root, runnerTemp, environment, invocation, current, args}) {
  const plans = await readChinaDailyPlans(root), servingPlan = selectChinaDailyServingPlan(plans, current.runtimeSha);
  need(plans.pricingPlan.runtimeSha === PINS.pricing
    && servingPlan.runtimeSha === PINS.expectedRuntime, 'plans');
  // Only the existing host-retirement callback is retained. Its implementation
  // uses authenticated retire_recovery and actual saved host proofs; it does
  // not access servingRoot, run a build, restore source, reserve or activate.
  // The controller root satisfies the factory's unused directory argument.
  const release = createChinaDailyRelease({root, servingRoot:root, runnerTemp, environment,
    controllerSha:invocation.sourceSha, pricingPlan:plans.pricingPlan, servingPlan});
  return release.retireHost(args);
}
const heartbeat = (fn, interval) => { const timer = setInterval(fn, interval); timer.unref?.(); return () => clearInterval(timer); };
export async function runRetention({root = ROOT, environment = process.env, capabilities = {},
  now = () => new Date().toISOString(), scheduleHeartbeat = heartbeat, fetcher = globalThis.fetch} = {}) {
  const defaults = {verifyInvocation, createStorage: args => createChinaStateStorage(args),
    createQueueStorage: args => createChinaGenerationGcQueueStorage(args),
    collectQueue: maintainChinaGenerationGcQueue, readDeadline, retireHost: retireOnly,
    writeReport: report => fs.writeFile(path.join(root, REPORT), JSON.stringify(report, null, 2) + '\n', {mode:0o600})};
  need(capabilities && Object.keys(capabilities).every(key => Object.hasOwn(defaults,key) && typeof capabilities[key] === 'function')
    && typeof now === 'function' && typeof scheduleHeartbeat === 'function' && typeof fetcher === 'function', 'arguments');
  const use = {...defaults,...capabilities}, report = {version:1, kind:'china-reg-retention-resume-v1', market:'china',
    completed:false, status:'starting', currentGenerationId:PINS.current, allowedGenerations:[PINS.a,PINS.b],
    supplierRequests:0, sourcePreparations:0, applicationBuilds:0, publicationReservations:0,
    acceptedStateWrites:0, intentStateWrites:0, leaseAcquired:false, leaseReleased:false};
  const gcFetcher = observedGcFetcher(fetcher, report);
  let state, lease, stopHeartbeat, expected, invocation, current, deadlineAt, authorityFailure, attemptedAcquire = false;
  const nonce = randomBytes(16).toString('hex');
  let queue = Promise.resolve();
  const serial = work => { const result = queue.then(work); queue = result.catch(() => {}); return result; };
  const at = () => { const value = now(); need(iso(value),'arguments'); return value; };
  const pair = async () => { const [accepted,intent] = await Promise.all([state.read('accepted'),state.read('intent')]); return {accepted,intent}; };
  async function verifyLease(observeFailure = false) {
    if (authorityFailure) throw Error('china_retention_resume_lease_lost');
    let phase = 'lease_read';
    try {
      const observed = await state.read('lease'), time = Date.parse(at());
      need(lease && sameObservation(observed,lease) && observed.value.status === 'held' && Date.parse(observed.value.expiresAt) > time, 'lease_lost');
      if (Date.parse(lease.value.expiresAt) - time <= 450000) {
        phase = 'lease_renew';
        lease = await state.renewLease({lease,expiresAt:new Date(time + 900000).toISOString()});
      }
    } catch (error) {
      if (observeFailure && !report.authorityFailure)
        report.authorityFailure = {phase,reason:authorityFailureReason(error)};
      throw error;
    }
  }
  const readState = () => serial(async () => {
    need(Date.parse(at()) < Date.parse(deadlineAt),'deadline'); await verifyLease();
    const view = await pair(); verifyState(view);
    need(sameObservation(view.accepted,expected.accepted) && sameObservation(view.intent,expected.intent),'state_changed');
    return view;
  });
  const assertAuthority = async () => { await readState(); };
  try {
    report.startedAt = at();
    invocation = use.verifyInvocation({root,environment});
    need(invocation?.version === 1 && invocation.event === 'push' && SHA.test(invocation.sourceSha ?? '')
      && /^[1-9]\d{0,19}$/.test(environment.GITHUB_RUN_ID ?? '') && environment.GITHUB_RUN_ATTEMPT === '1', 'arguments');
    report.controllerSha = invocation.sourceSha;
    deadlineAt = await use.readDeadline({environment,now:() => Date.parse(at())});
    need(iso(deadlineAt) && Date.parse(deadlineAt) > Date.parse(at())
      && Date.parse(deadlineAt) - Date.parse(at()) <= JOB_MINUTES * 60000, 'deadline');
    report.deadlineAt = deadlineAt;
    const storage = leaseOnlyStorage(await use.createStorage({environment}));
    need((await storage.assertPrivateBucket())?.verified === true,'privacy');
    state = createChinaState({storage,now:at});
    const previous = await state.read('lease'), time = Date.parse(at());
    if (previous.value?.status === 'held' && Date.parse(previous.value.expiresAt) > time)
      throw Error('china_state_lease_held');
    attemptedAcquire = true;
    lease = await state.acquireLease({previous,owner:{runId:environment.GITHUB_RUN_ID,attempt:'1',revision:invocation.sourceSha},
      nonce,expiresAt:new Date(time + 900000).toISOString()});
    report.leaseAcquired = true;
    expected = await pair(); current = verifyState(expected);
    report.currentRuntimeSha = current.runtimeSha; report.acceptedRevision = expected.accepted.value.revision;
    stopHeartbeat = scheduleHeartbeat(() => { void serial(() => verifyLease(true))
      .catch(error => { authorityFailure ??= authorityFailureReason(error); }); },30000);
    need(typeof stopHeartbeat === 'function','arguments');
    await assertAuthority();
    const queueStorage = scopedQueueStorage(await use.createQueueStorage({assertAuthority,environment,fetcher:gcFetcher}));
    const result = await use.collectQueue({mode:'drain',deadlineAt,readState,assertAuthority,queueStorage,environment,now:at,fetcher:gcFetcher,
      beforeCollect: async args => {
        const reference = verifyTask(args.task);
        await args.assertAuthority(); const view = await readState();
        need(!protectedChinaGenerations(view).references.some(item => item.generationId === reference.generationId),'target_protected');
        return use.retireHost({root,runnerTemp:environment.RUNNER_TEMP,environment,invocation,current,args});
      }});
    report.retention = aggregateGc(result);
    await assertAuthority();
    report.completed = report.retention.completed && report.retention.pending === 0;
    report.status = report.completed ? 'complete' : report.retention.status;
    if (report.retention.errorCode) report.errorCode = report.retention.errorCode;
  } catch (error) {
    report.errorCode = safeError(error);
    report.status = report.errorCode === 'lease_busy' ? 'lease_busy'
      : report.errorCode === 'outcome_unknown' ? 'needs_reconciliation' : 'paused';
  } finally {
    stopHeartbeat?.(); await queue;
    if (state && attemptedAcquire) {
      try {
        // Recover an acknowledged-but-unread acquire only when the actual lease
        // still has this exact owner+nonce. Never release a replacement holder.
        if (!lease) {
          const observed = await state.read('lease');
          if (observed.value?.status === 'held' && observed.value.nonce === nonce
            && observed.value.owner?.runId === environment.GITHUB_RUN_ID
            && observed.value.owner?.attempt === '1' && observed.value.owner?.revision === invocation.sourceSha) {
            lease = observed; report.leaseAcquired = true;
          }
        }
        if (lease) { await state.releaseLease({lease}); report.leaseReleased = true; }
        else report.leaseReleasePending = true;
      } catch { report.leaseReleasePending = true; }
    }
    if (report.leaseReleasePending) { report.completed = false; report.status = 'needs_reconciliation'; }
    report.finishedAt = at();
    try { await use.writeReport(report); } catch { report.completed = false; report.status = 'paused'; report.errorCode = 'report_write'; }
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') {
    console.error(JSON.stringify({version:1,kind:'china-reg-retention-resume-v1',completed:false,errorCode:'arguments'}));
    process.exitCode = 1;
  } else {
    runRetention().then(report => { console.log(JSON.stringify(report)); if (!report.completed) process.exitCode = 1; })
      .catch(error => { console.error(JSON.stringify({version:1,kind:'china-reg-retention-resume-v1',completed:false,
        errorCode:safeError(error)})); process.exitCode = 1; });
  }
}
