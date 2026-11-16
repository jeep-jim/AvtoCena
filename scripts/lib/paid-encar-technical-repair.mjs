import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

export const PAID_ENCAR_REPAIR_SNAPSHOT = Object.freeze({runId: '43570782014', attempt: '1',
  producerSha: '6a720ec3aa4823ef2808848018bc5b877fb520ad'});
export const PAID_ENCAR_REPAIR_PROTECTED_KEYS = Object.freeze(['catalog-editorial/current.json',
  'catalog/operations/collection-controls-v1.json', 'catalog/intake-cursors/v1/korea.json']);
const SHA = /^[a-f0-9]{64}$/, COMMIT = /^[a-f0-9]{40}$/;
const coreFields = ['fuel', 'powertrainKind', 'engineCc', 'powerHp', 'powerKw', 'icePowerKw',
  'motorPeakKw', 'powerDataConfidence', 'powerDataSource', 'power30MinKw', 'power30MinKwByMotor', 'utilizationPowerKw'];
const sourceFields = ['fuel', 'powertrainKind', 'engineCc', 'powerHp'];
const derivedFields = ['totalRub', 'previousTotalRub', 'priceDeltaRub', 'priceChangedAt', 'sellerPriceRub',
  'catalogPricingMode', 'calculationSnapshot', 'publicVisibleRub', 'publicSpecificationVerified',
  'deliveredCalculationPreview', 'japanDeliveredPreview', 'modificationSelection', 'recoveryQualification'];
const pick = (row, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(row || {}, key)).map(key => [key, row[key]]));
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const paidRepairDigest = value => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const same = (a, b) => paidRepairDigest(a ?? null) === paidRepairDigest(b ?? null);
const observation = row => Date.parse(row?.operational?.lastSeenAt || row?.updatedAt || row?.operational?.sourcePublishedAt || row?.firstSeenAt || '');
const exact = value => ['exact', 'verified'].includes(value?.status);
const protectedTechnicalFields = [...coreFields, 'drive'];
export function paidRepairExampleFields(row) {
  return Object.fromEntries(['fuel','powertrainKind','engineCc','powerHp','drive','power30MinKw']
    .map(field => [field, row?.[field] ?? null]));
}

export function paidRepairObjectRevision(meta) {
  assert.ok(meta && typeof meta.found === 'boolean' && (!meta.found || typeof meta.etag === 'string' && meta.etag), 'paid_repair_object_revision_missing');
  return {found: meta.found, etag: meta.etag || null, sha256: paidRepairDigest(meta.value ?? null)};
}
function assertPaidIdentity(row) {
  assert.ok(row?.market === 'korea' && row.sourceId === 'encar_direct' && row.operational?.provider === 'auto_api_encar'
    && /^\d+$/.test(String(row.sourceOfferId)) && row.id === createHash('sha256').update(`encar_direct:${row.sourceOfferId}`).digest('hex').slice(0, 24),
  'paid_repair_identity_invalid');
}
function editorialEntry(row, editorial) {
  const entry = editorial?.entries?.[row.id];
  if (!entry) return undefined;
  assert.ok(entry.market === row.market && entry.sourceId === row.sourceId && entry.sourceOfferId === row.sourceOfferId,
    'paid_repair_editorial_identity_changed');
  return entry;
}
/** Existing CRM values are the effective current inputs, even before a source
 * generation has materialized them. The editorial document itself is never written. */
