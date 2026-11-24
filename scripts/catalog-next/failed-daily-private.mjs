import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {chinaGenerationRoot, CHINA_GENERATION_FILES} from './generation-storage.mjs';
import {validateChinaGenerationReference} from './china-state.mjs';
import {FAILED_DAILY_HOST_FILES, HASH, natural, keys, encoded, digest, equal, need, observationEqual, validateHeader, validateSlot, validatePrivateWitness, validateReplacement, protect, tombstone, mutationUnknown} from './failed-daily-contract.mjs';

const PART = 8 * 1024 * 1024, DESCRIPTOR_LIMIT = 1024 * 1024;
const required = ['DISPOSITIONS.ndjson', 'FILTER_SEMANTICS.json', 'FX_RECEIPT.json', 'GENERATION.json', 'RECONCILIATION.json', 'RUNTIME_CONTEXT.json', 'SOURCE.json', 'details.sqlite', 'query.sqlite', 'source.sqlite'];
const bytesHash = bytes => createHash('sha256').update(bytes).digest('hex');
function json(bytes, limit, code) {
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= limit, code);
  try { return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); } catch { throw Error('china_failed_daily_' + code); }
}
function exactPayload(value, bytes, sha256) {
  need(value?.found === true && Buffer.isBuffer(value.data) && value.size === bytes && value.data.length === bytes
    && bytesHash(value.data) === sha256 && typeof value.etag === 'string', 'private_payload');
  return value;
}
function receiptFor(bytes, header, candidate) {
  need(bytesHash(bytes) === candidate.receiptSha256, 'private_receipt_sha');
  const receipt = json(bytes, PART, 'private_receipt_json'), root = chinaGenerationRoot(header.owner);
  need(receipt.version === 1 && receipt.kind === 'china-private-generation-v1' && receipt.market === 'china'
    && receipt.root === root && equal(receipt.owner, header.owner) && receipt.published === false
    && receipt.liveCatalogWrites === 0 && receipt.deletions === 0 && receipt.binding?.market === 'china'
    && receipt.binding.generationId === header.generationId && receipt.binding.runtimeSha === header.pricingRuntimeSha
    && receipt.binding.sourceDescriptorSha256 === candidate.sourceDescriptorSha256
    && receipt.binding.generationManifestSha256 === candidate.generationManifestSha256, 'private_receipt_binding');
  const names = receipt.files?.map(file => file.name);
  need(Array.isArray(names) && new Set(names).size === names.length && equal(names, [...names].sort())
    && names.every(name => CHINA_GENERATION_FILES.includes(name)) && required.every(name => names.includes(name)), 'private_files');
  let decoded = 0, stored = 0;
  for (const file of receipt.files) {
    need(natural(file.bytes) && file.bytes > 0 && HASH.test(file.sha256 ?? '') && Array.isArray(file.parts)
      && file.parts.length === Math.ceil(file.bytes / PART), 'private_file');
    file.parts.forEach((part, index) => {
      validateSlot({name: file.name, index, bytes: part.bytes, sha256: part.sha256, encoding: part.encoding,
        rawBytes: part.rawBytes, rawSha256: part.rawSha256, key: part.key}, header);
      need(part.rawBytes === Math.min(PART, file.bytes - index * PART), 'private_part_length'); stored += part.bytes;
    });
    decoded += file.bytes;
  }
  need(natural(decoded) && natural(stored) && receipt.totalBytes === decoded && receipt.storedBytes === stored
    && receipt.files.find(row => row.name === 'SOURCE.json').sha256 === candidate.sourceDescriptorSha256
    && receipt.files.find(row => row.name === 'GENERATION.json').sha256 === candidate.generationManifestSha256, 'private_totals');
  return receipt;
}
function descriptors(receipt, candidate, saved) {
  const source = json(saved.get('SOURCE.json'), DESCRIPTOR_LIMIT, 'source_descriptor');
  const generation = json(saved.get('GENERATION.json'), DESCRIPTOR_LIMIT, 'generation_descriptor');
  const match = (value, name) => { const file = receipt.files.find(row => row.name === name);
    need(value?.name === name && value.bytes === file.bytes && value.sha256 === file.sha256, 'descriptor_file'); };
  need(source.version === 1 && source.kind === 'china-refreshed-source-descriptor-v1' && source.market === 'china'
    && source.manifest?.kind === 'china-refreshed-source-v1' && source.manifest.market === 'china'
    && source.manifest.source?.cursor === candidate.sourceCursor && source.manifest.sourceObservedAt === candidate.sourceObservedAt
    && source.manifest.supplierLatestVerified === true, 'source_binding');
  match(source.file, 'source.sqlite');
  need(generation.version === 1 && generation.kind === 'china-local-generation-v1' && generation.market === 'china'
    && generation.generationId === candidate.generationId && generation.runtimeSha === candidate.pricingRuntimeSha
    && generation.prepared === true && generation.published === false && generation.activationAuthorized === false
    && generation.source?.cursor === candidate.sourceCursor && generation.source.sourceObservedAt === candidate.sourceObservedAt
    && generation.source.manifestSha256 === bytesHash(Buffer.from(JSON.stringify(source.manifest)))
    && generation.queryIndex?.binding?.generationId === candidate.generationId, 'generation_binding');
  match(generation.queryIndex.file, 'query.sqlite');
  for (const [field, name] of Object.entries({details: 'details.sqlite', semantics: 'FILTER_SEMANTICS.json', fx: 'FX_RECEIPT.json',
    dispositions: 'DISPOSITIONS.ndjson', reconciliation: 'RECONCILIATION.json'})) match(generation.files?.[field], name);
}

