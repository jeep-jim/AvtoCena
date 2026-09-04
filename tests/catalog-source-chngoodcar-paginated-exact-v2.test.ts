import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChnGoodCarPaginatedExactAdapter,
  cleanGoodCarPaginatedModelIdentity,
  goodCarIdentityNamedElectrifiedKind,
  joinGoodCarCarsListAndDetail,
  normalizeGoodCarBrandModelIdentity,
  parseGoodCarPaginatedDetailMileageKm,
  type GoodCarPaginatedExactRawOffer,
} from '../apps/web/lib/catalog/chngoodcar-paginated-exact-source';
import { parseGoodCarDetailHtml } from '../apps/web/lib/catalog/chngoodcar-exact-source';
import { parseGoodCarCarsListIdentityRow } from '../apps/web/lib/catalog/chngoodcar-carslist';
import { isAllowedCatalogSourceId } from '../apps/web/lib/catalog/required-catalog-sources';

const DETAIL_URL = 'https://www.chngoodcar.com/Home/Cars?id=2049753443165270016';
const DETAIL_HTML = `<!doctype html><html><head><title>马自达CX-50行也 2023款 2.0L 领行版_广东好车_打造二手车出口新渠道</title></head><body>
<img src="https://image.cn.ucoc.net/Picture/Automobile/LargeThumbnail/1.jpg">
<img src="https://image.cn.ucoc.net/Picture/Automobile/LargeThumbnail/2.jpg">
<img src="https://image.cn.ucoc.net/Picture/Automobile/LargeThumbnail/3.jpg">
<img src="https://image.cn.ucoc.net/Picture/Automobile/LargeThumbnail/4.jpg">
<img src="https://image.cn.ucoc.net/Picture/Automobile/LargeThumbnail/5.jpg">
<img src="https://image.cn.ucoc.net/Picture/Automobile/LargeThumbnail/6.jpg">
<div>23600</div><div>库存：1 辆</div><div>车型 SUV</div><div>车辆类型 紧凑型</div><div>VIN码 LSGZG5397KS093671</div>
<div>出厂年份 2023-10</div><div>里程 (km) 15000</div><div>排量 (ml) 2000</div><div>功率 (kw) 114</div>
<div>变速箱 手自一体</div><div>燃料种类 汽油</div><div>驱动形式 前置前驱</div><div>猜你喜欢</div>
</body></html>`;

function listRow(overrides: Record<string, unknown> = {}) {
  const row = parseGoodCarCarsListIdentityRow({
    Id: '2049753443165270016',
    Brand: '马自达CX-50行也 2023款 2.0L 领行版',
    Price: '23600.00',
    Currency: 'usd',
    ProductionDate: '2023-10',
    Mileage: '15000',
    FuelTypeName: '汽油',
    VehicleTypeName: '紧凑型',
    GearboxName: '手自一体',
    DrivingName: '前置前驱',
    ...overrides,
  });
  assert.ok(row);
  return row;
}

function joined(overrides: Record<string, unknown> = {}) {
  const detail = parseGoodCarDetailHtml(DETAIL_HTML, DETAIL_URL);
  assert.ok(detail);
  const row = joinGoodCarCarsListAndDetail(listRow(overrides), detail, true);
  assert.ok(row);
  return row;
}

test('paginated Good Car v2 requires exact CarsList/detail title, price, date and mileage parity', () => {
  const row = joined();
  assert.equal(row.discoverySource, 'CarsList/SearchCarList');
  assert.equal(row.listCurrencyVerified, true);
  assert.equal(row.listDetailTitleParity, true);
  assert.equal(row.listDetailPriceParity, true);
  assert.equal(row.listDetailProductionDateParity, true);
  assert.equal(row.listDetailMileageParity, true);
});

test('paginated Good Car detail mileage preserves source decimals instead of truncating them', () => {
  assert.equal(parseGoodCarPaginatedDetailMileageKm('<div>里程 (km)</div><b>4.9</b>'), 4.9);
  assert.equal(parseGoodCarPaginatedDetailMileageKm('<div>里程 (km) 42000</div>'), 42000);
  assert.equal(parseGoodCarPaginatedDetailMileageKm('<div>里程 (km) --</div>'), undefined);
});