export function paidRepairEffectiveCurrent(row, editorial) {
  const entry = editorialEntry(row, editorial);
  const out = structuredClone(row);
  if (entry?.specifications) Object.assign(out, entry.specifications, {editorialSpecifications: structuredClone(entry.specifications)});
  if (entry?.sellerPrice) Object.assign(out, {sourcePrice: entry.sellerPrice.amount, sourceCurrency: entry.sellerPrice.currency,
    editorialPriceKey: JSON.stringify([entry.sellerPrice.amount, entry.sellerPrice.currency])});
  return out;
}
function manualProperties(row) {
  const collect = object => Object.fromEntries(Object.entries(object || {}).filter(([key]) =>
    /manual|owner|customer|editorial|savedCalculationPreview|savedParameters/i.test(key)));
  return {top: collect(row), operational: collect(row.operational),
    ...(row.calculationSnapshot?.modificationScenario ? {personalCalculationSnapshot:row.calculationSnapshot} : {})};
}
function manualTechnical(row) {
  return Boolean(/manual|customer_input/i.test(String(row.powerDataSource || '')) || row.manualEditedAt
    || row.operational?.manualEditedAt || row.calculationSnapshot?.modificationScenario);
}
export function paidRepairInvariant(row, editorial) {
  row = paidRepairEffectiveCurrent(row, editorial);
  return {identity: pick(row, ['id', 'market', 'sourceId', 'sourceOfferId', 'make', 'model', 'generation', 'trim', 'year',
    'productionDate', 'inventorySourceDate', 'sourceTitle', 'status', 'offerType', 'mileageKm', 'color', 'bodyType', 'transmission']),
    commercial: pick(row, ['sourcePrice', 'sourceCurrency', 'priceMode', 'editorialPriceKey']),
    dates: {...pick(row, ['firstSeenAt', 'updatedAt', 'expiresAt']), ...pick(row.operational,
      ['lastSeenAt', 'sourcePublishedAt', 'lastSeenScanCycleId', 'paidEncarReportSnapshot'])},
    media: {images: row.images, cardImageUrl: row.cardImageUrl}, manual: manualProperties(row),
    provenance: pick(row.operational, ['sourceUrl', 'sourceVenueName', 'vin', 'frameNumber', 'provider'])};
}
export function paidRepairRowsProof(rows, editorial) {
  const ordered = [...rows].sort((a, b) => a.id.localeCompare(b.id)), seen = new Set();
  const hashes = Object.fromEntries(['ids', 'rows', 'invariants', 'commercial', 'freshness', 'media', 'manual', 'derivedQuotes']
    .map(key => [key, createHash('sha256').update('[')]));
  for (const [index, row] of ordered.entries()) {
    assertPaidIdentity(row); assert.ok(!seen.has(row.id), 'paid_repair_duplicate_current_id'); seen.add(row.id);
    const invariant = paidRepairInvariant(row, editorial);
    const values = {ids: row.id, rows: row, invariants: invariant,
      commercial: [row.id, invariant.commercial], freshness: [row.id, invariant.dates],
      media: [row.id, invariant.media], manual: [row.id, invariant.manual],
      derivedQuotes: [row.id, pick(row, ['totalRub','sellerPriceRub','calculationStatus','catalogPricingMode'])]};
    for (const [key, value] of Object.entries(values)) {
      if (index) hashes[key].update(',');
      hashes[key].update(JSON.stringify(stable(value)));
    }
  }
  return {count: rows.length, ...Object.fromEntries(Object.entries(hashes).map(([key, hash]) => [key + 'Sha256', hash.update(']').digest('hex')]))};
}
function verifiedTechnical(row) {
  const semantic = row.operational?.semanticEvidence || {};
  const foreignExact = sourceFields.some(field => exact(semantic[field]) && semantic[field].source
    && !String(semantic[field].source).startsWith('auto_api_encar:v3:'));
  return Boolean(foreignExact || row.encyclopediaCalculation || row.operational?.encyclopediaCalculation
    || row.operational?.knowledgeCore?.fieldsApplied?.some(field => sourceFields.includes(field))
    || row.astraPower30Evidence || Number(row.power30MinKw) > 0 || row.power30MinKwByMotor?.length
    || /owner|customer|manual|manufacturer|official|government|regulator|homolog|registration|encyclopedia|power-knowledge|document|certificate/i.test(String(row.powerDataSource || ''))
    || row.powerDataConfidence === 'documented');
}

