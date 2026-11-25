import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {CHINA_GENERATION_FILES, chinaGenerationRoot} from './generation-storage.mjs';
import {validateChinaGenerationReference, protectedChinaGenerations} from './china-state.mjs';
import {privateOwnerAcl, nonGrantingPolicy} from './private-storage.mjs';
import {signRawGcS3Request, parseRawGcS3Delete} from '../lib/catalog-raw-gc-s3.mjs';

const PART = 8 * 1024 * 1024, DESCRIPTOR_LIMIT = 1024 * 1024, RETIREMENT_LIMIT = 24 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const requiredFiles = ['DISPOSITIONS.ndjson', 'FILTER_SEMANTICS.json', 'FX_RECEIPT.json', 'GENERATION.json',
  'RECONCILIATION.json', 'RUNTIME_CONTEXT.json', 'SOURCE.json', 'details.sqlite', 'query.sqlite', 'source.sqlite'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const same = (left, right) => JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
const need = (condition, code) => { if (!condition) throw Error('china_gc_' + code); };
const positive = value => Number.isSafeInteger(value) && value > 0;
const etag = value => typeof value === 'string' && /^"[^"\x00-\x20\x7f]{1,250}"$/.test(value);
const absent = () => ({found: false, etag: null, sha256: null, value: null});
const sameObservation = (left, right) => left.found === right.found && left.etag === right.etag && left.sha256 === right.sha256;
const rootOf = reference => chinaGenerationRoot(reference.owner);
const sameRoot = (left, right) => left.generationId === right.generationId || rootOf(left) === rootOf(right);
const safeCode = error => /^china_(?:gc|state|daily|generation_storage|private)_[a-z0-9_]{1,120}$/.test(error?.message ?? '')
  ? error.message : 'china_gc_failed';

function parse(bytes, maximum, code) {
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maximum, code);
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { throw Error('china_gc_' + code); }
}
function base64(value, maximum, code) {
  need(typeof value === 'string' && value.length <= Math.ceil(maximum / 3) * 4, code);
  const bytes = Buffer.from(value, 'base64');
  need(bytes.toString('base64') === value && bytes.length > 0 && bytes.length <= maximum, code);
  return bytes;
}
function objectMetadata(value, code) {
  need(value && typeof value.found === 'boolean', code);
  if (value.found) need(etag(value.etag) && positive(value.size), code);
  return value;
}
function binary(value, maximum, code) {
  objectMetadata(value, code);
  need(value.found && Buffer.isBuffer(value.data) && value.data.length === value.size && value.size <= maximum, code);
  return value;
}

function previousReference(previousAccepted) {
  // Reuse the state module's full canonical observation/proof validation.
  protectedChinaGenerations({accepted: previousAccepted, intent: absent()});
  need(!previousAccepted.value?.pending, 'previous_pending');
  const reference = previousAccepted.value?.rollback;
  return reference ? validateChinaGenerationReference(reference, {requireAccepted: true}) : null;
}
function checkedState(view, candidate) {
  const protection = protectedChinaGenerations(view);
  need(view.accepted.found && view.accepted.value.current && !view.accepted.value.pending
    && ['idle', 'resolved'].includes(protection.reconciliation), 'state_unresolved');
  need(!protection.references.some(reference => sameRoot(reference, candidate)), 'generation_protected');
  return view;
}
function retirementSuccessor(view, previousAccepted) {
  need(view.intent.found && view.intent.value.status === 'committed'
    && sameObservation(view.intent.value.previous, previousAccepted)
    && view.accepted.value.commit.previousETag === previousAccepted.etag
    && view.accepted.value.commit.previousStateSha256 === previousAccepted.sha256
    && view.accepted.value.commit.nonce === view.intent.value.nonce
    && view.accepted.value.commit.intentSha256 === hash(JSON.stringify(ordered({...view.intent.value, status: 'pending', resolution: null})))
    && view.intent.value.resolution.hostReceiptSha256 === view.accepted.value.current.proof.hostReceiptSha256
    && view.accepted.value.revision === previousAccepted.value.revision + 2
    && same(view.accepted.value.rollback, previousAccepted.value.current), 'publication_successor');
  const {proof, ...current} = view.accepted.value.current;
  need(same(current, view.intent.value.candidate), 'publication_candidate');
}

/** Historical authority is the original, fully committed successor. Current
 * observations remain a separate live protection fence: a newer publication
 * does not erase a durable pending cleanup task's original permission. */
