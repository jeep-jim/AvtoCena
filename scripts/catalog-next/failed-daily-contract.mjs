import {createHash} from 'node:crypto';
import {validateChinaGenerationReference, validateChinaAcceptedState, validateChinaLease, inspectChinaPublicationState, protectedChinaGenerations} from './china-state.mjs';
import {chinaGenerationRoot, CHINA_GENERATION_FILES} from './generation-storage.mjs';

export const FAILED_DAILY_PREFIX = 'catalog/market-rebuild/v1/china/failed-daily/v1/';
export const FAILED_DAILY_QUEUE_KEY = FAILED_DAILY_PREFIX + 'queue.json';
export const FAILED_DAILY_HOST_FILES = Object.freeze(['DISPOSITIONS.ndjson', 'FILTER_SEMANTICS.json', 'FX_RECEIPT.json', 'GENERATION.json', 'RECONCILIATION.json', 'details.sqlite', 'query.sqlite']);
export const HASH = /^[a-f0-9]{64}$/, REV = /^[a-f0-9]{40}$/, NONCE = /^[a-f0-9]{32}$/;
export const natural = value => Number.isSafeInteger(value) && value >= 0;
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const keys = (value, names) => object(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
export const ordered = value => Array.isArray(value) ? value.map(ordered) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
export const encoded = value => Buffer.from(JSON.stringify(ordered(value)));
export const digest = value => createHash('sha256').update(Buffer.isBuffer(value) ? value : encoded(value)).digest('hex');
export const equal = (left, right) => digest(left) === digest(right);
export const need = (condition, code) => { if (!condition) throw Error('china_failed_daily_' + code); };
export const clone = value => structuredClone(value);
export const observationEqual = (a, b) => a.found === b.found && a.etag === b.etag && a.sha256 === b.sha256;
export const absent = () => ({found: false, etag: null, sha256: null, value: null});
export const etag = value => typeof value === 'string' && /^"[^"\x00-\x20\x7f]{1,250}"$/.test(value);
export const instant = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/.test(value) && Number.isFinite(Date.parse(value));
export function owner(value) {
  need(keys(value, ['runId', 'attempt', 'revision']) && /^[1-9]\d{0,19}$/.test(value.runId ?? '') && /^[1-9]\d{0,5}$/.test(value.attempt ?? '') && REV.test(value.revision ?? ''), 'owner');
  return value;
}
export function observation(value) {
  need(keys(value, ['found', 'etag', 'sha256', 'value']) && typeof value.found === 'boolean', 'observation');
  if (!value.found) need(value.etag === null && value.sha256 === null && value.value === null, 'observation');
  else need(etag(value.etag) && HASH.test(value.sha256 ?? '') && object(value.value) && digest(value.value) === value.sha256, 'observation');
  return value;
}
export function acceptedObservation(value) {
  observation(value); need(value.found, 'accepted_required'); validateChinaAcceptedState(value.value);
  need(value.value.current && value.value.pending === null, 'accepted_required'); return value;
}
export function resolvedView(value, committed = false) {
  need(keys(value, ['accepted', 'intent']), 'view'); acceptedObservation(value.accepted); observation(value.intent);
  const status = inspectChinaPublicationState(value).status;
  need(['idle', 'resolved'].includes(status) && (!committed || value.intent.value?.status === 'committed'), 'unresolved_state'); return value;
}
export function authority(value, now = () => new Date().toISOString()) {
  need(keys(value, ['publicationState', 'lease']), 'authority'); resolvedView(value.publicationState); observation(value.lease);
  need(value.lease.found, 'lease'); validateChinaLease(value.lease.value);
  need(value.lease.value.status === 'held' && Date.parse(value.lease.value.expiresAt) > Date.parse(now()), 'lease_expired'); return value;
}
export function protect(view, header) {
  resolvedView(view); const protectedSet = protectedChinaGenerations(view).references;
  need(!protectedSet.some(ref => ref.generationId === header.generationId || chinaGenerationRoot(ref.owner) === chinaGenerationRoot(header.owner)), 'generation_protected');
}
export function attemptId(value) {
  return digest({kind: 'china-daily-attempt-id-v1', owner: value.owner, nonce: value.nonce, generationId: value.generationId,
    runtimeSha: value.runtimeSha, pricingRuntimeSha: value.pricingRuntimeSha, imageId: value.imageId,
    previousAcceptedSha256: value.previousAccepted.sha256});
}
export function validateHeader(value) {
  need(keys(value, ['version', 'kind', 'market', 'attemptId', 'owner', 'nonce', 'generationId', 'runtimeSha', 'pricingRuntimeSha', 'imageId', 'previousAccepted', 'registeredAt', 'replacementCandidates'])
    && value.version === 1 && value.kind === 'china-daily-failed-attempt-header-v1' && value.market === 'china', 'header');
  owner(value.owner); acceptedObservation(value.previousAccepted);
  const prior = value.previousAccepted.value.current;
  need(NONCE.test(value.nonce ?? '') && value.generationId === 'gen_china_' + value.owner.runId + '_' + value.owner.attempt
    && value.runtimeSha === prior.runtimeSha && value.pricingRuntimeSha === prior.pricingRuntimeSha && value.imageId === prior.imageId
    && value.attemptId === attemptId(value) && instant(value.registeredAt), 'header_binding');
  need(Array.isArray(value.replacementCandidates) && new Set(value.replacementCandidates.map(row => row.attemptId)).size === value.replacementCandidates.length
    && value.replacementCandidates.every(row => keys(row, ['attemptId', 'closedJournalSha256']) && HASH.test(row.attemptId ?? '') && HASH.test(row.closedJournalSha256 ?? '') && row.attemptId !== value.attemptId), 'replacement_snapshot');
  return value;
}
export function makeHeader({owner: holder, nonce, previousAccepted, replacementCandidates, now}) {
  owner(holder); acceptedObservation(previousAccepted); const prior = previousAccepted.value.current;
  const value = {version: 1, kind: 'china-daily-failed-attempt-header-v1', market: 'china', owner: clone(holder), nonce,
    generationId: 'gen_china_' + holder.runId + '_' + holder.attempt, runtimeSha: prior.runtimeSha, pricingRuntimeSha: prior.pricingRuntimeSha,
    imageId: prior.imageId, previousAccepted: clone(previousAccepted), registeredAt: now(), replacementCandidates: clone(replacementCandidates)};
  value.attemptId = attemptId(value); return validateHeader(value);
}
export function validateSlot(value, header) {
  need(keys(value, ['name', 'index', 'bytes', 'sha256', 'encoding', 'rawBytes', 'rawSha256', 'key']) && natural(value.bytes) && value.bytes > 0
    && value.bytes <= 8 * 1024 * 1024 && HASH.test(value.sha256 ?? '') && natural(value.rawBytes) && value.rawBytes > 0
    && value.rawBytes <= 8 * 1024 * 1024 && HASH.test(value.rawSha256 ?? '') && ['identity', 'gzip'].includes(value.encoding), 'slot');
  const root = chinaGenerationRoot(header.owner);
  if (value.name === 'complete.json') need(value.index === null && value.key === root + '/complete.json' && value.encoding === 'identity'
    && value.bytes === value.rawBytes && value.sha256 === value.rawSha256, 'completion_slot');
  else need(CHINA_GENERATION_FILES.includes(value.name) && natural(value.index) && value.key === root + '/files/' + value.name + '/' + value.index + '-' + value.sha256, 'part_slot');
  return value;
}
export function validateRegistration(value, plan) {
  need(keys(value, ['version', 'kind', 'market', 'attemptId', 'owner', 'nonce', 'generationId', 'planSha256', 'hostIntentSha256', 'registrationSha256'])
    && value.version === 1 && value.kind === 'china-daily-attempt-registration-v1' && value.market === 'china', 'registration');
  owner(value.owner); const {registrationSha256, ...body} = value;
  need(HASH.test(value.attemptId ?? '') && value.planSha256 === digest(plan) && registrationSha256 === digest(body)
    && value.hostIntentSha256 === digest({version: 1, kind: 'china-daily-host-intent-v1', attemptId: value.attemptId, planSha256: value.planSha256})
    && plan.mode === 'generation-update' && value.nonce === plan.nonce && value.generationId === plan.generationId
    && value.owner.revision === plan.controllerSha, 'registration_binding');
  const id = digest({kind: 'china-daily-attempt-id-v1', owner: value.owner, nonce: value.nonce, generationId: value.generationId,
    runtimeSha: plan.runtimeSha, pricingRuntimeSha: plan.pricingRuntimeSha, imageId: plan.imageId, previousAcceptedSha256: plan.previousAcceptedStateSha256});
  need(id === value.attemptId, 'registration_identity'); return value;
}
export function makeRegistration(header, plan) {
  validateHeader(header);
  need(plan.runtimeSha === header.runtimeSha && plan.pricingRuntimeSha === header.pricingRuntimeSha && plan.imageId === header.imageId
    && plan.previousAcceptedStateSha256 === header.previousAccepted.sha256 && plan.previousAcceptedETag === header.previousAccepted.etag
    && equal(plan.previousAcceptedState, header.previousAccepted.value), 'host_predecessor');
  const value = {version: 1, kind: 'china-daily-attempt-registration-v1', market: 'china', attemptId: header.attemptId,
    owner: clone(header.owner), nonce: header.nonce, generationId: header.generationId, planSha256: digest(plan)};
  value.hostIntentSha256 = digest({version: 1, kind: 'china-daily-host-intent-v1', attemptId: value.attemptId, planSha256: value.planSha256});
  value.registrationSha256 = digest(value); return validateRegistration(value, plan);
}
export function validatePrivateWitness(value, header, candidate) {
  need(keys(value, ['version', 'kind', 'attemptId', 'owner', 'receiptSha256', 'generationId', 'pricingRuntimeSha', 'sourceDescriptorSha256', 'generationManifestSha256', 'files', 'allFilesVerified', 'allPartsVerified', 'inventorySha256', 'preservationSha256'])
    && value.version === 1 && value.kind === 'china-failed-daily-private-witness-v1' && value.attemptId === header.attemptId
    && equal(value.owner, header.owner) && value.generationId === header.generationId && value.pricingRuntimeSha === header.pricingRuntimeSha
    && value.allFilesVerified === true && value.allPartsVerified === true, 'private_witness');
  const {preservationSha256, ...body} = value;
  need(preservationSha256 === digest(body) && ['receiptSha256', 'sourceDescriptorSha256', 'generationManifestSha256', 'inventorySha256'].every(key => HASH.test(value[key] ?? ''))
    && Array.isArray(value.files) && equal(value.files.map(row => row.name), FAILED_DAILY_HOST_FILES)
    && value.files.every(row => keys(row, ['name', 'bytes', 'sha256']) && natural(row.bytes) && row.bytes > 0 && HASH.test(row.sha256 ?? '')), 'private_witness_binding');
  if (candidate) need(value.receiptSha256 === candidate.receiptSha256 && value.sourceDescriptorSha256 === candidate.sourceDescriptorSha256
    && value.generationManifestSha256 === candidate.generationManifestSha256, 'private_witness_candidate');
  return value;
}
export function validateReplacement(value, target) {
  need(keys(value, ['header', 'publication']), 'replacement'); validateHeader(value.header); resolvedView(value.publication, true);
  need(value.header.attemptId !== target.header.attemptId && value.header.replacementCandidates.some(row =>
    row.attemptId === target.header.attemptId && row.closedJournalSha256 === target.closedJournalSha256), 'replacement_membership');
  const {accepted, intent} = value.publication;
  need(intent.value.nonce === value.header.nonce && equal(intent.value.owner, value.header.owner)
    && observationEqual(intent.value.previous, value.header.previousAccepted) && accepted.value.current.generationId === value.header.generationId
    && accepted.value.current.runtimeSha === value.header.runtimeSha && accepted.value.current.pricingRuntimeSha === value.header.pricingRuntimeSha
    && accepted.value.current.imageId === value.header.imageId, 'replacement_binding'); return value;
}
export function tombstone(header, closedJournalSha256, slot, replacement) {
  validateSlot(slot, header); need(HASH.test(closedJournalSha256 ?? ''), 'closed_journal');
  return {version: 1, kind: 'china-failed-daily-payload-tombstone-v1', attemptId: header.attemptId,
    closedJournalSha256, slotSha256: digest(slot), replacementSha256: digest(replacement)};
}
export function mutationUnknown(error) { const failure = Error('china_failed_daily_mutation_outcome_unknown'); failure.mutationOutcomeUnknown = true; failure.cause = error; return failure; }