/** Correct only a currently published identity from the same source observation.
 * A newer observation, manual/verified technical data or a differing source year
 * is never replaced by this historical payload. */
export function mergePaidEncarTechnicalCorrection(current, source, {observedAt, editorial}) {
  assertPaidIdentity(current);
  const baseline = paidRepairEffectiveCurrent(current, editorial);
  const unchanged = reason => ({offer: baseline, outcome: reason, changedFields: [], expectedSourceFields: {},
    protectedTechnical: pick(baseline, protectedTechnicalFields), protectedTechnicalFields});
  // These are the serving encyclopedia's existing owner-input boundaries.
  // Preserve the entire personal scenario, including its chosen driven axle.
  if (manualTechnical(baseline)) return unchanged('manual_technical_preserved');
  if (!source) return unchanged('saved_identity_absent');
  assertPaidIdentity(source);
  assert.ok(source.id === current.id && source.sourceOfferId === current.sourceOfferId, 'paid_repair_source_identity_mismatch');
  assert.equal(observation(source), Date.parse(observedAt), 'paid_repair_source_observation_mismatch');
  if (current.status !== 'active') return unchanged('current_not_active');
  if (observation(current) > Date.parse(observedAt)) return unchanged('newer_observation_preserved');
  assert.equal(observation(current), Date.parse(observedAt), 'paid_repair_current_observation_unbound');
  if (current.year !== source.year) return unchanged('current_year_preserved');
  if (sourceFields.some(field => ['conflict', 'ambiguous'].includes(source.operational?.semanticEvidence?.[field]?.status)))
    return unchanged('source_technical_conflict_preserved');
  const out = structuredClone(baseline), expectedSourceFields = {};
  const protectedCore = verifiedTechnical(current);
  const semantic = {...(current.operational?.semanticEvidence || {})};
  if (!protectedCore) {
    for (const field of coreFields) {
      if (source[field] === undefined) delete out[field]; else out[field] = structuredClone(source[field]);
    }
    for (const field of ['year', ...sourceFields, 'certifiedPower']) {
      if (source.operational?.semanticEvidence?.[field]) semantic[field] = structuredClone(source.operational.semanticEvidence[field]);
    }
    for (const field of sourceFields) if (exact(source.operational?.semanticEvidence?.[field])) expectedSourceFields[field] = source[field];
    if (!exact(source.operational?.semanticEvidence?.certifiedPower)) {
      expectedSourceFields.power30MinKw = null;
      expectedSourceFields.power30MinKwByMotor = null;
      if (['electric','series_hybrid','other_hybrid'].includes(source.powertrainKind)) expectedSourceFields.utilizationPowerKw = null;
    }
    Object.assign(out.operational, pick(source.operational, ['sourcePower', 'sourceDisplacementLitres']));
    if (source.operational?.powerSanity) out.operational.powerSanity = structuredClone(source.operational.powerSanity);
    else delete out.operational.powerSanity;
  }
  const manualDrive = editorialEntry(current, editorial)?.specifications?.drive || current.editorialSpecifications?.drive;
  const existingDrive = current.operational?.semanticEvidence?.drive;
  const protectDrive = manualDrive || exact(existingDrive) && !String(existingDrive.source).startsWith('auto_api_encar:v3:');
  if (!protectDrive) {
    if (source.drive === undefined) delete out.drive; else out.drive = source.drive;
    semantic.drive = structuredClone(source.operational.semanticEvidence.drive);
    out.operational.sourceDriveEvidence = structuredClone(source.operational.sourceDriveEvidence);
    // null is an explicit absence in the durable receipt, not a guessed axle.
    expectedSourceFields.drive = source.drive ?? null;
  }
  const changedFields = [...coreFields, 'drive'].filter(field => !same(baseline[field], out[field]));
  const evidenceChanged = !same(current.operational?.semanticEvidence, semantic)
    || !same(current.operational?.sourcePower, out.operational.sourcePower)
    || !same(current.operational?.sourceDriveEvidence, out.operational.sourceDriveEvidence);
  if (!changedFields.length && !evidenceChanged) return unchanged(protectedCore ? 'verified_technical_preserved' : 'already_correct');
  Object.assign(out.operational, {exactDetail: true, detailIdentityVerified: true, fieldIdentityVerified: true, semanticEvidence: semantic});
  // A corrected technical input invalidates only automatic quote artifacts.
  // Saved personal scenarios and current source prices remain untouched.
  for (const field of derivedFields) delete out[field];
  out.totalRub = null; out.calculationStatus = 'needs_data';
  if (sourceFields.some(field => changedFields.includes(field))) delete out.fuelPowertrainEvidence;
  assert.equal(paidRepairDigest(paidRepairInvariant(out, editorial)), paidRepairDigest(paidRepairInvariant(baseline, editorial)),
    'paid_repair_non_technical_change');
  return {offer: out, outcome: protectedCore ? 'source_drive_corrected_verified_core_preserved' : 'technical_corrected',
    changedFields, expectedSourceFields, protectedTechnicalFields: [...(protectedCore ? coreFields : []), ...(protectDrive ? ['drive'] : [])],
    protectedTechnical: pick(baseline, [...(protectedCore ? coreFields : []), ...(protectDrive ? ['drive'] : [])])};
}

