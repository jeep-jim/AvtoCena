import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChnGoodCarExactAdapter,
  goodCarKwToProjectHp,
  hasGoodCarUsdPriceContract,
  isGoodCarIceFuel,
  isGoodCarPassengerBodyType,
  parseGoodCarDetailHtml,
  splitGoodCarMakeModel,
  type GoodCarExactRawOffer,
} from '../apps/web/lib/catalog/chngoodcar-exact-source';
import { isAllowedCatalogSourceId } from '../apps/web/lib/catalog/required-catalog-sources';

const DETAIL_URL = 'https://www.chngoodcar.com/Home/Cars?id=2049753443165270016';
const DETAIL_HTML = `<!doctype html><html><head><title>马自达CX-50行也 2023款 2.0L 领行版_广东好车_打造二手车出口新渠道</title></head><body>
<section class="gallery">
<img src="https://image.ucoc.net/web_en/images/index/douyin.png">
<img src="https://image.cn.ucoc.net/Picture/Automobile/LargeThumbnail/1.jpg">
<img src="https://image.cn.ucoc.net/Picture/Automobile/LargeThumbnail/2.jpg">
<img src="https://image.cn.ucoc.net/Picture/Automobile/LargeThumbnail/3.jpg">
<img src="https://image.cn.ucoc.net/Picture/Automobile/LargeThumbnail/4.jpg">
<img src="https://image.cn.ucoc.net/Picture/Automobile/LargeThumbnail/5.jpg">
<img src="https://image.cn.ucoc.net/Picture/Automobile/LargeThumbnail/6.jpg">
</section>
<h2>马自达CX-50行也 2023款 2.0L 领行版</h2>
<div>23600</div><div>库存：1 辆</div>
<div>车型 SUV</div><div>车辆类型 紧凑型</div><div>VIN码 LSGZG5397KS093671</div>
<div>出厂年份 2023-10</div><div>里程 (km) 15000</div><div>排量 (ml) 2000</div><div>功率 (kw) 114</div>
<div>变速箱 手自一体</div><div>燃料种类 汽油</div><div>车身颜色 香槟/棕色</div><div>门数 5</div><div>座位数 5</div><div>驱动形式 前置前驱</div>
<div>猜你喜欢</div><img src="https://image.cn.ucoc.net/Picture/Automobile/LargeThumbnail/recommendation.jpg">
</body></html>`;

function exactRaw(overrides: Partial<GoodCarExactRawOffer> = {}): GoodCarExactRawOffer {
  const parsed = parseGoodCarDetailHtml(DETAIL_HTML, DETAIL_URL);
  assert.ok(parsed);
  return {
    ...parsed,
    listTitle: parsed.sourceTitle,
    listPrice: parsed.sourcePrice,
    currency: 'USD',
    currencyLabelVerified: true,
    listDetailPriceParity: true,
    listDetailTitleParity: true,
    ...overrides,
  };
}

test('Good Car USD contract is explicit and never inferred from a numeric value', () => {
  assert.equal(hasGoodCarUsdPriceContract('<div>价格(US $)</div><div>2000-5000</div>'), true);
  assert.equal(hasGoodCarUsdPriceContract('<div>价格</div><div>23600</div>'), false);
});

test('Good Car detail parser keeps offer-bound ICE fields and cuts recommendation/social images', () => {
  const row = parseGoodCarDetailHtml(DETAIL_HTML, DETAIL_URL);
  assert.ok(row);
  assert.equal(row.sourceOfferId, '2049753443165270016');
  assert.equal(row.sourceTitle, '马自达CX-50行也 2023款 2.0L 领行版');
  assert.equal(row.sourcePrice, 23600);
  assert.equal(row.productionDate, '2023-10');
  assert.equal(row.year, 2023);
  assert.equal(row.mileageKm, 15000);
  assert.equal(row.engineCc, 2000);
  assert.equal(row.powerKw, 114);
  assert.equal(row.fuel, '汽油');
  assert.equal(row.bodyType, 'SUV');
  assert.equal(row.transmission, '手自一体');
  assert.equal(row.drive, '前置前驱');
  assert.equal(row.vin, 'LSGZG5397KS093671');
  assert.equal(row.imageUrls.length, 6);
  assert.equal(row.imageUrls.some((url) => /recommendation|douyin/i.test(url)), false);
});

