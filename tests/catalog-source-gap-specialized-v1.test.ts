import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { bodyTermEvidence, galleryContainerEvidence, numberedImageClusters, specialPhraseEvidence, visibleCurrencyEvidence, visibleUnitEvidence, wideOfferContextEvidence } from '../scripts/catalog-source-gap-specialized-v1.mjs';

test('numbered image clusters prove repeated upload-family galleries without guessing model identity', () => {
  const urls = Array.from({ length: 8 }, (_, i) => `https://file.example/direct/Eh123_${i + 1}.jpg`);
  const rows = numberedImageClusters(urls);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].count, 8);
  assert.deepEqual(rows[0].numbers.slice(0, 3), [1, 2, 3]);
});

test('gallery container evidence is structural and requires multiple images', () => {
  const html = '<ul class="gallery"><li><img src="/a.jpg"></li><li><img src="/b.jpg"></li><li><img src="/c.jpg"></li></ul>';
  const rows = galleryContainerEvidence(html, 'https://example.com/car/1');
  assert.ok(rows.length >= 1);
  assert.ok(rows[0].imageCount >= 3);
});

test('visible unit and currency evidence preserves explicit units', () => {
  const html = '<div>Engine 1.5 L, 4 Cyl</div><div>Power 150 HP</div><div>Price AED 31,499</div>';
  assert.ok(visibleUnitEvidence(html).some((row) => row.value === '1.5 L'));
  assert.ok(visibleUnitEvidence(html).some((row) => row.value === '150 HP'));
  assert.ok(visibleCurrencyEvidence(html).some((row) => /31,499/.test(row.value)));
});

test('body term evidence records direct body words but does not map categories', () => {
  const rows = bodyTermEvidence('<div>Vehicle type Hatchback</div><div>승용차</div>');
  assert.ok(rows.some((row) => row.value.toLowerCase() === 'hatchback'));
  assert.ok(rows.some((row) => row.value === '승용차'));
});

test('wide offer context retains explicit engine highlight and price keys near listing id', () => {
  const html = '<script>window.x={"id":"9714841569","engineSize":1.5,"highlightName":"1.5 L, 4 Cyl Engine","sellingPrice":31499}</script>';
  const rows = wideOfferContextEvidence(html, '9714841569', 'https://example.com/car/9714841569');
  assert.ok(rows.length >= 1);
  assert.ok(rows.some((row) => row.keyValues.some((item) => item.key === 'highlightName' && /1.5 L/.test(item.value))));
  assert.ok(rows.some((row) => row.keyValues.some((item) => item.key === 'sellingPrice' && item.value === '31499')));
});

test('special phrase extraction can find named power and price expressions', () => {
  const rows = specialPhraseEvidence('"enginePower":"150 HP","certifiedPower":"70 kW","salePrice":31499');
  assert.ok(rows.some((row) => /enginePower/i.test(row.expression)));
  assert.ok(rows.some((row) => /certifiedPower/i.test(row.expression)));
  assert.ok(rows.some((row) => /salePrice/i.test(row.expression)));
});

test('specialized recon cannot write production or bypass access controls', () => {
  const source = fs.readFileSync('scripts/catalog-source-gap-specialized-v1.mjs', 'utf8');
  assert.doesNotMatch(source, /publish-autocatalog|catalog-probe-source-shard|S3_BUCKET|YC_SERVICE_ACCOUNT|DATABASE_URL|POSTGRES_URL/i);
  assert.match(source, /productionWrites:\s*false/);
  assert.match(source, /classificationMutations:\s*false/);
  assert.match(source, /publishAllowedMutations:\s*false/);
  assert.match(source, /rawBodiesStored:\s*false/);
  assert.match(source, /requestMethod:\s*'GET_only'/);
  assert.match(source, /challengeBypass:\s*false/);
  assert.match(source, /robotsBypass:\s*false/);
});
