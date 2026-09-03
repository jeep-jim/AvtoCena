import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ChnGoodCarPaginatedExactAdapter,
  joinGoodCarCarsListAndDetail,
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
<div>23600</div><div>库存：1 辆</div><div>车型 SUV</div><div>车辆类型 紧凑型</div>
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

test('paginated Good Car v2 records list fuel as advisory and never replaces exact detail fuel', () => {
  const row = joined({ FuelTypeName: '纯电动' });
  assert.equal(row.listFuelName, '纯电动');
  assert.equal(row.fuel, '汽油');
  const offer = new ChnGoodCarPaginatedExactAdapter().normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer.fuel, '汽油');
  assert.match(String((offer.operational.semanticEvidence as any)?.listFieldBoundary), /never replace/i);
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