test('paginated Good Car identity cleanup is deterministic for year suffixes and source brand spelling', () => {
  assert.equal(cleanGoodCarPaginatedModelIdentity('CX-30 2022 款 2.0L 自动雅悦型'), 'CX-30');
  assert.equal(cleanGoodCarPaginatedModelIdentity('CX-50行也'), 'CX-50行也');
  assert.deepEqual(normalizeGoodCarBrandModelIdentity('现代汽车', '伊兰特'), { make: '现代', model: '伊兰特' });
  assert.deepEqual(normalizeGoodCarBrandModelIdentity('大众', '汽车T-ROC探歌'), { make: '大众', model: 'T-ROC探歌' });
  assert.deepEqual(normalizeGoodCarBrandModelIdentity('MG', '5'), { make: 'MG', model: 'MG5' });
});

test('paginated Good Car v2 records list fuel as advisory and never replaces exact detail fuel', () => {
  const row = joined({ FuelTypeName: '纯电动' });
  assert.equal(row.listFuelName, '纯电动');
  assert.equal(row.fuel, '汽油');
  const offer = new ChnGoodCarPaginatedExactAdapter().normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer.fuel, '汽油');
  assert.match(String((offer.operational.semanticEvidence as any)?.listFieldBoundary), /never replace/i);
});

test('Chinese identity-bound electrified markers are detected before combustion normalization', () => {
  assert.equal(goodCarIdentityNamedElectrifiedKind('丰田卡罗拉锐放 2023款 双擎 2.0L 先锋版'), 'other_hybrid');
  assert.equal(goodCarIdentityNamedElectrifiedKind('某车型 2025款 插混 1.5T'), 'other_hybrid');
  assert.equal(goodCarIdentityNamedElectrifiedKind('某车型 2025款 增程版'), 'series_hybrid');
  assert.equal(goodCarIdentityNamedElectrifiedKind('马自达CX-50行也 2023款 2.0L 领行版'), undefined);
});

test('paginated Good Car v2 blocks exact-title hybrid conflict even when list and detail both say petrol', () => {
  const adapter = new ChnGoodCarPaginatedExactAdapter();
  const exact = joined();
  const conflict = {
    ...exact,
    sourceTitle: '丰田卡罗拉锐放 2023款 双擎 2.0L 先锋版',
    listTitle: '丰田卡罗拉锐放 2023款 双擎 2.0L 先锋版',
    fuel: '汽油',
    listFuelName: '汽油',
    listDetailTitleParity: true,
  } as GoodCarPaginatedExactRawOffer;
  assert.equal(adapter.normalizeOffer(conflict), null);
});

test('paginated Good Car v2 drops repeated source VIN from normalized identity', () => {
  const offer = new ChnGoodCarPaginatedExactAdapter().normalizeOffer(joined());
  assert.ok(offer);
  assert.equal(offer.vin, undefined);
  assert.equal(offer.operational.vin, undefined);
  assert.match(String((offer.operational.semanticEvidence as any)?.identity), /VIN excluded/i);
});

test('paginated Good Car v2 fails closed on any independent list/detail parity break', () => {
  const adapter = new ChnGoodCarPaginatedExactAdapter();
  const exact = joined();
  for (const patch of [
    { listCurrencyVerified: false },
    { listDetailTitleParity: false },
    { listDetailPriceParity: false },
    { listDetailProductionDateParity: false },
    { listDetailMileageParity: false },
  ]) {
    assert.equal(adapter.normalizeOffer({ ...exact, ...patch } as GoodCarPaginatedExactRawOffer), null);
  }
});

test('paginated Good Car v2 still delegates ICE/body/gallery/power gates to exact detail adapter', () => {
  const adapter = new ChnGoodCarPaginatedExactAdapter();
  const exact = joined();
  assert.ok(adapter.normalizeOffer(exact));
  assert.equal(adapter.normalizeOffer({ ...exact, fuel: '油电混合' }), null);
  assert.equal(adapter.normalizeOffer({ ...exact, bodyType: '客车' }), null);
  assert.equal(adapter.normalizeOffer({ ...exact, powerKw: 0 }), null);
  assert.equal(adapter.normalizeOffer({ ...exact, imageUrls: exact.imageUrls.slice(0, 4) }), null);
});

test('paginated Good Car v2 remains outside production China allowlist', () => {
  assert.equal(isAllowedCatalogSourceId('china', 'chngoodcar_china_candidate'), false);
});
