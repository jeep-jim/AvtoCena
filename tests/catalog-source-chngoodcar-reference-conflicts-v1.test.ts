import assert from 'node:assert/strict';
import test from 'node:test';
import { goodCarVerifiedReferenceConflict } from '../apps/web/lib/catalog/chngoodcar-reference-conflicts';
import { ChnGoodCarPaginatedExactAdapter, type GoodCarPaginatedExactRawOffer } from '../apps/web/lib/catalog/chngoodcar-paginated-exact-source';

test('Good Car exact 2016 Prado 3.5 TX diesel label is a verified external-reference conflict', () => {
  const conflict = goodCarVerifiedReferenceConflict({
    sourceTitle: '丰田普拉多 2016款 3.5L 自动TX',
    engineCc: 3500,
    powerKw: 206,
    fuel: '柴油',
  });
  assert.ok(conflict);
  assert.equal(conflict.field, 'fuel');
  assert.equal(conflict.sourceValue, '柴油');
  assert.equal(conflict.verifiedValue, '汽油');
  assert.equal(conflict.referenceSource, 'Autohome exact spec 23948');
  assert.equal(conflict.referenceUrl, 'https://www.autohome.com.cn/spec/23948/');
});

test('Good Car exact 2018 Song MAX flagship 6-seat SUV label conflicts with the exact MPV reference', () => {
  const conflict = goodCarVerifiedReferenceConflict({
    sourceTitle: '比亚迪 宋MAX 2018款 1.5T 自动智联旗舰型 6座',
    engineCc: 1500,
    powerKw: 113,
    fuel: '汽油',
    bodyType: 'SUV',
  });
  assert.ok(conflict);
  assert.equal(conflict.field, 'bodyType');
  assert.equal(conflict.sourceValue, 'SUV');
  assert.equal(conflict.verifiedValue, 'MPV');
  assert.equal(conflict.referenceSource, 'Autohome exact spec 33704');
});

test('Good Car exact 2012 Camry Zunrui 2.5HG petrol label conflicts with the exact hybrid reference', () => {
  const conflict = goodCarVerifiedReferenceConflict({
    sourceTitle: '丰田 凯美瑞 2012款 尊瑞 2.5HG 豪华版',
    engineCc: 2500,
    powerKw: 118,
    fuel: '汽油',
    bodyType: '轿车',
  });
  assert.ok(conflict);
  assert.equal(conflict.field, 'fuel');
  assert.equal(conflict.sourceValue, '汽油');
  assert.equal(conflict.verifiedValue, '油电混合');
  assert.equal(conflict.referenceSource, 'Autohome exact spec 12931');
});

test('Good Car exact 2019 Geely Xingyue 300T petrol label conflicts with the exact 48V mild-hybrid reference', () => {
  const conflict = goodCarVerifiedReferenceConflict({
    sourceTitle: '吉利汽车 星越 2019款 300T 探星者',
    engineCc: 1477,
    powerKw: 130,
    fuel: '汽油',
    bodyType: 'SUV',
  });
  assert.ok(conflict);
  assert.equal(conflict.field, 'fuel');
  assert.equal(conflict.sourceValue, '汽油');
  assert.equal(conflict.verifiedValue, '汽油+48V轻混系统');
  assert.equal(conflict.reason, 'goodcar_named_fuel_conflicts_with_exact_2019_geely_xingyue_300t_reference');
  assert.equal(conflict.referenceSource, 'Autohome exact spec 39287');
  assert.equal(conflict.referenceUrl, 'https://www.autohome.com.cn/spec/39287/');
});

