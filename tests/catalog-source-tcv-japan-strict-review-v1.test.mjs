import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStrictTcvReview } from '../scripts/catalog-source-tcv-japan-strict-review-v1.mjs';

function baseInput() {
  return {
    generatedAt: '2026-09-04T07:23:52.292Z',
    sourceId: 'tcv_japan_candidate',
    sourceUrl: 'https://www.tc-v.com',
    listUrl: 'https://www.tc-v.com/used_car/all/all/',
    productionWrites: false,
    classificationMutations: false,
    publishAllowedMutations: false,
    objectStorageWrites: false,
    catalogGenerationWrites: false,
    rawBodiesStored: false,
    guessedRoutes: false,
    sourcePublishAllowed: false,
    sourceVerdict: 'exact_catalog_signal_requires_manual_review',
    summary: { candidateCount: 25 },
    samples: [],
  };
}

function exactSample(id, power = [{ value: 280, unit: 'PS' }]) {
  return {
    listingId: id,
    stableReachable: true,
    exactReady: true,
    matrix: {
      fields: {
        identity: 'exact', year: 'exact', price: 'exact', currency: 'exact', mileage: 'exact', engineCc: 'exact',
        fuel: 'exact', body: 'exact', power: 'exact', certifiedPower: 'not_applicable', gallery: 'exact',
      },
      exactReady: true,
      deficits: [],
      detailPower: power,
      listPower: power,
      listingBoundImageCount: 20,
    },
  };
}

test('strict TCV review never promotes bare PS/HP/kW tokens to exact power', () => {
  const input = baseInput();
  input.samples = [exactSample('43847281'), exactSample('43814804', [{ value: 260, unit: 'PS' }])];
  const out = buildStrictTcvReview(input);
  assert.equal(out.summary.exactReady, 0);
  assert.equal(out.summary.powerMissing, 2);
  assert.equal(out.summary.unstructuredPowerRejected, 2);
  assert.equal(out.sourceVerdict, 'lead_only_signal');
  for (const row of out.samples) {
    assert.equal(row.exactReady, false);
    assert.equal(row.matrix.fields.power, 'missing_or_ambiguous');
    assert.equal(row.matrix.powerEvidenceStatus, 'unstructured_token_not_exact');
    assert.ok(row.matrix.deficits.includes('power'));
    assert.deepEqual(row.matrix.acceptedStructuredPowerTokens, []);
  }
});

test('strict TCV review stays fail-closed even when v1 saw no power token at all', () => {
  const input = baseInput();
  input.samples = [exactSample('43810106', [])];
  const out = buildStrictTcvReview(input);
  assert.equal(out.samples[0].matrix.fields.power, 'missing_or_ambiguous');
  assert.equal(out.samples[0].exactReady, false);
  assert.equal(out.summary.unstructuredPowerRejected, 0);
});

test('strict TCV review rejects unsafe input envelopes before producing evidence', () => {
  const input = baseInput();
  input.productionWrites = true;
  assert.throws(() => buildStrictTcvReview(input), /productionWrites must be false/);
});
