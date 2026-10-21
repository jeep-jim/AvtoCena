import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCatalogSort,toggleCatalogSort,compareCatalogTerms} from '../apps/web/lib/catalog/catalog-sort';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {filterGreenCorner} from '../apps/web/lib/catalog/green-corner-search';
import {buildCatalogColorIndex,matchesCatalogColor} from '../apps/web/lib/catalog/catalog-color-index';
test('ordered sort priorities, direction replacement and strict supplier whitelist',()=>{
 assert.deepEqual(parseCatalogSort('totalRub,mileage'),['totalRub','mileage']);
 assert.equal(toggleCatalogSort('totalRub,mileage','totalRubDesc'),'totalRubDesc,mileage');
 assert.equal(toggleCatalogSort('totalRub,mileage','totalRub'),'mileage');
 for(const invalid of ['year,yearAsc','mileage,mileage','totalRub;drop','year,mileage,totalRub,yearAsc']){assert.equal(parseCatalogSort(invalid),null);assert.throws(()=>ajesQuery({sort:invalid}));}
 assert.match(ajesQuery({table:'korea',color:'Белый'}).sql,/color in \(.*'WHITE'/);
 assert.match(ajesQuery({table:'korea',sort:'totalRub,mileage'}).sql,/order by finish asc, mileage asc, id asc/);
});
test('secondary mileage breaks price ties; zero is real, missing stays last in either direction',()=>{
 const rows=[{id:'unknown',price:100,mileageKm:undefined},{id:'more',price:100,mileageKm:20},{id:'zero',price:100,mileageKm:0},{id:'cheaper',price:50,mileageKm:1000}];
 const sorted=(sort:string)=>[...rows].sort((a,b)=>compareCatalogTerms(a,b,parseCatalogSort(sort)!,r=>r.price)).map(r=>r.id);
 assert.deepEqual(sorted('totalRub,mileage'),['cheaper','zero','more','unknown']);
 assert.deepEqual(sorted('totalRub,mileageDesc'),['cheaper','more','zero','unknown']);
 assert.deepEqual(sorted('mileage,totalRub'),['zero','more','cheaper','unknown']);
});
test('colors come only from records and known aliases match without invented colors',()=>{
 const rows:any[]=[{id:'white',market:'china',color:' white ',year:2024},{id:'black',market:'china',color:'Чёрный',year:2024},{id:'unknown',market:'china',year:2024}];
 assert.deepEqual(buildCatalogColorIndex('g',rows).rows,[['white','china','Белый'],['black','china','Чёрный']]);
 assert.equal(matchesCatalogColor(rows[0],'Белый'),true);assert.equal(matchesCatalogColor(rows[1],'черный'),true);assert.equal(matchesCatalogColor(rows[2],'Белый'),false);
 assert.deepEqual(filterGreenCorner(rows,{color:'Белый'}).map(r=>r.id),['white']);
 assert.equal(filterGreenCorner(rows,{}).length,3);
});
