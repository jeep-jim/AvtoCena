import assert from 'node:assert/strict';
import test from 'node:test';
import { kcarSpecificationEvidence, parseKcarExactDetail } from '../apps/web/lib/catalog/kcar-exact-source';
import { isCatalogYearAllowed } from '../apps/web/lib/catalog/offer-quality';
test('KCar calendar date controls age while next model year remains separate', () => {
  const evidence = kcarSpecificationEvidence({ regModelYear: '2025', manufactureDate: '202407' });
  assert.equal(evidence.year.value, 2024); assert.equal(evidence.modelYear.value, 2025);
  assert.equal(evidence.year.status, 'exact');
  const old = kcarSpecificationEvidence({ regModelYear: '2020', manufactureDate: '201911' });
  assert.equal(isCatalogYearAllowed(old.year.value, 'korea'), false);
});
test('KCar malformed dates remain ambiguous instead of falling back to a newer model year', () => {
  for (const manufactureDate of ['202413', '202400', '2024unknown', '2025-2026', '20240200', '20240230']) {
    const evidence = kcarSpecificationEvidence({ regModelYear: '2025', manufactureDate });
    assert.equal(evidence.year.status, 'ambiguous');
  }
});
test('KCar rejection diagnostic preserves identity and listing status checks', () => {
  const reasons: string[] = [];
  assert.equal(parseKcarExactDetail({ carCd: 'EC1' }, { rvo: { carCd: 'EC2', statCd: 'CAR_STATUS010' } }, r => reasons.push(r)), null);
  assert.equal(parseKcarExactDetail({ carCd: 'EC1' }, { rvo: { carCd: 'EC1', statCd: 'sold' } }, r => reasons.push(r)), null);
  assert.deepEqual(reasons, ['detail_identity_mismatch', 'not_active']);
});


test('inventory accepts one exact vehicle photo and missing power, never a different car photo',()=>{
 const previous=process.env.CATALOG_SOURCE_INVENTORY_MODE;process.env.CATALOG_SOURCE_INVENTORY_MODE='1';
 try{
 const meta={carCd:'EC61390500'};
 const data:any={rvo:{carCd:meta.carCd,statCd:'CAR_STATUS010',mnuftrNm:'Hyundai',modelNm:'Avante',grdNm:'Smart',regModelyr:'2024',mfgDt:'202401',salprc:2000},outerPhotoList:[{thumbnailType:'01',elanPath:'https://img.kcar.com/3dcarpicture/2026/07/081/61390500_1/main/main780.jpg'}]};
 const reasons:string[]=[];const row=parseKcarExactDetail(meta,data,r=>reasons.push(r));assert.ok(row,JSON.stringify(reasons));
 assert.equal(row.images.length,1);assert.equal(row.powerHp,undefined);
 data.outerPhotoList[0].elanPath=data.outerPhotoList[0].elanPath.replace('61390500_1','99999999_1');assert.equal(parseKcarExactDetail(meta,data),null);
 }finally{if(previous===undefined)delete process.env.CATALOG_SOURCE_INVENTORY_MODE;else process.env.CATALOG_SOURCE_INVENTORY_MODE=previous;}
});
