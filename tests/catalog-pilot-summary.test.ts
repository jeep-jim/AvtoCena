import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizePilotMarket, boundedPilotInteger } from '../scripts/lib/catalog-pilot-summary.mjs';

test('pilot keeps adapter losses, duplicates and unexamined rows outside the calculation denominator', () => {
  const summary = summarizePilotMarket({
    pages: [{ diagnostics: { listingRows: 20, rejectedRows: 8 } }],
    listingRows: 12, duplicates: 2, normalizationRejected: 1, normalizedRows: 9,
    details: [
      { yearAllowed: true, totalRub: 3_000_000, calculationStatus: 'estimated', images: 5 },
      { yearAllowed: false, totalRub: 2_000_000, calculationStatus: 'estimated', images: 10 },
      { yearAllowed: true, error: 'missing:engine_cc' },
      { yearAllowed: true, totalRub: 16_000_000, calculationStatus: 'calculated', images: 10 },
      { yearAllowed: true, totalRub: 2_000_000, calculationStatus: 'preliminary', images: 10 },
    ],
  });
  assert.equal(summary.sourceListingRows, 20);
  assert.equal(summary.adapterRejectedRows, 8);
  assert.equal(summary.duplicateRows, 2);
  assert.equal(summary.unexaminedRows, 4);
  assert.equal(summary.examined, 5);
  assert.equal(summary.calculated, 3);
  assert.equal(summary.allowedYearExamined, 4);
  assert.equal(summary.allowedYearCalculated, 2);
  assert.equal(summary.passingAllFilters, 1);
});

test('pilot does not invent a source denominator when an adapter cannot report it', () => {
  const summary = summarizePilotMarket({ pages: [{ returnedRows: 10 }], listingRows: 10 });
  assert.equal(summary.sourceListingRows, null);
  assert.equal(summary.adapterRejectedRows, null);
});

test('invalid pilot bounds cannot disable network limits', () => {
  assert.equal(boundedPilotInteger('NaN', 8, 100), 8);
  assert.equal(boundedPilotInteger('Infinity', 8, 100), 8);
  assert.equal(boundedPilotInteger('9000', 8, 100), 100);
  assert.equal(boundedPilotInteger('3.9', 8, 100), 3);
  assert.equal(boundedPilotInteger('-2', 8, 100), 1);
});

test('public admission includes credibility, projection and price parity, with blocked detail work visible', () => {
  const row = { yearAllowed: true, totalRub: 2_000_000, calculationStatus: 'calculated', images: 5,
    publicDisplay: { credible: true, eligible: true, projectionCanRender: true, pricesAgree: true, breakdownMatchesTotal: true } };
  const summary = summarizePilotMarket({ details: [row,
    ...Object.keys(row.publicDisplay).map(key => ({ ...row, publicDisplay: { ...row.publicDisplay, [key]: false } })),
    { yearAllowed: true, error: 'pilot_request_outside_envelope' }] });
  assert.equal(summary.calculated, 6);
  assert.equal(summary.passingAllFilters, 1);
  assert.equal(summary.detailWorkBlocked, 1);
});