export function validateChinaGenerationRetirementWitness({previousAccepted, acceptedPublication}) {
  const reference = previousReference(previousAccepted);
  if (!reference) return null;
  const protection = protectedChinaGenerations(acceptedPublication);
  need(acceptedPublication.accepted.found && acceptedPublication.accepted.value.current
    && !acceptedPublication.accepted.value.pending && ['idle', 'resolved'].includes(protection.reconciliation), 'state_unresolved');
  retirementSuccessor(acceptedPublication, previousAccepted);
  // A code publication can leave two deployment receipts for the same data.
  // Displacing one deployment does not retire that generation while another
  // current/rollback reference still uses it. Do not enqueue an impossible GC
  // task; a later fully accepted successor will provide its own exact witness.
  if (protection.references.some(retained => sameRoot(retained, reference))) return null;
  const result = structuredClone({reference, previousAccepted, acceptedPublication});
  const freeze = value => { if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze); Object.freeze(value);
  } return value; };
  return freeze(result);
}

function checkedReceipt(bytes, reference) {
  need(hash(bytes) === reference.receiptSha256, 'receipt_checksum');
  const receipt = parse(bytes, PART, 'receipt_json'), root = rootOf(reference), names = receipt?.files?.map(file => file.name);
  need(receipt.version === 1 && receipt.kind === 'china-private-generation-v1' && receipt.market === 'china'
    && receipt.root === root && same(receipt.owner, reference.owner) && receipt.published === false
    && receipt.liveCatalogWrites === 0 && receipt.deletions === 0 && receipt.binding?.market === 'china'
    && receipt.binding.generationId === reference.generationId && receipt.binding.runtimeSha === reference.pricingRuntimeSha
    && receipt.binding.sourceDescriptorSha256 === reference.sourceDescriptorSha256
    && receipt.binding.generationManifestSha256 === reference.generationManifestSha256, 'receipt_identity');
  need(Array.isArray(names) && names.length > 0 && new Set(names).size === names.length
    && same(names, [...names].sort()) && names.every(name => CHINA_GENERATION_FILES.includes(name))
    && requiredFiles.every(name => names.includes(name)), 'receipt_files');
  let totalBytes = 0, storedBytes = 0;
  const objects = [{key: root + '/complete.json', size: bytes.length, sha256: reference.receiptSha256}];
  for (const file of receipt.files) {
    need(positive(file.bytes) && HASH.test(file.sha256 ?? '') && Array.isArray(file.parts)
      && file.parts.length === Math.ceil(file.bytes / PART), 'file_descriptor');
    file.parts.forEach((part, index) => {
      need(positive(part.bytes) && part.bytes <= PART && ['identity', 'gzip'].includes(part.encoding)
        && part.rawBytes === Math.min(PART, file.bytes - index * PART)
        && HASH.test(part.sha256 ?? '') && HASH.test(part.rawSha256 ?? '')
        && part.key === `${root}/files/${file.name}/${index}-${part.sha256}`, 'part_descriptor');
      objects.push({key: part.key, size: part.bytes, sha256: part.sha256}); storedBytes += part.bytes;
    });
    totalBytes += file.bytes;
  }
  need(Number.isSafeInteger(totalBytes) && Number.isSafeInteger(storedBytes)
    && receipt.totalBytes === totalBytes && receipt.storedBytes === storedBytes
    && receipt.files.find(file => file.name === 'SOURCE.json').sha256 === reference.sourceDescriptorSha256
    && receipt.files.find(file => file.name === 'GENERATION.json').sha256 === reference.generationManifestSha256,
  'receipt_totals');
  return {receipt, objects};
}
function descriptorBinding(receipt, reference, sourceBytes, generationBytes) {
  const sourceFile = receipt.files.find(file => file.name === 'SOURCE.json');
  const generationFile = receipt.files.find(file => file.name === 'GENERATION.json');
  need(sourceBytes.length === sourceFile.bytes && hash(sourceBytes) === sourceFile.sha256
    && generationBytes.length === generationFile.bytes && hash(generationBytes) === generationFile.sha256, 'descriptor_checksum');
  const source = parse(sourceBytes, DESCRIPTOR_LIMIT, 'source_json');
  const generation = parse(generationBytes, DESCRIPTOR_LIMIT, 'generation_json');
  const matchesFile = (descriptor, name) => {
    const file = receipt.files.find(row => row.name === name);
    need(descriptor?.name === name && descriptor.bytes === file?.bytes && descriptor.sha256 === file?.sha256, 'descriptor_file');
  };
  need(source.version === 1 && source.kind === 'china-refreshed-source-descriptor-v1' && source.market === 'china'
    && source.manifest?.kind === 'china-refreshed-source-v1' && source.manifest.market === 'china'
    && source.manifest.source?.cursor === reference.sourceCursor && source.manifest.sourceObservedAt === reference.sourceObservedAt
    && source.manifest.supplierLatestVerified === true, 'source_binding');
  matchesFile(source.file, 'source.sqlite');
  need(generation.version === 1 && generation.kind === 'china-local-generation-v1' && generation.market === 'china'
    && generation.generationId === reference.generationId && generation.runtimeSha === reference.pricingRuntimeSha
    && generation.prepared === true && generation.published === false && generation.activationAuthorized === false
    && generation.source?.cursor === reference.sourceCursor && generation.source.sourceObservedAt === reference.sourceObservedAt
    && generation.source.manifestSha256 === hash(JSON.stringify(source.manifest))
    && generation.queryIndex?.binding?.generationId === reference.generationId, 'generation_binding');
  matchesFile(generation.queryIndex.file, 'query.sqlite');
  for (const [field, name] of Object.entries({details: 'details.sqlite', semantics: 'FILTER_SEMANTICS.json',
    fx: 'FX_RECEIPT.json', dispositions: 'DISPOSITIONS.ndjson', reconciliation: 'RECONCILIATION.json'}))
    matchesFile(generation.files?.[field], name);
}
async function readDescriptor(storage, receipt, name) {
  const file = receipt.files.find(row => row.name === name);
  need(file.bytes <= DESCRIPTOR_LIMIT, 'descriptor_size');
  const chunks = [], etags = new Map();
  for (const part of file.parts) {
    const result = binary(await storage.getBinary(part.key), PART, 'descriptor_part');
    need(result.size === part.bytes && hash(result.data) === part.sha256, 'descriptor_part_checksum');
    const raw = part.encoding === 'gzip' ? gunzipSync(result.data, {maxOutputLength: PART}) : result.data;
    need(raw.length === part.rawBytes && hash(raw) === part.rawSha256, 'descriptor_part_decoded');
    chunks.push(raw); etags.set(part.key, result.etag);
  }
  const bytes = Buffer.concat(chunks); need(bytes.length === file.bytes && hash(bytes) === file.sha256, 'descriptor_checksum');
  return {bytes, etags};
}