export function buildPaidEncarTechnicalRepair({currentRows, sourceById, sourceProof, manifestMeta, protectedObjects,
  editorial, liveIdentity, sourceSha, controllerSha, now = Date.now()}) {
  assert.ok(COMMIT.test(sourceSha) && COMMIT.test(controllerSha) && COMMIT.test(liveIdentity?.release)
    && SHA.test(liveIdentity?.calculationVersion), 'paid_repair_code_identity_invalid');
  assert.ok(manifestMeta?.value?.version === 2 && /^gen_\d+_[a-z0-9-]+$/.test(manifestMeta.value.generationId), 'paid_repair_manifest_invalid');
  assert.equal(manifestMeta.value.markets?.korea?.provider, 'auto_api_encar', 'paid_repair_current_provider_invalid');
  assert.equal(currentRows.length, manifestMeta.value.markets.korea.count, 'paid_repair_current_coverage_incomplete');
  assert.ok(currentRows.length > 0 && currentRows.every(row => row.status === 'active'), 'paid_repair_current_set_inactive');
  assert.ok(same(sourceProof?.identity, PAID_ENCAR_REPAIR_SNAPSHOT) && SHA.test(sourceProof?.snapshotSha256)
    && SHA.test(sourceProof?.pagesSha256) && Number.isSafeInteger(sourceProof?.rows) && sourceProof.rows > 0 && sourceProof.rows <= 1000000
    && Number.isSafeInteger(sourceProof?.pages) && sourceProof.pages > 0 && sourceProof.pages <= 20000 && Number.isFinite(Date.parse(sourceProof.observedAt)),
  'paid_repair_snapshot_proof_invalid');
  assert.ok(now >= Date.parse(sourceProof.observedAt), 'paid_repair_future_source_observation');
  assert.deepEqual(Object.keys(protectedObjects).sort(), [...PAID_ENCAR_REPAIR_PROTECTED_KEYS].sort(), 'paid_repair_protected_objects_incomplete');
  const revisions = Object.fromEntries(Object.entries(protectedObjects).map(([key, meta]) => [key, paidRepairObjectRevision(meta)]));
  assert.equal(revisions['catalog-editorial/current.json'].sha256, paidRepairDigest(editorial), 'paid_repair_editorial_unbound');
  const before = paidRepairRowsProof(currentRows, editorial), offers = [], records = [], examples = [];
  for (const row of [...currentRows].sort((a, b) => a.id.localeCompare(b.id))) {
    const result = mergePaidEncarTechnicalCorrection(row, sourceById.get(row.id), {observedAt: sourceProof.observedAt, editorial});
    offers.push(result.offer);
    records.push({id: row.id, sourceOfferId: row.sourceOfferId, outcome: result.outcome, changedFields: result.changedFields,
      invariantSha256: paidRepairDigest(paidRepairInvariant(row, editorial)), expectedSourceFields: result.expectedSourceFields,
      beforeQuote: pick(row, ['totalRub','sellerPriceRub']),
      ...(result.protectedTechnical ? {protectedTechnical: result.protectedTechnical, protectedTechnicalFields: result.protectedTechnicalFields} : {})});
    if (['42799484','42760061'].includes(row.sourceOfferId)) examples.push({id:row.id, sourceOfferId:row.sourceOfferId,
      outcome:result.outcome, before:paidRepairExampleFields(row), savedSource:paidRepairExampleFields(sourceById.get(row.id)),
      input:paidRepairExampleFields(result.offer)});
  }
  const outcomes = records.reduce((out, row) => {out[row.outcome] = (out[row.outcome] || 0) + 1; return out;}, {});
  const core = {version: 1, mode: 'paid_encar_saved_technical_repair', sourceSha, controllerSha, liveIdentity,
    generationId: manifestMeta.value.generationId, manifest: paidRepairObjectRevision(manifestMeta), protectedObjects: revisions,
    utcDay: new Date(now).toISOString().slice(0, 10), policyDay: new Date(now + 7 * 3600000).toISOString().slice(0, 10),
    sourceProof, before, inputRowsSha256: paidRepairRowsProof(offers, editorial).rowsSha256, outcomes, examples, records};
  return {offers, receipt: {core, sha256: paidRepairDigest(core)}};
}

