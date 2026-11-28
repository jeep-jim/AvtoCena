import {createHash} from 'node:crypto';
import {a4Power160ContinuationReport} from './japan-source-count-report-fixture.mjs';
import {japanExactCountQueryHash} from '../../scripts/catalog-next/japan-exact-count-browser.mjs';
import {japanSourcePriceCountApi} from '../../scripts/catalog-next/japan-source-price-order-browser.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');

/** Synthetic controller evidence only. Actual source prices and receipts are
 * observed by the bounded browser producer, never supplied by this fixture. */
export function sourcePriceOrderReport(checkedAt = '2026-11-28T12:00:00.000Z') {
  const report = a4Power160ContinuationReport(checkedAt);
  Object.assign(report, {japanPriceSortRequired: true, japanPriceSortPassed: true,
    japanCountDisplayPassed: true, japanSourcePriceOrderRequired: true, japanSourcePriceOrderPassed: true});
  report.checks.sourceCount.ui.label = 'В базе аукционов: 1\u00a0234';
  const observedAt = new Date(Date.parse(checkedAt) - 60_000).toISOString();
  const counts = [false, true].map(power => {
    const total = 1000, query = japanSourcePriceCountApi({power, countOnly: false});
    const requestedQueryHash = japanExactCountQueryHash(query);
    const summary = {total, stale: false, observedAt, upperBound: true, precision: 'source-upper-bound',
      selectionScope: 'source-candidates', sourceScopeComplete: !power,
      sourceCountProof: {version: 1, kind: 'japan-source-count', predicateVersion: 'japan-source-candidates-v1',
        requestedQueryHash, sourceQueryHash: hash('source:unfiltered-power'), evidenceEpoch: hash('epoch'),
        sourceTotal: total, sourceObservedAt: observedAt, sourceScopeComplete: !power, directoryComplete: true}};
    return {selection: power ? 'power160' : 'plain', query, summary, independentCount: true, queryHashVerified: true,
      admittedTotal: null, ui: {status: power ? 'source' : 'bounded', sourceTotal: total, requestedQueryHash, observedAt, loadedCount: 24,
        label: 'В базе аукционов: ' + total.toLocaleString('ru-RU')}};
  });
  const checks = ['totalRubDesc', 'totalRub'].map((sort, index) => {
    const powerLanes = Array.from({length: 48}, (_, position) => position < 30 ? 'known' : 'unknown');
    const sourcePrices = Array.from({length: 48}, (_, position) => position < 30
      ? (index === 0 ? 30 - position : position + 1) * 20000 + 0.25
      : (index === 0 ? 48 - position : position - 29) * 5000 + 0.25);
    const cursor = 'j2.k.2.0.2.' + hash(sort) + '.' + hash('epoch') + '.-';
    return {sort, status: 200, shown: 48, loadedBefore: 24, added: 24, loadedAfter: 48, duplicateIds: 0,
      oldIdsPreserved: true, orderPreserved: true, sourcePricesMatchApi: true, sourcePriceOrder: true,
      knownBeforeUnknown: true, sourcePriceOrderWithinPowerLanes: true,
      sameFilter: true, followedEmittedCursor: true, cursor, continuationCursor: cursor,
      beforeIdsSha256: hash('before:' + sort), addedIdsSha256: hash('added:' + sort),
      afterIdsSha256: hash('after:' + sort), idsSha256: hash('after:' + sort),
      sourcePrices, sourcePricesSha256: hash(JSON.stringify(sourcePrices)),
      powerLanes, powerLanesSha256: hash(JSON.stringify(powerLanes)),
      firstPage: {kind: 'rendered-ssr', shown: 24, observedAt, sourcePages: 1, receiptsSha256: hash('ssr'),
        sourceReceiptsFresh: true, page: 1, afterSha256: hash(''), ssrBindingMatched: true},
      nextPage: {kind: 'append-api', status: 200, shown: 24, observedAt, sourcePages: 1, receiptsSha256: hash('append'),
        sourceReceiptsFresh: true, stale: false, partial: false, total: null},
      initialCount: {...counts[1].ui}, finalCount: {...counts[1].ui, loadedCount: 48}};
  });
  report.checks.priceSort = {contract: 'japan-source-price-order-browser-v2', selectedThroughUi: true,
    city: 'Новокузнецк', powerTo: 160, directions: ['totalRubDesc', 'totalRub'],
    priceBasis: 'source_FINISH_JPY', priceOrderScope: 'source_order_within_power_lanes_across_append',
    sourcePriceOrderAcrossPages: true, globalDeliveredPriceOrderClaimed: false, powerLanesReordered: false,
    counts, countRequestedQueryChangesWithPower: true, countSourceQueryPreservedWithPower: true,
    explicitApiReads: 2, ordinaryAppendRequests: 2,
    liveExhaustiveScan: false, pageErrors: 0, checks};
  return report;
}