function checkedRetirement(bytes, reference, previousAccepted, acceptedPublication) {
  const value = parse(bytes, RETIREMENT_LIMIT, 'retirement_json');
  need(value.version === 1 && value.kind === 'china-private-generation-retirement-v1' && value.market === 'china'
    && value.root === rootOf(reference) && value.policy === 'remove-completion-before-parts-v1'
    && same(value.reference, reference) && sameObservation(value.previousAccepted, previousAccepted)
    && typeof value.createdAt === 'string' && Number.isFinite(Date.parse(value.createdAt)), 'retirement_identity');
  previousReference(value.previousAccepted);
  checkedState(value.acceptedPublication, reference);
  retirementSuccessor(value.acceptedPublication, previousAccepted);
  if (acceptedPublication) need(sameObservation(value.acceptedPublication.accepted, acceptedPublication.accepted)
    && sameObservation(value.acceptedPublication.intent, acceptedPublication.intent), 'retirement_publication');
  const receiptBytes = base64(value.receiptBase64, PART, 'retirement_receipt');
  const {receipt, objects} = checkedReceipt(receiptBytes, reference);
  descriptorBinding(receipt, reference, base64(value.sourceBase64, DESCRIPTOR_LIMIT, 'retirement_source'),
    base64(value.generationBase64, DESCRIPTOR_LIMIT, 'retirement_generation'));
  need(Array.isArray(value.objects) && value.objects.length === objects.length
    && value.objects.every((object, index) => same({...object, etag: undefined}, {...objects[index], etag: undefined})
      && etag(object.etag)), 'retirement_objects');
  return value;
}

/** Retire only the rollback displaced by this verified accepted publication.
 * Call while holding the exclusive China lease. No listing, shared catalogue,
 * source snapshot, neighbour, encyclopedia or local serving file is addressed.
 *
 * The durable create-only retirement record precedes deletion. complete.json
 * is removed FIRST: the existing restore reader requires its exact bytes at
 * entry and again before exposing local manifests. New and incomplete restores
 * therefore cannot turn a partially collected generation into usable input.
 * Native readers use their already materialized local files. Current/rollback/
 * pending references are checked before every mutation and are never eligible.
 *
 * Legitimate producers use a new run/attempt root and create each immutable
 * object once; they never resurrect a retired root. No DELETE retry occurs.
 * A partial run can resume only from its original immutable retirement record.
 */
