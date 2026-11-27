import {createHash} from 'node:crypto';
import {protectedChinaGenerations} from './china-state.mjs';
import {chinaGenerationRoot} from './generation-storage.mjs';
import {collectRetiredChinaGeneration, validateChinaGenerationRetirementWitness,
  REG_RETENTION_COLLECTION_POLICY, checkedGcProgress} from './china-generation-gc.mjs';
import {privateOwnerAcl, nonGrantingPolicy} from './private-storage.mjs';
import {signRawGcS3Request, parseRawGcS3Delete} from '../lib/catalog-raw-gc-s3.mjs';

export const CHINA_GC_QUEUE_KEY = 'catalog/market-rebuild/v1/china/gc/queue.json';
const TASK_ROOT = 'catalog/market-rebuild/v1/china/gc/tasks/';
// Byte bounds protect transport parsing; there is no pending generation count
// limit and a retention error never becomes a publication failure.
const QUEUE_BYTES = 16 * 1024 * 1024, TASK_BYTES = 2 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/, NONCE = /^[a-f0-9]{32}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ordered = value => Array.isArray(value) ? value.map(ordered) : object(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const encoded = value => Buffer.from(JSON.stringify(ordered(value)));
const same = (left, right) => encoded(left).equals(encoded(right));
const keys = (value, required, optional = []) => object(value) && required.every(key => Object.hasOwn(value, key))
  && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const need = (condition, code) => { if (!condition) throw Error('china_gc_queue_' + code); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const etag = value => typeof value === 'string' && /^"[^"\x00-\x20\x7f]{1,250}"$/.test(value);
const absent = () => ({found: false, etag: null, sha256: null, value: null});
const sameObservation = (left, right) => left.found === right.found && left.etag === right.etag && left.sha256 === right.sha256;
const safeCode = error => /^china_(?:gc|state|daily|host|private|generation_storage)_[a-z0-9_]{1,120}$/.test(error?.message ?? '')
  ? error.message : 'china_gc_queue_failed';
const taskKey = id => { need(HASH.test(id ?? ''), 'task_id'); return TASK_ROOT + id + '.json'; };
function immutable(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(immutable); Object.freeze(value); }
  return value;
}

