import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { contextsAround, keyValueHits, localIdEvidence, objectEvidenceNearId } from '../scripts/catalog-source-gap-recon-v1.mjs';

test('keyValueHits keeps only calculation and identity-adjacent gap keys', () => {
  const hits = keyValueHits(`{"price":31499,"engineSize":"1.5","powerHp":150,"trackingId":"abc","gallery":["x"]}`);
  assert.ok(hits.some((row) => row.key === 'price' && row.value === '31499'));
  assert.ok(hits.some((row) => row.key === 'engineSize' && row.value === '1.5'));
  assert.ok(hits.some((row) => row.key === 'powerHp' && row.value === '150'));
  assert.ok(!hits.some((row) => row.key === 'trackingId'));
});

test('contextsAround is bounded and evidence-only', () => {
  const rows = contextsAround('before engineDisplacement 1.5 after horsepower 150 HP end', ['engineDisplacement', 'horsepower'], 20, 4);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.context.length < 200));
});

test('objectEvidenceNearId finds JSON object that actually contains offer id', () => {
  const scripts = [{ type: 'application/json', id: '__NEXT_DATA__', value: {
    unrelated: { price: 1 },
    vehicle: { id: '9714841918', price: 64999, engineSize: '1.8', bodyType: 'SUV', images: ['a.jpg', 'b.jpg'] },
  } }];
  const rows = objectEvidenceNearId(scripts, '9714841918');
  assert.ok(rows.length >= 1);
  assert.ok(rows.some((row) => row.interesting.some((item) => item.key === 'price')));
  assert.ok(rows.some((row) => row.interesting.some((item) => item.key === 'engineSize')));
});

test('localIdEvidence binds inline script evidence to the listing id context', () => {
  const html = `<script>window.__x={id:"857416",engineDisplacement:"5.7",horsepower:"360 HP",price:13500,images:["https://example.com/cars/857416/a.jpg","https://example.com/cars/857416/b.jpg"]}</script>`;
  const rows = localIdEvidence(html, 'https://example.com/car/857416', '857416');
  assert.ok(rows.length >= 1);
  assert.ok(rows.some((block) => block.keyValues.some((row) => row.key === 'engineDisplacement' && row.value === '5.7')));
  assert.ok(rows.some((block) => block.keyValues.some((row) => row.key === 'horsepower' && row.value === '360 HP')));
  assert.ok(rows.some((block) => block.imageCount >= 2));
});

test('targeted gap recon cannot write production or bypass access controls', () => {
  const source = fs.readFileSync('scripts/catalog-source-gap-recon-v1.mjs', 'utf8');
  assert.doesNotMatch(source, /publish-autocatalog|catalog-probe-source-shard|S3_BUCKET|YC_SERVICE_ACCOUNT|DATABASE_URL|POSTGRES_URL/i);
  assert.match(source, /productionWrites:\s*false/);
  assert.match(source, /classificationMutations:\s*false/);
  assert.match(source, /publishAllowedMutations:\s*false/);
  assert.match(source, /rawBodiesStored:\s*false/);
  assert.match(source, /requestMethod:\s*'GET_only'/);
  assert.match(source, /challengeBypass:\s*false/);
  assert.match(source, /robotsBypass:\s*false/);
});