export async function collectRetiredChinaGeneration({previousAccepted, acceptedPublication, readState, assertAuthority, storage,
  environment = process.env, fetcher = globalThis.fetch, now = () => new Date().toISOString(), onProgress = () => {}}) {
  need([readState, assertAuthority, now, onProgress].every(value => typeof value === 'function'), 'capabilities');
  const reference = previousReference(previousAccepted);
  const report = {version: 1, kind: 'china-generation-gc-v1', market: 'china', completed: false, status: 'starting',
    deletedObjects: 0, deletedBytes: 0, alreadyAbsentObjects: 0, tombstonesWritten: 0,
    otherMarketWrites: 0, encyclopediaWrites: 0, liveCatalogWrites: 0};
  if (!reference) return {...report, completed: true, status: 'no_previous_rollback'};
  const witness = acceptedPublication
    ? validateChinaGenerationRetirementWitness({previousAccepted, acceptedPublication}) : null;
  const root = rootOf(reference), completionKey = root + '/complete.json', retirementKey = root + '/RETIREMENT.json';
  report.generationId = reference.generationId;
  let expected, retirementSeal, completionFenced = false;
  async function fence() {
    await assertAuthority();
    const current = checkedState(await readState(), reference);
    if (witness) need(current.accepted.value.revision >= witness.acceptedPublication.accepted.value.revision,
      'state_older_than_retirement');
    if (expected) need(sameObservation(current.accepted, expected.accepted)
      && sameObservation(current.intent, expected.intent), 'state_changed');
    else expected = current;
    if (retirementSeal) {
      const actual = objectMetadata(await storage.headObject(retirementKey), 'retirement_head');
      need(actual.found && actual.etag === retirementSeal.etag && actual.size === retirementSeal.size, 'retirement_changed');
    }
    if (completionFenced) need(!objectMetadata(await storage.headObject(completionKey), 'completion_head').found, 'completion_resurrected');
  }
  try {
    await fence();
    storage ??= createChinaGenerationGcStorage({owner: reference.owner, assertAuthority: fence, environment, fetcher});
    need(typeof storage.assertPrivateBucket === 'function' && typeof storage.getBinary === 'function'
      && typeof storage.headObject === 'function' && typeof storage.putRetirement === 'function'
      && (typeof storage.deleteIfMatch === 'function'
        || storage.deletionMode === 'fenced-immutable-reg-v1' && typeof storage.deleteExact === 'function'), 'storage_capability');
    need((await storage.assertPrivateBucket())?.verified === true, 'privacy');
    let existing = objectMetadata(await storage.getBinary(retirementKey), 'retirement_read'), retirement;
    if (existing.found) {
      binary(existing, RETIREMENT_LIMIT, 'retirement_read');
      retirement = checkedRetirement(existing.data, reference, previousAccepted, witness?.acceptedPublication);
      need(expected.accepted.value.revision >= retirement.acceptedPublication.accepted.value.revision, 'state_older_than_retirement');
    } else {
      const publication = witness?.acceptedPublication ?? expected;
      retirementSuccessor(publication, previousAccepted);
      const complete = binary(await storage.getBinary(completionKey), PART, 'completion_read');
      const {receipt, objects} = checkedReceipt(complete.data, reference);
      const source = await readDescriptor(storage, receipt, 'SOURCE.json');
      const generation = await readDescriptor(storage, receipt, 'GENERATION.json');
      descriptorBinding(receipt, reference, source.bytes, generation.bytes);
      const observed = new Map([[completionKey, complete.etag], ...source.etags, ...generation.etags]);
      const captured = [];
      for (const object of objects) {
        const actual = objectMetadata(await storage.headObject(object.key), 'object_head');
        need(actual.found && actual.size === object.size && (!observed.has(object.key)
          || actual.etag === observed.get(object.key)), 'object_changed');
        captured.push({...object, etag: actual.etag});
      }
      retirement = {version: 1, kind: 'china-private-generation-retirement-v1', market: 'china', root,
        policy: 'remove-completion-before-parts-v1', reference, previousAccepted,
        acceptedPublication: publication, createdAt: now(), receiptBase64: complete.data.toString('base64'),
        sourceBase64: source.bytes.toString('base64'), generationBase64: generation.bytes.toString('base64'), objects: captured};
      const bytes = Buffer.from(JSON.stringify(retirement));
      checkedRetirement(bytes, reference, previousAccepted, witness?.acceptedPublication);
      await fence(); need((await storage.assertPrivateBucket())?.verified === true, 'privacy');
      let creationError;
      try { await storage.putRetirement(retirementKey, bytes, {ifNoneMatch: '*'}); }
      catch (error) { creationError = error; }
      existing = objectMetadata(await storage.getBinary(retirementKey), 'retirement_readback');
      if (!existing.found && creationError) throw creationError;
      binary(existing, RETIREMENT_LIMIT, 'retirement_readback');
      need(existing.data.equals(bytes), 'retirement_readback');
      report.tombstonesWritten = 1;
    }
    retirementSeal = {etag: existing.etag, size: existing.size};
    report.retirementSha256 = hash(existing.data); report.plannedObjects = retirement.objects.length;
    for (const object of retirement.objects) {
      await fence();
      const before = objectMetadata(await storage.headObject(object.key), 'object_head');
      if (!before.found) report.alreadyAbsentObjects++;
      else {
        need(before.etag === object.etag && before.size === object.size, 'object_changed');
        await fence();
        let result;
        try {
          result = typeof storage.deleteIfMatch === 'function'
            ? await storage.deleteIfMatch(object.key, {ifMatch: before.etag})
            : await storage.deleteExact(object, {expectedETag: before.etag});
        } catch (error) {
          report.status = 'needs_reconciliation'; report.uncertainKey = object.key;
          throw Error('china_gc_delete_outcome_unknown');
        }
        need(result?.settled === true && result.deleted === true, 'delete_not_acknowledged');
        need(!objectMetadata(await storage.headObject(object.key), 'delete_head').found, 'delete_not_absent');
        report.deletedObjects++; report.deletedBytes += object.size;
      }
      if (object.key === completionKey) { completionFenced = true; report.completionFenceRemoved = true; }
      await onProgress({phase: 'china_retired_generation_gc', generationId: reference.generationId,
        checkedObjects: report.deletedObjects + report.alreadyAbsentObjects, totalObjects: report.plannedObjects});
    }
    await fence(); need((await storage.assertPrivateBucket())?.verified === true, 'privacy');
    report.completed = true; report.status = 'complete'; report.finishedAt = now();
    return report;
  } catch (error) {
    report.status = report.status === 'needs_reconciliation' ? report.status : 'paused';
    report.errorCode = safeCode(error); report.finishedAt = now();
    const failure = Error(report.errorCode); failure.report = report; throw failure;
  }
}

