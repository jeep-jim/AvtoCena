import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogTrialSnapshot } from '../scripts/lib/catalog-trial-snapshot.mjs';

test('trial JSON keeps exact calculation evidence and source URLs without raw seller data or binary keys', () => {
  const snapshot = catalogTrialSnapshot({ id: 'offer', sourceId: 'source', sourceOfferId: '12', engineCc: 1998,
    totalRub: 2_000_000, calculationStatus: 'estimated', calculationSnapshot: { breakdown: [{ id: 'car', amountRub: 2_000_000 }] },
    images: [{ id: 'cached', url: 'https://source.example/12.jpg', objectKey: 'catalog/images/12.jpg', size: 123 }],
    sellerPhone: 'private', operational: { raw: { sellerPhone: 'private' }, vin: 'private', sourceUrl: 'https://source.example/12',
      semanticEvidence: { engineCc: { value: 1998, status: 'exact' } } } });
  assert.equal(snapshot.engineCc, 1998);
  assert.equal(snapshot.calculationSnapshot.breakdown[0].amountRub, snapshot.totalRub);
  assert.equal(snapshot.operational.semanticEvidence.engineCc.status, 'exact');
  assert.equal(snapshot.images[0].url, 'https://source.example/12.jpg');
  assert.equal(snapshot.images[0].size, 0);
  assert.equal(snapshot.images[0].objectKey, '');
  assert.doesNotMatch(JSON.stringify(snapshot), /private|sellerPhone|catalog\/images/);
});