function parse(bytes, maximum, code) {
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maximum, code);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw Error('china_gc_queue_' + code); }
  need(encoded(value).equals(bytes), 'canonical_document'); return value;
}
function marker(publication) {
  return {acceptedRevision: publication.accepted.value.revision, acceptedSha256: publication.accepted.sha256,
    intentSha256: publication.intent.sha256, publicationNonce: publication.intent.value.nonce};
}
function checkMarker(value) {
  need(keys(value, ['acceptedRevision', 'acceptedSha256', 'intentSha256', 'publicationNonce'])
    && positive(value.acceptedRevision) && HASH.test(value.acceptedSha256 ?? '') && HASH.test(value.intentSha256 ?? '')
    && NONCE.test(value.publicationNonce ?? ''), 'remembered_publication');
}
function identity(reference, previousAccepted, acceptedPublication) {
  return hash(encoded({generationId: reference.generationId, owner: reference.owner, receiptSha256: reference.receiptSha256,
    previousETag: previousAccepted.etag, previousSha256: previousAccepted.sha256, publication: marker(acceptedPublication)}));
}
function checkedTask(bytes, id) {
  const value = parse(bytes, TASK_BYTES, 'task_json');
  need(keys(value, ['version', 'kind', 'market', 'id', 'reference', 'previousAccepted', 'acceptedPublication'])
    && value.version === 1 && value.kind === 'china-generation-gc-task-v1' && value.market === 'china'
    && value.id === id && HASH.test(id ?? ''), 'task_identity');
  const witness = validateChinaGenerationRetirementWitness(value);
  need(witness && same(witness.reference, value.reference)
    && identity(witness.reference, witness.previousAccepted, witness.acceptedPublication) === id, 'task_witness');
  return immutable(value);
}
function checkItem(value) {
  need(keys(value, ['id', 'generationId', 'owner', 'receiptSha256', 'publicationNonce', 'taskSha256', 'phase'], ['retirementSha256'])
    && HASH.test(value.id ?? '') && HASH.test(value.receiptSha256 ?? '') && HASH.test(value.taskSha256 ?? '')
    && NONCE.test(value.publicationNonce ?? '') && ['pending', 'collected'].includes(value.phase), 'item');
  chinaGenerationRoot(value.owner);
  need(keys(value.owner, ['runId', 'attempt', 'revision'])
    && ['runId', 'attempt', 'revision'].every(key => typeof value.owner[key] === 'string')
    && value.generationId === `gen_china_${value.owner.runId}_${value.owner.attempt}`, 'item_identity');
  need(value.phase === 'collected' ? HASH.test(value.retirementSha256 ?? '') : !Object.hasOwn(value, 'retirementSha256'), 'item_phase');
}
function checkQueue(value) {
  need(keys(value, ['version', 'kind', 'market', 'revision', 'rememberedPublication', 'items'])
    && value.version === 1 && value.kind === 'china-generation-gc-queue-v1' && value.market === 'china'
    && positive(value.revision) && Array.isArray(value.items), 'document');
  if (value.rememberedPublication !== null) checkMarker(value.rememberedPublication);
  const ids = new Set(), roots = new Set();
  for (const item of value.items) {
    checkItem(item); const root = chinaGenerationRoot(item.owner);
    need(!ids.has(item.id) && !roots.has(root), 'duplicate_item'); ids.add(item.id); roots.add(root);
  }
  return value;
}
function observation(value) {
  need(keys(value, ['found', 'etag', 'sha256', 'value']) && typeof value.found === 'boolean', 'observation');
  if (!value.found) need(value.etag === null && value.sha256 === null && value.value === null, 'absent_observation');
  else {
    checkQueue(value.value);
    need(etag(value.etag) && HASH.test(value.sha256 ?? '') && hash(encoded(value.value)) === value.sha256, 'observation_binding');
  }
  return structuredClone(value);
}
function taskObservation(value, id, expectedSha256) {
  need(value && typeof value.found === 'boolean', 'task_read');
  if (!value.found) return value;
  need(etag(value.etag) && Buffer.isBuffer(value.data) && value.data.length > 0 && value.data.length === value.size
    && value.size <= TASK_BYTES && hash(value.data) === expectedSha256, 'task_checksum');
  return {...value, value: checkedTask(value.data, id)};
}
function itemFor(task, bytes) {
  return {id: task.id, generationId: task.reference.generationId, owner: task.reference.owner,
    receiptSha256: task.reference.receiptSha256, publicationNonce: task.acceptedPublication.intent.value.nonce,
    taskSha256: hash(bytes), phase: 'pending'};
}
function resolvedView(view) {
  const protection = protectedChinaGenerations(view);
  need(['idle', 'resolved'].includes(protection.reconciliation) && !view.accepted.value?.pending, 'state_unresolved');
  return view;
}

/** The index contains only unfinished references; full historical proof lives
 * in one immutable private task per displaced rollback. Before preparation use
 * enqueue-only to preserve the last resolved intent before it is overwritten.
 * After acceptance drain under the same China lease and the real job deadline.
 * A collected checkpoint precedes task removal, so lost responses are resumable.
 * Errors are retention results only: this function never revokes acceptance. */