/** Native REG has no demonstrated ETag conditional DELETE in this project.
 * Its path uses the exclusive lease + retirement/completion fence above and
 * one exact immutable key per verbose DeleteObjects call. It never pretends
 * AWS If-Match support proves REG support. A verified conditional transport can
 * instead supply deleteIfMatch to the executor, which passes the real ETag.
 */
export function createChinaGenerationGcStorage({owner, assertAuthority, environment = process.env, fetcher = globalThis.fetch}) {
  const root = chinaGenerationRoot(owner), retirementKey = root + '/RETIREMENT.json';
  need(typeof assertAuthority === 'function' && typeof fetcher === 'function', 'transport_capability');
  const config = {YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud', YC_OBJECT_STORAGE_REGION: 'us-east-1',
    YC_OBJECT_STORAGE_BUCKET: 'avtocena-staging-8120751', YC_OBJECT_STORAGE_PREFIX: 'migration-staging/full-20261011/'};
  for (const [key, value] of Object.entries(config)) need(environment[key] === value, 'storage_configuration');
  const accessKeyId = environment.YC_OBJECT_STORAGE_ACCESS_KEY_ID, secretAccessKey = environment.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY;
  need(typeof accessKeyId === 'string' && /^[A-Za-z0-9_+=./-]{1,256}$/.test(accessKeyId)
    && typeof secretAccessKey === 'string' && secretAccessKey.length > 0 && secretAccessKey.length <= 1024
    && !/[\r\n\x00]/.test(secretAccessKey), 'storage_credentials');
  const valid = key => key === retirementKey || key === root + '/complete.json'
    || CHINA_GENERATION_FILES.some(name => typeof key === 'string' && key.startsWith(root + '/files/' + name + '/')
      && /^[0-9]+-[a-f0-9]{64}$/.test(key.slice((root + '/files/' + name + '/').length)));
  let privacy;
  async function request(method, key, query = {}, body, headers = {}, maximum = 64 * 1024) {
    need(key === null || valid(key), 'storage_key');
    const physical = '/avtocena-staging-8120751' + (key === null ? '' : '/migration-staging/full-20261011/' + key);
    const signed = signRawGcS3Request({method, host: 's3.regru.cloud', path: physical, query, body: body ?? '', headers,
      region: 'us-east-1', accessKeyId, secretAccessKey, at: Date.now()});
    let response;
    try { response = await fetcher('https://s3.regru.cloud' + signed.canonicalPath
      + (signed.canonicalQuery ? '?' + signed.canonicalQuery : ''), {method, headers: signed.headers, body,
      redirect: 'error', signal: AbortSignal.timeout(30000)}); }
    catch { throw Error('china_gc_storage_transport'); }
    const chunks = []; let size = 0;
    try { for await (const chunk of response.body ?? []) { size += chunk.byteLength;
      need(size <= maximum, 'storage_response_size'); chunks.push(Buffer.from(chunk)); }
    } catch { throw Error('china_gc_storage_incomplete'); }
    return {status: response.status, data: Buffer.concat(chunks, size), etag: response.headers.get('etag'),
      length: response.headers.get('content-length')};
  }
  async function assertPrivateBucket() {
    const acl = await request('GET', null, {acl: ''}); need(acl.status === 200, 'bucket_acl');
    const ownerId = privateOwnerAcl(acl.data.toString());
    const policy = await request('GET', null, {policy: ''});
    const next = {owner: ownerId, policySha256: nonGrantingPolicy(policy.status, policy.data.toString())};
    if (privacy) need(same(next, privacy), 'privacy_changed'); else privacy = next;
    return {verified: true};
  }
  async function objectAcl(key) {
    need(privacy && valid(key), 'storage_key');
    const acl = await request('GET', key, {acl: ''});
    if (acl.status === 404) return false;
    need(acl.status === 200 && privateOwnerAcl(acl.data.toString()) === privacy.owner, 'object_acl'); return true;
  }
  async function getBinary(key) {
    const acl = await objectAcl(key), value = await request('GET', key, {}, undefined, {}, key === retirementKey ? RETIREMENT_LIMIT : PART);
    if (!acl) { need(value.status === 404, 'missing_changed'); return {found: false}; }
    need(value.status === 200 && etag(value.etag) && value.data.length > 0, 'storage_read');
    return {found: true, data: value.data, size: value.data.length, etag: value.etag};
  }
  async function headObject(key) {
    const acl = await objectAcl(key), value = await request('HEAD', key);
    if (!acl) { need(value.status === 404, 'missing_changed'); return {found: false}; }
    need(value.status === 200 && etag(value.etag) && /^[1-9]\d*$/.test(value.length ?? '')
      && Number.isSafeInteger(Number(value.length)), 'storage_head');
    return {found: true, etag: value.etag, size: Number(value.length)};
  }
  async function putRetirement(key, bytes, condition) {
    need(privacy && key === retirementKey && Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= RETIREMENT_LIMIT
      && same(condition, {ifNoneMatch: '*'}), 'retirement_write_scope');
    await assertAuthority();
    const value = await request('PUT', key, {}, bytes,
      {'content-type': 'application/json', 'if-none-match': '*', 'x-amz-acl': 'private'});
    need(value.status === 200 || value.status === 201, 'retirement_write_failed');
  }
  async function deleteExact(object, condition) {
    need(privacy && valid(object?.key) && object.key !== retirementKey && etag(object.etag)
      && positive(object.size) && same(condition, {expectedETag: object.etag}), 'delete_scope');
    const current = await headObject(object.key);
    need(current.found && current.etag === object.etag && current.size === object.size, 'object_changed');
    await assertAuthority();
    const body = '<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>false</Quiet><Object><Key>'
      + 'migration-staging/full-20261011/' + object.key + '</Key></Object></Delete>';
    const result = await request('POST', null, {delete: ''}, body,
      {'content-type': 'application/xml', 'content-md5': createHash('md5').update(body).digest('base64')});
    need(result.status === 200, 'delete_response');
    const parsed = parseRawGcS3Delete(result.data.toString(), [object]);
    need(parsed.settled === true && parsed.results.length === 1 && parsed.results[0].status === 'deleted', 'delete_rejected');
    return {settled: true, deleted: true};
  }
  return Object.freeze({root, deletionMode: 'fenced-immutable-reg-v1', assertPrivateBucket,
    getBinary, headObject, putRetirement, deleteExact});
}
