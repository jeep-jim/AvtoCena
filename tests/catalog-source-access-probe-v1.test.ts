import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { evaluateRobots, extractCatalogCandidates, extractDetailCandidates, summarizeBody } from '../scripts/catalog-source-access-probe-v1.mjs';

test('robots parser blocks explicit disallow and accepts longer allow', () => {
  const robots = `
User-agent: *
Disallow: /private/
Allow: /private/public/
`;
  assert.equal(evaluateRobots(robots, 'https://example.com/private/lot/123').allowed, false);
  assert.equal(evaluateRobots(robots, 'https://example.com/private/public/123').allowed, true);
});

test('detail candidate extraction is same-origin and conservative', () => {
  const html = `
<a href="/used-cars/vehicle/123456">car</a>
<a href="https://other.example/car/999999">foreign</a>
<a href="/search?car=123456">search</a>
<a href="/about">about</a>`;
  assert.deepEqual(
    extractDetailCandidates(html, 'https://example.com/used-cars', 2),
    ['https://example.com/used-cars/vehicle/123456'],
  );
});

test('page summary only records evidence signals', () => {
  const html = `<!doctype html><html><head><title>2023 Example Sedan - AED 75,000</title>
<meta property="og:image" content="/media/car-1.jpg">
<script type="application/ld+json">{"@type":"Vehicle","name":"Example","mileageFromOdometer":{"value":42000,"unitCode":"KMT"}}</script>
</head><body>
2023 sedan. Price AED 75,000. Mileage 42,000 km. Petrol. Engine 1998 cc. Power 150 hp.
<img src="/media/car-2.jpg"><img src="/logo.svg">
</body></html>`;
  const summary = summarizeBody(html, 'https://example.com/car/123');
  assert.deepEqual(summary.markers, {
    year: true,
    price: true,
    currency: true,
    mileage: true,
    fuel: true,
    engine: true,
    power: true,
    body: true,
  });
  assert.equal(summary.imageCount, 2);
  assert.equal(summary.jsonLd.parsedCount, 1);
  assert.ok(summary.jsonLd.types.includes('Vehicle'));
});

test('catalog route discovery prefers marketplace routes and rejects careers', () => {
  const html = '<a href="/as24-career-pages/">career</a><a href="/lst">cars</a><a href="/about">about</a>';
  assert.deepEqual(
    extractCatalogCandidates(html, 'https://www.autoscout24.com/', 3),
    ['https://www.autoscout24.com/lst'],
  );
});

test('detail extraction requires a listing identity and rejects numeric filters', () => {
  const html = '<a href="/buy-used-cars-under-100000-aed-dubai/">budget</a><a href="/2024-lamborghini-urus-981780.html">listing</a><a href="/cars/imglist-x-x-110-x.html">images</a>';
  assert.deepEqual(
    extractDetailCandidates(html, 'https://www.dubicars.com/uae/used', 5),
    ['https://www.dubicars.com/2024-lamborghini-urus-981780.html'],
  );
});

test('long marketplace page with incidental captcha text is not a challenge wall', () => {
  const html = `<html><head><title>Cars for sale</title></head><body>2024 AED 100000 10 km petrol engine 2000 cc 150 hp sedan captcha ${'x'.repeat(150000)}</body></html>`;
  assert.equal(summarizeBody(html, 'https://example.com').challenge, false);
});

test('catalog route discovery rejects community, loan and hot-rank false positives', () => {
  const html = '<a href="/car_fans_community">fans</a><a href="/car-loan/">loan</a><a href="/cars/hotrank/1">rank</a><a href="/dubai/used">used</a>';
  assert.deepEqual(
    extractCatalogCandidates(html, 'https://example.com/', 5),
    ['https://example.com/dubai/used'],
  );
});

test('detail extraction rejects calculator, dealer-info and backorder pseudo identities', () => {
  const html = '<a href="/calcos-1">calculator</a><a href="/dealerinfo/vendor-7772-tt-2">dealer</a><a href="/backorder2?utm_medium=menu">backorder</a><a href="/vehicle/123456">listing</a>';
  assert.deepEqual(
    extractDetailCandidates(html, 'https://example.com/list', 5),
    ['https://example.com/vehicle/123456'],
  );
});

test('detail extraction rejects model, community and editorial pages', () => {
  const html = '<a href="/auto/series/20041">series</a><a href="/community/160258950000000">community</a><a href="/cars/hotrank/detail/cms_f05c2798fa218c6b87829ff1d4440263">editorial</a><a href="/vehicle/654321">listing</a>';
  assert.deepEqual(
    extractDetailCandidates(html, 'https://example.com/', 5),
    ['https://example.com/vehicle/654321'],
  );
});

test('qualification probe is isolated from production writers', () => {
  const source = fs.readFileSync('scripts/catalog-source-access-probe-v1.mjs', 'utf8');
  assert.doesNotMatch(source, /catalog-probe-source-shard|publish-autocatalog|S3_BUCKET|YC_SERVICE_ACCOUNT|DATABASE_URL|POSTGRES_URL/i);
  assert.match(source, /productionWrites:\s*false/);
  assert.match(source, /classificationMutations:\s*false/);
  assert.match(source, /rawBodiesStored:\s*false/);
});
