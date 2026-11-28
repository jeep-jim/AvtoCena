import {createHash} from 'node:crypto';

export const JAPAN_CROSSOVER_POWER_CONTRACT = 'japan-crossover-power160-browser-v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** An additional ordinary visitor journey. It cannot stand in for the existing
 * source-price, model, count, power-order or calculation proofs. */
export function japanCrossoverAcceptancePassed(report) {
  const proof = report?.checks?.crossoverPower160, checkedAt = Date.parse(report?.checkedAt);
  const cursor = typeof proof?.cursor === 'string'
    ? /^j2\.[ku]\.([1-9]\d{0,6})\.(0|[1-9]\d?)\.2\.[a-f0-9]{64}\.[a-f0-9]{64}\.(-|[a-f0-9]{64})$/.exec(proof.cursor) : null;
  const fresh = value => Number.isFinite(Date.parse(value)) && Date.parse(value) <= checkedAt
    && checkedAt - Date.parse(value) < 30 * 60_000;
  const page = (value, ssr) => value?.kind === (ssr ? 'rendered-ssr' : 'append-api')
    && value.shown === 24 && value.sourceReceiptsFresh === true && fresh(value.observedAt)
    && Number.isSafeInteger(value.sourcePages) && value.sourcePages >= 1 && value.sourcePages <= 8
    && digest(value.receiptsSha256) && (ssr ? value.page === 1 && value.afterSha256 === hash('')
      && value.ssrBindingMatched === true : value.status === 200 && value.stale === false
        && value.partial === false && value.interrupted === false && value.total === null);
  if (!(Number.isFinite(checkedAt) && report?.japanCrossoverPower160Required === true
    && report.japanCrossoverPower160Passed === true && proof?.contract === JAPAN_CROSSOVER_POWER_CONTRACT
    && proof.city === 'Новокузнецк' && proof.bodyType === 'suv' && proof.powerTo === 160
    && proof.documentStatus === 200 && proof.loadedBefore === 24 && proof.added === 24 && proof.loadedAfter === 48
    && proof.duplicateIds === 0 && proof.pageErrors === 0 && proof.alerts === 0
    && proof.explicitApiReads === 0 && proof.ordinaryAppendRequests === 1 && proof.liveExhaustiveScan === false
    && ['sameFilter', 'cityPreserved', 'bodyControlPreserved', 'powerControlPreserved', 'oldIdsPreserved',
      'orderPreserved', 'followedEmittedCursor', 'allBodiesSuv', 'knownBeforeUnknown', 'powerValuesMatchApi']
      .every(key => proof[key] === true)
    && ['beforeIdsSha256', 'addedIdsSha256', 'afterIdsSha256', 'powersSha256'].every(key => digest(proof[key]))
    && cursor && proof.cursor === proof.continuationCursor && Number(cursor[1]) <= 1_000_000
    && Number(cursor[2]) <= 24 && (Number(cursor[2]) === 0) === (cursor[3] === '-')
    && page(proof.firstPage, true) && page(proof.nextPage, false)
    && Array.isArray(proof.powers) && proof.powers.length === 48
    && proof.powersSha256 === hash(JSON.stringify(proof.powers)))) return false;
  let unknown = false;
  for (const value of proof.powers) {
    if (value === null) unknown = true;
    else if (unknown || typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 160) return false;
  }
  return true;
}
