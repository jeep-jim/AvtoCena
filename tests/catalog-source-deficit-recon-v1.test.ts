import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { extractBodyContexts, extractGalleryClusters, extractKeyContexts, extractRouteCandidates } from '../scripts/catalog-source-deficit-recon-v1.mjs';

test('route discovery remains same-origin and targeted', () => {
  const html = `
    <a href="/api/vehicle/12345/photos">photos</a>
    <a href="https://evil.example/api/vehicle/12345">foreign</a>
    <a href="/privacy">privacy</a>
    <script>window.dataUrl='/cars/12345/spec.json'</script>`;
  assert.deepEqual(extractRouteCandidates(html, 'https://example.com/car/12345', '12345'), [
    'https://example.com/api/vehicle/12345/photos',
    'https://example.com/cars/12345/spec.json',
  ]);
});

test('key contexts find source-like keys and redact secrets', () => {
  const html = `<script>{"listingPrice":31499,"engineDisplacement":"1.5","authorization":"Bearer nope"}</script>`;
  const contexts = extractKeyContexts(html, ['31499']);
  assert.ok(contexts.some((x: any) => /listingPrice=31499/.test(x.label)));
  assert.ok(contexts.some((x: any) => /engineDisplacement=1\.5/.test(x.label)));
  assert.ok(contexts.every((x: any) => !/Bearer nope/.test(x.snippet)));
});

test('gallery clustering records scoped image evidence without treating size variants as separate identities', () => {
  const html = `<div class="vehicle-gallery" data-offer="12345">
    Gallery 12345
    <img src="/images/w_650x380/car-a.jpg">
    <img src="/images/w_1300x760/car-a.jpg">
    <img src="/images/w_650x380/car-b.jpg">
    <img src="/images/w_650x380/car-c.jpg">
    <img src="/images/w_650x380/car-d.jpg">
  </div>`;
  const clusters = extractGalleryClusters(html, 'https://example.com/car/12345', '12345');
  assert.ok(clusters.length >= 1);
  assert.equal(clusters[0].offerIdInFragment, true);
  assert.equal(clusters[0].uniqueImageCount, 4);
});

test('body context extraction keeps nearby canonical body evidence', () => {
  const rows = extractBodyContexts('<div>차종: 세단</div><div>other</div>');
  assert.ok(rows.some((x: any) => /차종|세단/.test(x.marker)));
  assert.ok(rows.some((x: any) => /차종: 세단/.test(x.snippet)));
});

test('deficit recon is isolated from production writers', () => {
  const source = fs.readFileSync('scripts/catalog-source-deficit-recon-v1.mjs', 'utf8');
  assert.doesNotMatch(source, /publish-autocatalog|catalog-probe-source-shard|S3_BUCKET|YC_SERVICE_ACCOUNT|DATABASE_URL|POSTGRES_URL/i);
  assert.match(source, /productionWrites:\s*false/);
  assert.match(source, /classificationMutations:\s*false/);
  assert.match(source, /publishAllowedMutations:\s*false/);
  assert.match(source, /rawBodiesStored:\s*false/);
  assert.match(source, /alternateRouteRequestsPerformed:\s*false/);
});