export function assertPaidRepairReceipt(receipt) {
  const core = receipt?.core;
  assert.ok(core?.version === 1 && core.mode === 'paid_encar_saved_technical_repair'
    && receipt.sha256 === paidRepairDigest(core) && COMMIT.test(core.sourceSha) && COMMIT.test(core.controllerSha)
    && same(core.sourceProof?.identity, PAID_ENCAR_REPAIR_SNAPSHOT) && Array.isArray(core.records)
    && core.records.length === core.before?.count && new Set(core.records.map(row => row.id)).size === core.records.length,
  'paid_repair_receipt_invalid');
  return core;
}
export function assertPaidRepairPublicationRows(receipt, rows, editorial, {input = false} = {}) {
  const core = assertPaidRepairReceipt(receipt), proof = paidRepairRowsProof(rows, editorial);
  assert.equal(proof.count, core.before.count, 'paid_repair_row_count_changed');
  assert.equal(proof.idsSha256, core.before.idsSha256, 'paid_repair_id_set_changed');
  if (input) assert.equal(proof.rowsSha256, core.inputRowsSha256, 'paid_repair_input_changed');
  for (const field of ['invariantsSha256', 'commercialSha256', 'freshnessSha256', 'mediaSha256', 'manualSha256'])
    assert.equal(proof[field], core.before[field], 'paid_repair_' + field + '_changed');
  const byId = new Map(rows.map(row => [row.id, row]));
  for (const record of core.records) {
    const row = paidRepairEffectiveCurrent(byId.get(record.id), editorial);
    for (const [field, value] of Object.entries(record.expectedSourceFields))
      assert.ok(same(row[field] ?? null, value ?? null), 'paid_repair_source_field_changed:' + field);
    if (record.protectedTechnical) {
      const fields = record.protectedTechnicalFields;
      assert.ok(Array.isArray(fields) && fields.every(field => protectedTechnicalFields.includes(field)), 'paid_repair_protected_fields_invalid');
      assert.ok(same(pick(row, fields), record.protectedTechnical), 'paid_repair_verified_technical_changed');
    }
  }
  return proof;
}