test('kW conversion uses the documented metric-horsepower relation and retains raw kW', () => {
  assert.equal(goodCarKwToProjectHp(114), 155);
  assert.equal(goodCarKwToProjectHp(0), undefined);
});

test('make/model split is fail-closed unless the source title starts with an explicit supported make', () => {
  assert.deepEqual(splitGoodCarMakeModel('马自达CX-50行也 2023款 2.0L 领行版'), { make: '马自达', model: 'CX-50行也' });
  assert.deepEqual(splitGoodCarMakeModel('现代名驭 2014款 1.8L 手动版'), { make: '现代', model: '名驭' });
  assert.equal(splitGoodCarMakeModel('途岳 2025款 新锐 1.5L 锐进版'), null);
});

test('ICE gate accepts source-bound combustion fuels and blocks electrified values', () => {
  assert.equal(isGoodCarIceFuel('汽油'), true);
  assert.equal(isGoodCarIceFuel('柴油'), true);
  assert.equal(isGoodCarIceFuel('纯电动'), false);
  assert.equal(isGoodCarIceFuel('油电混合'), false);
  assert.equal(isGoodCarIceFuel('新能源'), false);
});

test('v1 exact gate is limited to confirmed passenger body types', () => {
  assert.equal(isGoodCarPassengerBodyType('轿车'), true);
  assert.equal(isGoodCarPassengerBodyType('SUV'), true);
  assert.equal(isGoodCarPassengerBodyType('MPV'), true);
  assert.equal(isGoodCarPassengerBodyType('客车'), false);
  assert.equal(isGoodCarPassengerBodyType('货车'), false);
});

test('adapter normalizes an exact ICE passenger offer with source-exact power provenance', async () => {
  const adapter = new ChnGoodCarExactAdapter();
  const offer = adapter.normalizeOffer(exactRaw());
  assert.ok(offer);
  assert.equal(offer.sourceId, 'chngoodcar_china_candidate');
  assert.equal(offer.sourceCurrency, 'USD');
  assert.equal(offer.powertrainKind, 'combustion');
  assert.equal(offer.powerKw, 114);
  assert.equal(offer.icePowerKw, 114);
  assert.equal(offer.powerHp, 155);
  assert.equal(offer.powerDataConfidence, 'source_exact');
  assert.match(String(offer.powerDataSource), /功率\(kw\)/);
  const images = await adapter.fetchImages(offer);
  assert.equal(images.length, 6);
  assert.equal(offer.operational.galleryVerified, true);
});

test('adapter fails closed on EV/hybrid, non-passenger, missing USD proof, parity mismatch and insufficient gallery', () => {
  const adapter = new ChnGoodCarExactAdapter();
  assert.equal(adapter.normalizeOffer(exactRaw({ fuel: '纯电动' })), null);
  assert.equal(adapter.normalizeOffer(exactRaw({ fuel: '油电混合' })), null);
  assert.equal(adapter.normalizeOffer(exactRaw({ bodyType: '客车' })), null);
  assert.equal(adapter.normalizeOffer(exactRaw({ currencyLabelVerified: false })), null);
  assert.equal(adapter.normalizeOffer(exactRaw({ listDetailPriceParity: false })), null);
  assert.equal(adapter.normalizeOffer(exactRaw({ imageUrls: exactRaw().imageUrls.slice(0, 4) })), null);
});

test('research adapter remains outside the production China allowlist', () => {
  assert.equal(isAllowedCatalogSourceId('china', 'chngoodcar_china_candidate'), false);
});