export async function maintainChinaGenerationGcQueue({mode, previousAccepted, acceptedPublication, readState, assertAuthority,
  queueStorage, generationStorage, beforeCollect, collect = collectRetiredChinaGeneration, deadlineAt,
  environment = process.env, fetcher = globalThis.fetch, now = () => new Date().toISOString(), onProgress = () => {}, collectionPolicy}) {
  const report = {version: 1, kind: 'china-generation-gc-queue-report-v1', market: 'china', mode,
    completed: false, status: 'starting', enqueued: 0, collected: 0, pruned: 0, pending: null,
    witnessRemembered: acceptedPublication === undefined ? null : false,
    deletedObjects: 0, deletedBytes: 0, alreadyAbsentObjects: 0, errors: [],
    hostCleanupsCompleted: 0, retiredContainers: 0, filesDeleted: 0, freedBytes: 0,
    otherMarketWrites: 0, encyclopediaWrites: 0, liveCatalogWrites: 0};
  const bounded = collectionPolicy === REG_RETENTION_COLLECTION_POLICY;
  const stage = value => { if (bounded) report.stage = value; };
  let expectedState, queue;
  const deadline = deadlineAt === undefined ? null : Date.parse(deadlineAt);
  const errorSummary = error => ({code: safeCode(error),
    outcome: error?.report?.status === 'needs_reconciliation' || /outcome_unknown/.test(error?.message ?? '')
      ? 'needs_reconciliation' : 'paused'});
  async function fence() {
    if (deadline !== null) need(Date.parse(now()) < deadline, 'deadline');
    await assertAuthority();
    const view = resolvedView(await readState());
    if (expectedState) need(sameObservation(view.accepted, expectedState.accepted)
      && sameObservation(view.intent, expectedState.intent), 'state_changed');
    else expectedState = structuredClone(view);
    return view;
  }
  async function writeQueue(next) {
    checkQueue(next); need(encoded(next).length <= QUEUE_BYTES, 'document_size');
    await fence();
    const before = observation(await queueStorage.readQueue());
    need(sameObservation(before, queue), 'conflict');
    let failure;
    try { await queueStorage.compareAndSwapQueue(queue, next); } catch (error) { failure = error; }
    const actual = observation(await queueStorage.readQueue());
    if (actual.found && same(actual.value, next)) { queue = actual; return; }
    if (failure && sameObservation(actual, queue)) throw failure;
    queue = actual;
    throw Error('china_gc_queue_conflict');
  }
  function nextQueue(items, remembered = queue.value?.rememberedPublication ?? null) {
    return {version: 1, kind: 'china-generation-gc-queue-v1', market: 'china', revision: (queue.value?.revision ?? 0) + 1,
      rememberedPublication: remembered, items};
  }
  async function remember(previous, publication) {
    report.witnessRemembered = false;
    const witness = validateChinaGenerationRetirementWitness({previousAccepted: previous, acceptedPublication: publication});
    // No rollback was displaced in either of the first two publications.
    if (!witness) { report.witnessRemembered = true; return; }
    need(expectedState.accepted.value?.revision >= publication.accepted.value.revision, 'state_older_than_witness');
    const remembered = marker(publication), existingItems = queue.value?.items ?? [];
    const alreadyRemembered = same(queue.value?.rememberedPublication ?? null, remembered);
    const task = {version: 1, kind: 'china-generation-gc-task-v1', market: 'china',
      id: identity(witness.reference, witness.previousAccepted, witness.acceptedPublication), ...witness};
    const bytes = encoded(task); checkedTask(bytes, task.id);
    const item = itemFor(task, bytes), duplicate = existingItems.find(row => chinaGenerationRoot(row.owner) === chinaGenerationRoot(item.owner));
    // The compact marker remembers the latest completed publication too. An
    // indexed pending task still has to exist before its live intent is lost.
    if (alreadyRemembered && !duplicate) { report.witnessRemembered = true; return; }
    if (duplicate) need(duplicate.id === item.id && duplicate.taskSha256 === item.taskSha256, 'duplicate_witness');
    if (!duplicate || duplicate.phase === 'pending') {
      let saved = taskObservation(await queueStorage.readTask(task.id), task.id, item.taskSha256);
      if (!saved.found) {
        await fence(); let failure;
        try { await queueStorage.createTask(task.id, bytes, {ifNoneMatch: '*'}); } catch (error) { failure = error; }
        saved = taskObservation(await queueStorage.readTask(task.id), task.id, item.taskSha256);
        if (!saved.found && failure) throw failure;
        need(saved.found, 'task_write_not_committed');
      }
      need(saved.data.equals(bytes), 'task_collision');
    }
    if (alreadyRemembered && duplicate) { report.witnessRemembered = true; return; }
    const priorMarker = queue.value?.rememberedPublication;
    const checkpoint = priorMarker && priorMarker.acceptedRevision > remembered.acceptedRevision ? priorMarker : remembered;
    await writeQueue(nextQueue(duplicate ? existingItems : [...existingItems, item], checkpoint));
    report.witnessRemembered = true;
    if (!duplicate) report.enqueued++;
  }
  async function prune(item) {
    await fence();
    const actualQueue = observation(await queueStorage.readQueue());
    need(sameObservation(actualQueue, queue), 'conflict');
    const saved = taskObservation(await queueStorage.readTask(item.id), item.id, item.taskSha256);
    if (saved.found) {
      need(same({...itemFor(saved.value, saved.data), phase: 'collected', retirementSha256: item.retirementSha256}, item), 'task_item');
      await fence();
      try { await queueStorage.deleteTask(item.id, {expectedETag: saved.etag, expectedSha256: item.taskSha256}); }
      catch { throw Error('china_gc_queue_task_delete_outcome_unknown'); }
      need(!(await queueStorage.readTask(item.id)).found, 'task_delete_not_absent');
    }
    await writeQueue(nextQueue(queue.value.items.filter(row => row.id !== item.id))); report.pruned++;
  }
  try {
    need(collectionPolicy === undefined || bounded, 'collection_policy');
    need(['enqueue-only', 'drain'].includes(mode) && [readState, assertAuthority, collect, now, onProgress]
      .every(value => typeof value === 'function') && (beforeCollect === undefined || typeof beforeCollect === 'function'), 'capabilities');
    need(deadlineAt === undefined || typeof deadlineAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(deadlineAt)
      && Number.isFinite(deadline), 'deadline_value');
    need((previousAccepted === undefined) === (acceptedPublication === undefined), 'witness_arguments');
    stage('authority'); await fence();
    if (expectedState.intent.value?.status === 'committed') report.witnessRemembered = false;
    queueStorage ??= createChinaGenerationGcQueueStorage({assertAuthority: fence, environment, fetcher});
    need(['assertPrivateBucket', 'readQueue', 'compareAndSwapQueue', 'readTask', 'createTask', 'deleteTask']
      .every(name => typeof queueStorage[name] === 'function'), 'storage_capability');
    need((await queueStorage.assertPrivateBucket())?.verified === true, 'privacy');
    stage('queue'); queue = observation(await queueStorage.readQueue());
    if (acceptedPublication) await remember(previousAccepted, acceptedPublication);
    else if (expectedState.intent.found && expectedState.intent.value.status === 'committed')
      await remember(expectedState.intent.value.previous, expectedState);
    if (mode === 'drain') {
      // Read each item by its exact ID. No listing, prefix traversal, count cap or
      // arbitrary elapsed-work budget can silently discard unfinished cleanup.
      for (const original of [...(queue.value?.items ?? [])]) {
        let item = original;
        if (item.phase === 'pending') {
          await fence();
          const saved = taskObservation(await queueStorage.readTask(item.id), item.id, item.taskSha256);
          need(saved.found && same(itemFor(saved.value, saved.data), item), 'task_item');
          const task = saved.value;
          async function candidateFence() {
            const view = await fence(), protection = protectedChinaGenerations(view);
            need(view.accepted.value?.revision >= task.acceptedPublication.accepted.value.revision, 'state_older_than_witness');
            need(!protection.references.some(reference => reference.generationId === task.reference.generationId
              || chinaGenerationRoot(reference.owner) === chinaGenerationRoot(task.reference.owner)), 'generation_protected');
          }
          await candidateFence();
          // The caller retires any old native container before private parts.
          // A failed or uncertain host cleanup leaves the same durable task.
          if (beforeCollect) {
            stage('host_retirement');
            const host = await beforeCollect({task, previousAccepted: task.previousAccepted, acceptedPublication: task.acceptedPublication,
              readState, assertAuthority: candidateFence});
            need(host?.completed === true, 'host_cleanup_incomplete'); report.hostCleanupsCompleted++;
            for (const key of ['retiredContainers', 'filesDeleted', 'freedBytes']) {
              if (host[key] === undefined) report[key] = null;
              else { need(Number.isSafeInteger(host[key]) && host[key] >= 0, 'host_cleanup_report');
                if (report[key] !== null) report[key] += host[key]; }
            }
          }
          stage('collection_admission');
          await candidateFence();
          stage('collection');
          const result = await collect({previousAccepted: task.previousAccepted, acceptedPublication: task.acceptedPublication,
            readState, assertAuthority: candidateFence, storage: generationStorage, environment, fetcher, now, onProgress,
            ...(bounded ? {collectionPolicy, deadlineAt} : {})});
          if (bounded && result?.progress) report.collectionProgress = checkedGcProgress(result.progress);
          need(result?.completed === true && result.generationId === item.generationId && HASH.test(result.retirementSha256 ?? ''),
            'collection_incomplete');
          for (const name of ['deletedObjects', 'deletedBytes', 'alreadyAbsentObjects']) {
            need(Number.isSafeInteger(result[name]) && result[name] >= 0, 'collection_report'); report[name] += result[name];
          }
          item = {...item, phase: 'collected', retirementSha256: result.retirementSha256};
          stage('queue_checkpoint');
          await writeQueue(nextQueue(queue.value.items.map(row => row.id === item.id ? item : row))); report.collected++;
        }
        stage('prune'); await prune(item);
        await onProgress({phase: 'china_generation_gc_queue', collected: report.collected, pruned: report.pruned,
          pending: queue.value.items.length});
      }
    }
    stage('complete'); report.completed = true; report.status = mode === 'enqueue-only' ? 'remembered' : 'complete';
  } catch (error) {
    const summary = errorSummary(error); report.errors.push(summary); report.errorCode = summary.code;
    report.status = ['china_gc_queue_deadline', 'china_gc_deadline'].includes(summary.code) ? 'deadline' : summary.outcome;
    if (bounded && error?.report?.progress) report.collectionProgress = checkedGcProgress(error.report.progress);
    // Counts from an interrupted collector remain true observations, not proof
    // that the item completed. Unknown keys/proof bytes never enter this report.
    for (const name of ['deletedObjects', 'deletedBytes', 'alreadyAbsentObjects'])
      if (Number.isSafeInteger(error?.report?.[name]) && error.report[name] >= 0) report[name] += error.report[name];
  }
  report.pending = queue?.value?.items.length ?? (queue?.found === false ? 0 : null);
  report.finishedAt = now(); return report;
}

