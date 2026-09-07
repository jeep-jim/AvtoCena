import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { extractOfferCoreContract } from '../scripts/catalog-source-chngoodcar-contract-probe-v1.mjs';

test('offer-core parser binds exact fields before recommendation cards', () => {
  const html = `<html><body><div>现代悦动 2017款 1.6L 手动版 2600 库存： 1 辆</div>
  <div>车型 轿车 车辆类型 紧凑型 VIN码 LBEHDALA5HZ337818 出厂年份 2017-01 里程 (km) 104697 排量 (ml) 1591 功率 (kw) 90.4 变速箱 手动 燃料种类 汽油 门数 4 座位数 5</div>
  <img src="/cars/a.jpg"><img src="/cars/b.jpg"><img src="/cars/c.jpg"><img src="/cars/d.jpg"><img src="/cars/e.jpg">
  <div>猜你喜欢 其他车 价格： 9999 排量 2.0L</div></body></html>`;
  const out = extractOfferCoreContract(html, 'https://example.com/Home/Cars?id=1');
  assert.equal(out.priceRaw, '2600');
  assert.equal(out.bodyType, '轿车');
  assert.equal(out.vehicleType, '紧凑型');
  assert.equal(out.vin, 'LBEHDALA5HZ337818');
  assert.equal(out.displacementMl, 1591);
  assert.equal(out.powerKw, 90.4);
  assert.equal(out.fuel, '汽油');
  assert.equal(out.coreImageCount, 5);
  assert.equal(out.currencyTokensInCore.length, 0);
});

test('currency tokens are only recorded when explicit', () => {
  const html = '<div>车名 2100 库存：1辆 车型 轿车 排量 (ml) 1795 功率 (kw) 94.9 燃料种类 汽油 USD</div>';
  const out = extractOfferCoreContract(html, 'https://example.com/Home/Cars?id=1');
  assert.deepEqual(out.currencyTokensInCore, ['USD']);
});

test('Good Car probe is fixed to known/discovered routes and is no-write', () => {
  const source = fs.readFileSync('scripts/catalog-source-chngoodcar-contract-probe-v1.mjs', 'utf8');
  for (const id of ['1245159140309858930','1265916925100158976','1265916910290071552','1288729215201439744']) assert.match(source, new RegExp(id));
  assert.match(source, /guessedRoutes:\s*false/);
  assert.match(source, /routeOrigin:\s*'known_sample_or_discovered_in_run_33747985524'/);
  assert.doesNotMatch(source, /publish-autocatalog|catalog-probe-source-shard|S3_BUCKET|YC_SERVICE_ACCOUNT|DATABASE_URL|POSTGRES_URL/i);
  assert.match(source, /productionWrites:\s*false/);
  assert.match(source, /classificationMutations:\s*false/);
  assert.match(source, /publishAllowedMutations:\s*false/);
  assert.match(source, /rawBodiesStored:\s*false/);
});
