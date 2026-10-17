import test from 'node:test';
import assert from 'node:assert/strict';
import {kcarRegistryEvidence} from '../apps/web/lib/catalog/kcar-registry-evidence';
import {catalogPowerSanity} from '../apps/web/lib/catalog/power-sanity';
import {automaticProductionYear,confirmedProductionValue} from '../apps/web/lib/catalog/production-month';
const vin='KNA12345678901234';
const rvo={vin,hrspow:204,fuelType:'001',fuelTypecdNm:'가솔린',mfgDt:'202010',regModelyr:'2021'};
const registry={basInfo:{vin,motoHghstOutpVal:'204'},productInfo:{prdcnDd:'20200922'}};
test('VIN-bound secondary table confirms labelled combustion hp and manufacturing day',()=>{
 const evidence=kcarRegistryEvidence(rvo,registry);
 assert.equal(evidence.powerHp,204);assert.equal(evidence.productionDate,'2020-09-22');
 assert.equal(confirmedProductionValue({year:2020,operational:{semanticEvidence:{productionDate:{source:'kcar_registry_production_date',status:'exact',value:evidence.productionDate}}}}),'2020-09-22');
 assert.equal(catalogPowerSanity({market:'korea',engineCc:1591,fuel:'petrol',powerHp:204,powerDataSource:'kcar_bound_registry_and_detail_hp'}).suspicious,false);
});
test('the real incident shape, 34 versus 304, stays unpriced instead of auto-corrected',()=>{
 assert.equal(kcarRegistryEvidence({...rvo,hrspow:34},{...registry,basInfo:{vin,motoHghstOutpVal:'304'}}).powerHp,undefined);
});
test('unbound, missing and malformed fields never supply power or dates',()=>{
 for(const bad of [{...registry,basInfo:{vin:'KNA00000000000000',motoHghstOutpVal:'204'}},{...registry,basInfo:{}},null]) {
  assert.deepEqual(kcarRegistryEvidence(rvo,bad),{bound:false});
 }
 for(const value of ['204 hp','20-204','',null]) assert.equal(kcarRegistryEvidence(rvo,{...registry,basInfo:{vin,motoHghstOutpVal:value}}).powerHp,undefined);
 for(const date of ['20200230','20200022','20990922','20200100']) assert.equal(kcarRegistryEvidence(rvo,{...registry,productInfo:{prdcnDd:date}}).productionDate,undefined);
});
test('peak electric and hybrid power never becomes certified utilization power',()=>{
 for(const fuelTypecdNm of ['전기','가솔린+전기']) assert.equal(kcarRegistryEvidence({...rvo,fuelTypecdNm},registry).powerHp,undefined);
 assert.equal(kcarRegistryEvidence({...rvo,fuelType:'009'},registry).powerHp,undefined);
});

test('K Car stops on denied detail without repeating the denial or requesting the secondary tab',async()=>{
 const {kcarKoreaExactSource}=await import('../apps/web/lib/catalog/kcar-exact-source');
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=async()=>{calls++;return calls===1?new Response(JSON.stringify({success:true,data:{rows:[{carCd:'EC1'}],totalCnt:1}}),{status:200}):new Response('denied',{status:403});};
 try {await assert.rejects(kcarKoreaExactSource.fetchPage(null),/kcar_source_blocked_http_403/);assert.equal(calls,2);}
 finally {globalThis.fetch=original;}
});


test('K Car registration/model year cannot stand in for unknown production age',()=>{
 const offer={sourceId:'kcar_korea_open',year:2021,productionDate:'202101',operational:{semanticEvidence:{year:{status:'exact',source:'kcar_exact_detail_rvo_calendar_year',value:2021}}}};
 assert.equal(automaticProductionYear(offer),undefined);
 assert.equal(automaticProductionYear({...offer,year:2020,operational:{semanticEvidence:{productionDate:{status:'exact',source:'kcar_registry_production_date',value:'2020-09-22'}}}}),2020);
 assert.equal(automaticProductionYear({sourceId:'other',year:2020}),2020);
});