/** Exact China GC queue capability. The index uses native REG conditional PUT;
 * task objects are create-only, private and deleted by one exact key under the
 * exclusive lease. This makes no claim that REG supports If-Match DELETE. */
export function createChinaGenerationGcQueueStorage({assertAuthority, environment = process.env, fetcher = globalThis.fetch}) {
  need(typeof assertAuthority === 'function' && typeof fetcher === 'function', 'transport_capability');
  for (const [key, value] of Object.entries({YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud',
    YC_OBJECT_STORAGE_REGION: 'us-east-1', YC_OBJECT_STORAGE_BUCKET: 'avtocena-staging-8120751',
    YC_OBJECT_STORAGE_PREFIX: 'migration-staging/full-20261011/'})) need(environment[key] === value, 'storage_configuration');
  const accessKeyId = environment.YC_OBJECT_STORAGE_ACCESS_KEY_ID, secretAccessKey = environment.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY;
  need(typeof accessKeyId === 'string' && /^[A-Za-z0-9_+=./-]{1,256}$/.test(accessKeyId)
    && typeof secretAccessKey === 'string' && secretAccessKey.length > 0 && secretAccessKey.length <= 1024
    && !/[\r\n\x00]/.test(secretAccessKey), 'storage_credentials');
  const validKey = key => key === CHINA_GC_QUEUE_KEY || typeof key === 'string' && key.startsWith(TASK_ROOT)
    && /^[a-f0-9]{64}\.json$/.test(key.slice(TASK_ROOT.length));
  let privacy;
  async function request(method, key, query = {}, body, headers = {}, maximum = 64 * 1024) {
    need(key === null || validKey(key), 'storage_key');
    const physical = '/avtocena-staging-8120751' + (key === null ? '' : '/migration-staging/full-20261011/' + key);
    const signed = signRawGcS3Request({method, host: 's3.regru.cloud', path: physical, query, body: body ?? '', headers,
      region: 'us-east-1', accessKeyId, secretAccessKey, at: Date.now()});
    let response;
    try { response = await fetcher('https://s3.regru.cloud' + signed.canonicalPath
      + (signed.canonicalQuery ? '?' + signed.canonicalQuery : ''), {method, headers: signed.headers, body,
      redirect: 'error', signal: AbortSignal.timeout(30000)}); }
    catch { throw Error('china_gc_queue_storage_transport'); }
    const chunks = []; let size = 0;
    try { for await (const chunk of response.body ?? []) {
      size += chunk.byteLength; need(size <= maximum, 'storage_response_size'); chunks.push(Buffer.from(chunk));
    }} catch { throw Error('china_gc_queue_storage_incomplete'); }
    return {status: response.status, data: Buffer.concat(chunks, size), etag: response.headers.get('etag')};
  }
  async function assertPrivateBucket() {
    const acl = await request('GET', null, {acl: ''}); need(acl.status === 200, 'bucket_acl');
    const owner = privateOwnerAcl(acl.data.toString()), policy = await request('GET', null, {policy: ''});
    const next = {owner, policySha256: nonGrantingPolicy(policy.status, policy.data.toString())};
    if (privacy) need(same(next, privacy), 'privacy_changed'); else privacy = next;
    return {verified: true};
  }
  async function read(key, maximum) {
    need(privacy && validKey(key), 'storage_key');
    const acl = await request('GET', key, {acl: ''}), value = await request('GET', key, {}, undefined, {}, maximum);
    if (acl.status === 404) { need(value.status === 404, 'missing_changed'); return {found: false}; }
    need(acl.status === 200 && privateOwnerAcl(acl.data.toString()) === privacy.owner, 'object_acl');
    need(value.status === 200 && etag(value.etag) && value.data.length > 0, 'storage_read');
    return {found: true, data: value.data, size: value.data.length, etag: value.etag};
  }
  async function readQueue() {
    const value = await read(CHINA_GC_QUEUE_KEY, QUEUE_BYTES);
    if (!value.found) return absent();
    return observation({found: true, etag: value.etag, sha256: hash(value.data), value: parse(value.data, QUEUE_BYTES, 'document')});
  }
  async function compareAndSwapQueue(previous, next) {
    need(privacy, 'privacy'); observation(previous); checkQueue(next);
    need(next.revision === (previous.value?.revision ?? 0) + 1, 'revision');
    const bytes = encoded(next); need(bytes.length <= QUEUE_BYTES, 'document_size'); await assertAuthority();
    const response = await request('PUT', CHINA_GC_QUEUE_KEY, {}, bytes, {'content-type': 'application/json', 'x-amz-acl': 'private',
      ...(previous.found ? {'if-match': previous.etag.slice(1, -1)} : {'if-none-match': '*'})});
    if ([409, 412].includes(response.status)) throw Error('china_gc_queue_conflict');
    need([200, 201].includes(response.status), 'write_failed');
  }
  const readTask = id => read(taskKey(id), TASK_BYTES);
  async function createTask(id, bytes, condition) {
    need(privacy && same(condition, {ifNoneMatch: '*'}), 'task_write_scope'); checkedTask(bytes, id); await assertAuthority();
    const response = await request('PUT', taskKey(id), {}, bytes,
      {'content-type': 'application/json', 'x-amz-acl': 'private', 'if-none-match': '*'});
    need([200, 201].includes(response.status), 'task_write_failed');
  }
  async function deleteTask(id, condition) {
    need(privacy && keys(condition, ['expectedETag', 'expectedSha256']) && etag(condition.expectedETag)
      && HASH.test(condition.expectedSha256 ?? ''), 'task_delete_scope');
    const current = taskObservation(await readTask(id), id, condition.expectedSha256);
    need(current.found && current.etag === condition.expectedETag, 'task_changed'); await assertAuthority();
    const key = taskKey(id), body = '<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>false</Quiet><Object><Key>'
      + 'migration-staging/full-20261011/' + key + '</Key></Object></Delete>';
    const response = await request('POST', null, {delete: ''}, body,
      {'content-type': 'application/xml', 'content-md5': createHash('md5').update(body).digest('base64')});
    need(response.status === 200, 'task_delete_response');
    const result = parseRawGcS3Delete(response.data.toString(), [{key}]);
    need(result.settled === true && result.results.length === 1 && result.results[0].status === 'deleted', 'task_delete_rejected');
    return {settled: true, deleted: true};
  }
  return Object.freeze({assertPrivateBucket, readQueue, compareAndSwapQueue, readTask, createTask, deleteTask});
}