test('Good Car exact 2017 VW Langxing 180TSI sedan label conflicts with the exact hatchback reference', () => {
  const conflict = goodCarVerifiedReferenceConflict({
    sourceTitle: '大众汽车 朗行 2017款 180TSI DSG舒适版',
    engineCc: 1197,
    powerKw: 81,
    fuel: '汽油',
    bodyType: '轿车',
  });
  assert.ok(conflict);
  assert.equal(conflict.field, 'bodyType');
  assert.equal(conflict.sourceValue, '轿车');
  assert.equal(conflict.verifiedValue, '两厢车');
  assert.equal(conflict.reason, 'goodcar_named_body_conflicts_with_exact_2017_vw_langxing_180tsi_dsg_comfort_reference');
  assert.equal(conflict.referenceSource, 'Autohome exact spec 29388');
  assert.equal(conflict.referenceUrl, 'https://car.autohome.com.cn/config/spec/29388.html');
});

test('Good Car reference conflict gate is narrow and never rewrites ordinary rows', () => {
  assert.equal(goodCarVerifiedReferenceConflict({ sourceTitle: '丰田普拉多 2016款 3.5L 自动TX', engineCc: 3500, powerKw: 206, fuel: '汽油', bodyType: 'SUV' }), null);
  assert.equal(goodCarVerifiedReferenceConflict({ sourceTitle: '比亚迪 宋MAX 2018款 1.5T 自动智联旗舰型 6座', engineCc: 1500, powerKw: 113, fuel: '汽油', bodyType: 'MPV' }), null);
  assert.equal(goodCarVerifiedReferenceConflict({ sourceTitle: '丰田 凯美瑞 2012款 尊瑞 2.5HG 豪华版', engineCc: 2500, powerKw: 118, fuel: '油电混合', bodyType: '轿车' }), null);
  assert.equal(goodCarVerifiedReferenceConflict({ sourceTitle: '吉利汽车 星越 2019款 300T 探星者', engineCc: 1477, powerKw: 130, fuel: '汽油+48V轻混系统', bodyType: 'SUV' }), null);
  assert.equal(goodCarVerifiedReferenceConflict({ sourceTitle: '大众汽车 朗行 2017款 180TSI DSG舒适版', engineCc: 1197, powerKw: 81, fuel: '汽油', bodyType: '两厢车' }), null);
  assert.equal(goodCarVerifiedReferenceConflict({ sourceTitle: '吉利汽车 星越 2019款 350T 探星者', engineCc: 1969, powerKw: 175, fuel: '汽油', bodyType: 'SUV' }), null);
  assert.equal(goodCarVerifiedReferenceConflict({ sourceTitle: '丰田普拉多 2016款 2.7L 自动标准版', engineCc: 2700, powerKw: 120, fuel: '汽油' }), null);
  assert.equal(goodCarVerifiedReferenceConflict({ sourceTitle: '马自达CX-50行也 2023款 2.0L 领行版', engineCc: 2000, powerKw: 114, fuel: '汽油', bodyType: 'SUV' }), null);
});

test('paginated Good Car adapter fails closed on a verified exact-version source conflict', () => {
  const raw = {
    sourceOfferId: '1869632025078525952',
    detailUrl: 'https://www.chngoodcar.com/Home/Cars?id=1869632025078525952',
    sourceTitle: '丰田普拉多 2016款 3.5L 自动TX',
    listTitle: '丰田普拉多 2016款 3.5L 自动TX',
    sourcePrice: 24900,
    listPrice: 24900,
    currency: 'USD',
    currencyLabelVerified: true,
    listCurrencyVerified: true,
    listDetailPriceParity: true,
    listDetailTitleParity: true,
    productionDate: '2016-05',
    listProductionDate: '2016-05',
    year: 2016,
    mileageKm: 200000,
    listMileageKm: 200000,
    listDetailProductionDateParity: true,
    listDetailMileageParity: true,
    engineCc: 3500,
    powerKw: 206,
    fuel: '柴油',
    transmission: '自动',
    bodyType: 'SUV',
    vehicleType: '大型',
    imageUrls: Array.from({ length: 9 }, (_, index) => `https://image.cn.ucoc.net/Picture/Automobile/LargeThumbnail/${index + 1}.jpg`),
    discoverySource: 'CarsList/SearchCarList',
  } as GoodCarPaginatedExactRawOffer;
  assert.equal(new ChnGoodCarPaginatedExactAdapter().normalizeOffer(raw), null);
});