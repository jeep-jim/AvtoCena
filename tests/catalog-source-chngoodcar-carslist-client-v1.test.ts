import assert from 'node:assert/strict';
import test from 'node:test';
import {
  goodCarCarsListSearchBody,
  hasGoodCarCarsListUsdLabel,
  parseGoodCarCarsListIdentityRow,
} from '../apps/web/lib/catalog/chngoodcar-carslist';

test('Good Car CarsList client requires the explicit public USD price label', () => {
  assert.equal(hasGoodCarCarsListUsdLabel('<div>价格 (US $)</div>'), true);
  assert.equal(hasGoodCarCarsListUsdLabel('<div>价格</div>'), false);
});

test('Good Car CarsList client maps only exact identity/price/date/mileage/currency discovery fields', () => {
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
    Vin: 'SHOULD_NOT_BE_USED_FOR_IDENTITY',
    Displacement: null,
    Power: null,
    ShapeName: '',
    Url: '8db42098-fb7a-4cc8-8084-a231cadd3da5.jpg',
  });
  assert.ok(row);
  assert.equal(row.sourceOfferId, '2049753443165270016');
  assert.equal(row.detailUrl, 'https://www.chngoodcar.com/Home/Cars?id=2049753443165270016');
  assert.equal(row.sourceTitle, '马自达CX-50行也 2023款 2.0L 领行版');
  assert.equal(row.listPrice, 23600);
  assert.equal(row.listCurrency, 'USD');
  assert.equal(row.listProductionDate, '2023-10');
  assert.equal(row.listMileageKm, 15000);
  assert.equal(row.listFuelName, '汽油');
  assert.equal(row.listVehicleTypeName, '紧凑型');
  assert.equal(row.listGearboxName, '手自一体');
  assert.equal(row.listDrivingName, '前置前驱');
  assert.match(String(row.listImageUrl), /8db42098/);
  assert.equal('vin' in row, false);
  assert.equal('engineCc' in row, false);
  assert.equal('powerKw' in row, false);
  assert.equal('bodyType' in row, false);
});

test('Good Car CarsList client fails closed on malformed identity, non-USD, date and mileage', () => {
  const base = { Id: '1', Brand: 'MG5', Price: '8500', Currency: 'usd', ProductionDate: '2026-02', Mileage: '0' };
  assert.equal(parseGoodCarCarsListIdentityRow({ ...base, Id: 'abc' }), null);
  assert.equal(parseGoodCarCarsListIdentityRow({ ...base, Currency: 'cny' }), null);
  assert.equal(parseGoodCarCarsListIdentityRow({ ...base, ProductionDate: '2026-13' }), null);
  assert.equal(parseGoodCarCarsListIdentityRow({ ...base, Mileage: '-1' }), null);
});

test('Good Car CarsList client reproduces the source-declared no-filter POST without invented filter params', () => {
  const body = new URLSearchParams(goodCarCarsListSearchBody(7));
  assert.equal(body.get('Hot'), 'false');
  assert.equal(body.get('DefaultSort'), '1');
  assert.equal(body.get('PriceSort'), '0');
  assert.equal(body.get('MileageSort'), '0');
  assert.equal(body.get('YearSort'), '0');
  assert.equal(body.get('pageindex'), '7');
  assert.equal(body.get('pagesize'), '15');
  for (const key of ['Category','Price','Year','Mileage','Shape','Gearbox','Fuel','EmissionStandard','Steering','VehicleType','EngineModel']) assert.equal(body.has(key), false);
});