/** Read every encoded part and verify every decoded and complete-file hash.
 * Only SOURCE/GENERATION descriptors (each <=1 MiB) are retained in memory.
 * No file, provider request, price calculation or private payload write occurs. */
export async function verifyFailedDailyPrivateGeneration({record, storage, assertAuthority, onProgress = () => {}}) {
  const header = validateHeader(record.header), candidate = validateChinaGenerationReference(record.candidate);
  need(record.phase === 'failed' && !candidate.proof && equal(candidate.owner, header.owner)
    && candidate.generationId === header.generationId && candidate.runtimeSha === header.runtimeSha
    && candidate.pricingRuntimeSha === header.pricingRuntimeSha && candidate.imageId === header.imageId, 'private_candidate');
  need(typeof assertAuthority === 'function' && typeof onProgress === 'function', 'verifier_arguments');
  await assertAuthority(); need((await storage.assertPrivateBucket())?.verified === true, 'privacy');
  const completionKey = chinaGenerationRoot(header.owner) + '/complete.json';
  const completion = await storage.getPayload(header, completionKey);
  need(completion.found && Buffer.isBuffer(completion.data), 'complete_required');
  const receipt = receiptFor(completion.data, header, candidate), inventory = [];
  const saved = new Map(); let verifiedParts = 0;
  for (const file of receipt.files) {
    const full = createHash('sha256'); let total = 0; const chunks = [];
    for (const part of file.parts) {
      await assertAuthority(); const actual = exactPayload(await storage.getPayload(header, part.key), part.bytes, part.sha256);
      let decoded;
      try { decoded = part.encoding === 'gzip' ? gunzipSync(actual.data, {maxOutputLength: PART}) : actual.data; }
      catch { throw Error('china_failed_daily_private_decode'); }
      need(decoded.length === part.rawBytes && bytesHash(decoded) === part.rawSha256, 'private_raw_hash');
      full.update(decoded); total += decoded.length;
      if (file.name === 'SOURCE.json' || file.name === 'GENERATION.json') {
        need(total <= DESCRIPTOR_LIMIT, 'descriptor_size'); chunks.push(decoded);
      }
      inventory.push({key: part.key, bytes: actual.size, sha256: part.sha256, etag: actual.etag}); verifiedParts++;
    }
    need(total === file.bytes && full.digest('hex') === file.sha256, 'private_full_file_hash');
    if (chunks.length) saved.set(file.name, Buffer.concat(chunks, total));
    await onProgress({phase: 'failed_daily_private_verified', parts: verifiedParts, bytes: total});
  }
  descriptors(receipt, candidate, saved);
  if (record.hostIntent) for (const name of FAILED_DAILY_HOST_FILES) {
    const row = receipt.files.find(file => file.name === name), planned = record.hostIntent.plan.files.find(file => file.name === name);
    need(planned && planned.bytes === row.bytes && planned.sha256 === row.sha256, 'private_host_plan');
  }
  await assertAuthority(); need((await storage.assertPrivateBucket())?.verified === true, 'privacy');
  const again = await storage.getPayload(header, completionKey);
  need(again.found && again.etag === completion.etag && again.data.equals(completion.data), 'complete_changed');
  inventory.unshift({key: completionKey, bytes: completion.size, sha256: candidate.receiptSha256, etag: completion.etag});
  const witness = {version: 1, kind: 'china-failed-daily-private-witness-v1', attemptId: header.attemptId, owner: header.owner,
    receiptSha256: candidate.receiptSha256, generationId: header.generationId, pricingRuntimeSha: header.pricingRuntimeSha,
    sourceDescriptorSha256: candidate.sourceDescriptorSha256, generationManifestSha256: candidate.generationManifestSha256,
    files: FAILED_DAILY_HOST_FILES.map(name => { const row = receipt.files.find(file => file.name === name); return {name, bytes: row.bytes, sha256: row.sha256}; }),
    allFilesVerified: true, allPartsVerified: true, inventorySha256: digest(inventory)};
  witness.preservationSha256 = digest(witness); validatePrivateWitness(witness, header, candidate);
  const evidence = {version: 1, kind: 'china-failed-daily-private-evidence-v1', witness,
    receiptBase64: completion.data.toString('base64'), sourceBase64: saved.get('SOURCE.json').toString('base64'),
    generationBase64: saved.get('GENERATION.json').toString('base64'), inventory};
  await assertAuthority(); return {witness, evidence};
}

