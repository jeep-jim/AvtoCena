import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { extractExplicitUnitEvidence, extractExpectedOfferPrice, extractGalleryProof } from '../scripts/catalog-source-deficit-resolution-v1.mjs';

test('unit evidence keeps explicit litres/cc/power separate', () => {
  const out=extractExplicitUnitEvidence('<div>Engine 1.8L</div><div>Power 144 BHP</div><div>1498 cc</div>',1.8);
  assert.equal(out.engineLiterMatches[0].value,1.8);
  assert.equal(out.ccEvidence[0].value,1498);
  assert.equal(out.powerEvidence[0].value,144);
});

test('expected AED offer price is recorded without accepting other fees', () => {
  const out=extractExpectedOfferPrice('<h2>AED 64,999</h2><p>Convenience fee AED 3,500</p><script>{"appointmentId":"9714841918","price":64999}</script>',64999);
  assert.ok(out?.visibleHits.length);
  assert.ok(out?.embeddedContexts.some((x:any)=>/64999/.test(x)));
});

test('Boba gallery proof counts image indexes within one offer-bound series', () => {
  const html='<div class="gallery-data">2260063 https://file4.bobaedream.co.kr/direct/2026/04/13/Eh11431776047830_4_s1.jpg https://file4.bobaedream.co.kr/direct/2026/04/13/Eh11431776047830_5_s1.jpg https://file4.bobaedream.co.kr/direct/2026/04/13/Eh11431776047830_6_s1.jpg https://file4.bobaedream.co.kr/direct/2026/04/13/Eh11431776047830_7_s1.jpg https://file4.bobaedream.co.kr/direct/2026/04/13/Eh11431776047830_8_s1.jpg</div>';
  const proof=extractGalleryProof(html,'2260063','boba');
  assert.equal(proof[0].series,'Eh11431776047830');
  assert.equal(proof[0].uniqueUnderlyingCount,5);
});

test('DubiCars gallery proof collapses render variants by terminal UUID', () => {
  const html='<div class="car-images-slider">740206 https://www.dubicars.com/images/aaa/private/c244b6a4-610a-4800-beca-6f1f4d0eb41d.jpg https://www.dubicars.com/images/bbb/private/c244b6a4-610a-4800-beca-6f1f4d0eb41d.jpg https://www.dubicars.com/images/ccc/private/5325e9d9-fce9-4ae6-8bc3-b92f005a4f7e.jpg https://www.dubicars.com/images/ddd/private/a351ce98-7ad3-41e9-a82a-1d1b04ad090a.jpg</div>';
  const proof=extractGalleryProof(html,'740206','dubicars');
  assert.equal(proof[0].uniqueUnderlyingCount,3);
});

test('resolution pass is no-write and does not classify sources', () => {
  const source=fs.readFileSync('scripts/catalog-source-deficit-resolution-v1.mjs','utf8');
  assert.doesNotMatch(source,/publish-autocatalog|catalog-probe-source-shard|S3_BUCKET|YC_SERVICE_ACCOUNT|DATABASE_URL|POSTGRES_URL/i);
  assert.match(source,/productionWrites:false/);
  assert.match(source,/classificationMutations:false/);
  assert.match(source,/publishAllowedMutations:false/);
  assert.match(source,/rawBodiesStored:false/);
});
