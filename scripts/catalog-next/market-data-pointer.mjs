/**
 * Data-only market cutover: no imports of deploy, Docker, supplier or another
 * market. This module only changes one accepted pointer through compare-and-swap.
 *
 * The storage adapter must provide:
 *   read(market) -> {etag: string|null, value: pointer|null}
 *   compareAndSwap(market, expectedEtag, nextPointer) -> void
 *
 * Adapter/reader integration is a separate migration step: this is NOT an
 * alternate way to publish a prepared generation before its content is verified.
 */
export const MARKET_IDS = Object.freeze(['china', 'japan', 'korea', 'uae', 'europe', 'georgia', 'green']);
export const MARKET_POINTER_KIND = 'market-data-pointer-v1';
const MARKET_SET = new Set(MARKET_IDS);
const SHA256 = /^[a-f0-9]{64}$/;
const GEN = /^[a-z0-9][a-z0-9._-]{4,127}$/;
const SOURCE_MODES = new Set(['verified-full', 'verified-delta', 'permitted-cache']);

const fail = code => { throw Error('market_pointer_' + code); };
const need = (value, code) => { if (!value) fail(code); };
const instant = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && /^\d{4}-\d\d-\d\dT/.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const canonical = value => Array.isArray(value) ? value.map(canonical) : plain(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value;
const equal = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

export function validateMarketGeneration(market, value) {
  need(MARKET_SET.has(market) && plain(value), 'generation');
  const keys = ['market','generationId','manifestSha256','pricingContextSha256','sourceObservedAt','pricingAsOf','rowCount','sourceMode'];
  need(Object.keys(value).sort().join(',') === keys.sort().join(','), 'generation_fields');
  need(value.market === market && GEN.test(value.generationId), 'generation_market');
  need(SHA256.test(value.manifestSha256) && SHA256.test(value.pricingContextSha256), 'generation_checksum');
  need(instant(value.sourceObservedAt) && instant(value.pricingAsOf) && Date.parse(value.pricingAsOf)>=Date.parse(value.sourceObservedAt), 'generation_dates');
  need(Number.isSafeInteger(value.rowCount) && value.rowCount >= 0, 'generation_count');
  need(SOURCE_MODES.has(value.sourceMode), 'generation_mode');
  // AJ System cannot be mirrored. Japanese derived caches are partial by design.
  need(market === 'japan' ? value.sourceMode === 'permitted-cache' : value.sourceMode !== 'permitted-cache', 'source_permission');
  return Object.freeze({...value});
}

export function validateMarketPointer(market, pointer) {
  need(MARKET_SET.has(market) && plain(pointer), 'document');
  need(Object.keys(pointer).sort().join(',') === ['kind','version','market','revision','active','previous','changedAt'].sort().join(','), 'document_fields');
  need(pointer.kind === MARKET_POINTER_KIND && pointer.version === 1 && pointer.market === market
    && Number.isSafeInteger(pointer.revision) && pointer.revision > 0 && instant(pointer.changedAt), 'document_identity');
  if (pointer.active !== null) validateMarketGeneration(market, pointer.active);
  if (pointer.previous !== null) validateMarketGeneration(market, pointer.previous);
  need(!pointer.previous || (pointer.active && pointer.previous.generationId !== pointer.active.generationId), 'history');
  return pointer;
}

function checkedObservation(market, raw) {
  need(plain(raw) && Object.keys(raw).sort().join(',') === 'etag,value', 'observation');
  need(raw.etag === null || (typeof raw.etag === 'string' && raw.etag.length > 0), 'etag');
  if (raw.value !== null) validateMarketPointer(market, raw.value);
  need((raw.value === null) === (raw.etag === null), 'observation_consistency');
  return raw;
}
export function marketPointerPath(market) {
  need(MARKET_SET.has(market), 'market');
  return 'catalog/markets/' + market + '/accepted-pointer-v1.json';
}

function nextDocument(market, before, active, now) {
  return {kind: MARKET_POINTER_KIND,version:1,market,revision:(before?.revision ?? 0)+1,
    active,previous:before?.active ?? null,changedAt:now};
}

async function writeCAS({storage,market,prior,next}) {
  let writeError = false;
  try { await storage.compareAndSwap(market,prior.etag,next); }
  catch { writeError = true; }
  // Resolve a lost PUT response by exact readback, never assume success.
  const after = checkedObservation(market, await storage.read(market));
  if (equal(after.value,next)) return after;
  if (writeError) fail('cas_rejected_or_unknown');
  fail('write_not_durable');
}

async function checkedRead(storage,market) {
  need(storage && typeof storage.read === 'function' && typeof storage.compareAndSwap === 'function','adapter');
  return checkedObservation(market,await storage.read(market));
}

/**
 * Strictly one-market publication. verifyPrepared must authenticate the actual
 * manifest, city-price indexes, IDs, totals, and provider permission BEFORE
 * any write. verifyReading must test the new reader AFTER the atomic switch.
 */
export async function activateMarketGeneration({storage,market,generation,verifyPrepared,verifyReading,now=()=>new Date().toISOString()}) {
  validateMarketGeneration(market,generation);
  need(typeof verifyPrepared==='function' && typeof verifyReading==='function','verification');
  const prior=await checkedRead(storage,market);
  if (prior.value?.active?.generationId === generation.generationId) {
    need(equal(prior.value.active,generation),'generation_reused_with_different_content');
    return {status:'already-active',market,pointer:prior.value};
  }
  const prepared = await verifyPrepared({market,generation});
  need(prepared && prepared.verified === true && prepared.manifestSha256 === generation.manifestSha256,'unverified_prepared');
  const at=now();need(instant(at),'clock');
  const next=nextDocument(market,prior.value,generation,at);
  const activated=await writeCAS({storage,market,prior,next});
  try {
    const verdict=await verifyReading({market,generation,pointer:next});
    need(verdict?.verified===true && verdict.generationId===generation.generationId,'reader_verdict');
  } catch (error) {
    // No unconditional rollback. Never overwrite a different publication.
    const observed=await checkedRead(storage,market);
    if (!equal(observed.value,next)) fail('postcheck_failed_state_changed');
    const rollback={...next,revision:next.revision+1,active:prior.value?.active??null,
      previous:null,changedAt:now()};
    validateMarketPointer(market,rollback);
    await writeCAS({storage,market,prior:observed,next:rollback});
    fail('postcheck_failed_rolled_back');
  }
  return {status:'activated',market,pointer:activated.value};
}