/** A closed journal, a later committed replacement and current no-reference
 * fences authorize permanent per-key tombstones. A missing key is occupied,
 * never merely declared deleted, so delayed create-only PUTs cannot resurrect it. */
export async function retireFailedDailyPrivateGeneration({recordObservation, slots, storage, readState, assertAuthority, onProgress = () => {}}) {
  const record = recordObservation.value; validateHeader(record.header); validateReplacement(record.replacement, record);
  need(record.phase === 'failed' && HASH.test(record.closedJournalSha256 ?? '') && Array.isArray(slots)
    && new Set(slots.map(row => row.key)).size === slots.length, 'retirement_record');
  slots.forEach(slot => validateSlot(slot, record.header));
  let expected;
  async function fence() {
    await assertAuthority(); const view = await readState(); protect(view, record.header);
    need(view.accepted.value.revision >= record.replacement.publication.accepted.value.revision, 'replacement_not_current');
    if (expected) need(observationEqual(expected.accepted, view.accepted) && observationEqual(expected.intent, view.intent), 'state_changed');
    else expected = view;
    need(observationEqual(await storage.readRecord(record.header.attemptId), recordObservation), 'record_changed');
  }
  const report = {completed: false, payloadObjectsRetired: 0, payloadBytesRetired: 0, absentKeysFenced: 0,
    alreadyFencedObjects: 0, tombstoneBytesStored: 0, physicalStorageBytesFreed: null};
  // Fence completion before parts if it was registered. A partial producer
  // without that slot cannot register it after closure.
  const orderedSlots = [...slots.filter(row => row.name === 'complete.json'), ...slots.filter(row => row.name !== 'complete.json')];
  for (const slot of orderedSlots) {
    await fence();
    const marker = tombstone(record.header, record.closedJournalSha256, slot, record.replacement), wanted = encoded(marker);
    const before = await storage.getPayload(record.header, slot.key);
    if (before.found && before.data.equals(wanted)) { report.alreadyFencedObjects++; continue; }
    if (before.found) exactPayload(before, slot.bytes, slot.sha256);
    await fence(); let writeFailure;
    try { await storage.putTombstone({record, slot, previous: before, marker, assertAuthority: fence}); } catch (error) { writeFailure = error; }
    let after;
    try { after = await storage.getPayload(record.header, slot.key); }
    catch (error) { throw mutationUnknown(error); }
    if (!after.found || !after.data.equals(wanted)) {
      if (writeFailure && /storage_conflict$/.test(writeFailure.message)) throw writeFailure;
      throw mutationUnknown(writeFailure);
    }
    await fence();
    if (before.found) { report.payloadObjectsRetired++; report.payloadBytesRetired += before.size; }
    else report.absentKeysFenced++;
    report.tombstoneBytesStored += wanted.length;
    await onProgress({phase: 'failed_daily_private_retired', parts: report.payloadObjectsRetired + report.absentKeysFenced + report.alreadyFencedObjects});
  }
  await fence(); report.completed = true; return report;
}
