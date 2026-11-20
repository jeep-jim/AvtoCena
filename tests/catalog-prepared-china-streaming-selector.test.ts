import './helpers/server-only-hook.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {compileChinaPartDispatch,createChinaSelectorFacets,createChinaSelectorPage,summarizeChinaSelectorPart} from '../apps/web/lib/catalog/prepared-china-streaming-selector';
import {facetsForPreparedChinaCompatibilityRows,orderPreparedChinaCompatibilityRows,type CatalogSearchProjection} from '../apps/web/lib/catalog/storage';

const rows:CatalogSearchProjection[]=Array.from({length:1077},(_,i)=>({
 id:'fixture-'+String(i).padStart(4,'0'),market:'china',make:['BMW','Mercedes-Benz','Honda'][i%3],
 model:['X1','X 3','RAV4','C-Class','Accord'][i%5],totalRub:i%9<3?16_000_000+1000*(i%4):2_000_000+(i%5)*10_000,
 calculationStatus:'ready',powerHp:i%5===0?120:300,year:2021+i%5,mileageKm:(i*4234)%100_000,
 updatedAt:'2026-11-'+(i%6===2?'13':'14'),sourceGroup:['','che168','autohome','another','che168'][i%5],
 color:i%2?'красный':'жёлтый',bodyType:i%5?'Седан':'Универсал',fuel:i%6?'Бензин':'Гибрид',
}));
test('bounded rank exactly matches native source balancing, stable ties and composed sorting for every sampled prefix',()=>{
 for(const params of [
  {market:'china'},{market:'china',sort:'updatedAt'},
  {market:'china',sort:'totalRub'},{market:'china',sort:'totalRubDesc',city:'Омск'},
  {market:'china',sort:'year,mileageDesc'},
 ]){
  const expected=rows.slice();orderPreparedChinaCompatibilityRows(expected,params);
  for(const n of [1,2,14,24,97,192,336,750,1077]){
   const top=createChinaSelectorPage(params,n);
   for(const row of rows)top.add(row);
   assert.deepEqual(top.finish().map(x=>x.id),expected.slice(0,n).map(x=>x.id),JSON.stringify({params,n}));
  }
 }
 const count=createChinaSelectorPage({market:'china'},0);for(const row of rows)count.add(row);
 assert.deepEqual(count.finish(),[]);
});
test('dispatch never drops a matching make/union/year, and facets match native formatting',()=>{
 const source=rows.filter(x=>x.make==='Mercedes-Benz'&&x.year>2022),summary=summarizeChinaSelectorPart(source);
 assert.equal(compileChinaPartDispatch({make:'Mercedes-Benz, BMW, mercedes-Benz',yearFrom:2023})(summary),true);
 assert.equal(compileChinaPartDispatch({make:'BMW',yearFrom:2023})(summary),false);
 assert.equal(compileChinaPartDispatch({yearTo:2020})(summary),false);
 assert.throws(()=>compileChinaPartDispatch({})({...summary,makeMask:'bad'}),/streaming_selector/);
 for(const params of [{market:'china',hasPrice:'yes'},{market:'china'}]){
  const out=createChinaSelectorFacets('fixture',params);
  for(const row of rows)out.add(row);
  assert.deepEqual(out.finish(),facetsForPreparedChinaCompatibilityRows('fixture',rows,params));
 }
});
