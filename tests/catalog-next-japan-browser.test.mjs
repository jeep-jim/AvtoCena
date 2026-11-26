import test from 'node:test';
import assert from 'node:assert/strict';
import {japanReleaseBinding,verifyJapanPage,verifyJapanWarmPage,verifyJapanPowerPage,japanVerificationRequestScope}
 from '../scripts/catalog-next/japan-browser-acceptance.mjs';

const now=Date.parse('2026-11-26T05:00:00Z'),release='a'.repeat(40),nonce='b'.repeat(32),manifest='c'.repeat(64);
const local={id:'ajes-stats-local1',market:'japan',powerHp:150};
const supplier={id:'ajes-stats-source2',market:'japan',japanSupplierPower:{offerId:'ajes-stats-source2',hp:160,unit:'hp',source:'ajes_pw'}};
const unknown={id:'ajes-stats-unknown3',market:'japan',japanPowerUnknown:true};
const copy=value=>structuredClone(value);
function page(){return {ok:true,stale:false,observedAt:new Date(now-1000).toISOString(),items:copy([local,supplier,unknown]),received:3,
 hasMore:true,total:null,countSummary:{total:600000,upperBound:true},powerFilterSummary:{shown:3,localPower:1,supplierPower:1,unknownPower:1}};}

test('Japan verification is bound to the new source, nonce and existing China generation',()=>{
 const oracle={version:1,runtimeSha:release,expectedGeneration:'gen_china_45655051136_1',generationManifestSha256:manifest};
 assert.deepEqual(japanReleaseBinding(oracle,release,nonce),{generationId:oracle.expectedGeneration,generationManifestSha256:manifest});
 for(const bad of [{...oracle,runtimeSha:'d'.repeat(40)},{...oracle,expectedGeneration:'latest'},{...oracle,generationManifestSha256:'bad'}])
  assert.throws(()=>japanReleaseBinding(bad,release,nonce),/japan_browser_oracle_binding/);
 assert.throws(()=>japanReleaseBinding(oracle,release,'anything'),/japan_browser_arguments/);
});

test('fresh nonempty rows and the actual source date are required; HTTP200 is insufficient',()=>{
 assert.equal(verifyJapanPage(page(),200,now).shown,3);
 for(const changed of [{stale:true},{partial:true},{scanLimited:true},{interrupted:true},{items:[]},
  {observedAt:new Date(now-1800000).toISOString()},{observedAt:new Date(now+60001).toISOString()},
  {items:[local,local]},{items:[{...local,market:'china'}]},{ok:false}])
  assert.throws(()=>verifyJapanPage({...page(),...changed},200,now),/japan_browser_/);
 assert.throws(()=>verifyJapanPage(page(),503,now),/japan_browser_http/);
});

test('warm proof does not manufacture a new observation or silently change rows',()=>{
 const a=page();assert.deepEqual(verifyJapanWarmPage(a,copy(a)),{sameObservation:true,sameRows:true});
 assert.throws(()=>verifyJapanWarmPage(a,{...copy(a),observedAt:new Date(now).toISOString()}),/warm_changed/);
 assert.throws(()=>verifyJapanWarmPage(a,{...copy(a),items:[unknown]}),/warm_changed/);
});

test('integer supplier hp, local precedence and unknown labels preserve honest filtering',()=>{
 assert.deepEqual(verifyJapanPowerPage(page()),{shown:3,localPower:1,supplierPower:1,unknownPower:1,unknownRetainedAndLabelled:true,countHonest:true});
 for(const change of [row=>row.items[0].powerHp=161,row=>row.items[0].japanPowerUnknown=true,
  row=>row.items[0].japanSupplierPower=supplier.japanSupplierPower,
  row=>row.items[1].japanSupplierPower.hp=161,row=>row.items[1].japanSupplierPower.hp=159.5,
  row=>row.items[1].japanSupplierPower.hp='160',row=>row.items[1].japanSupplierPower.unit='kW',
  row=>row.items[1].japanSupplierPower.source='ajes_pw_first',row=>row.items[1].japanSupplierPower.offerId=unknown.id,
  row=>delete row.items[2].japanPowerUnknown,row=>row.powerFilterSummary.unknownPower=0,
  row=>row.total=600000,row=>row.countSummary.upperBound=false]){
  const value=page();change(value);assert.throws(()=>verifyJapanPowerPage(value),/japan_browser_/);
 }
});

test('only exhausted first-page local results may carry their exact count',()=>{
 const value={...page(),hasMore:false,total:3,countSummary:{total:3,upperBound:false}};
 assert.equal(verifyJapanPowerPage(value).countHonest,true);
 for(const changed of [{total:null},{total:600000},{countSummary:{total:600000,upperBound:false}},{countSummary:{upperBound:false}},{countSummary:{total:3,upperBound:true}}])
  assert.throws(()=>verifyJapanPowerPage({...value,...changed}),/japan_browser_exhausted_count/);
});

test('actual unknown-only or local-only samples do not require invented supplier evidence',()=>{
 for(const [item,key] of [[unknown,'unknownPower'],[local,'localPower'],[supplier,'supplierPower']]){
  const value=page();value.items=[copy(item)];value.powerFilterSummary={shown:1,localPower:0,supplierPower:0,unknownPower:0};value.powerFilterSummary[key]=1;
  assert.equal(verifyJapanPowerPage(value)[key],1);
 }
});

test('browser verification cannot send mutations, visit private paths or call suppliers directly',()=>{
 assert.equal(japanVerificationRequestScope('https://avtocena.com/cars/japan?powerTo=160','GET'),'allowed');
 assert.equal(japanVerificationRequestScope('https://avtocena.com/api/catalog/search?market=japan','GET'),'allowed');
 for(const method of ['POST','PUT','PATCH','DELETE'])assert.equal(japanVerificationRequestScope('https://avtocena.com/api/leads',method),'mutation');
 for(const pathname of ['/crm/site','/api/crm/users','/api/admin/settings','/api/internal/read','/%61pi/admin/settings'])
  assert.equal(japanVerificationRequestScope('https://avtocena.com'+pathname,'GET'),'private');
 for(const url of ['https://ajes.com/api/','https://other.example/','https://secret@avtocena.com/','bad'])
  assert.equal(japanVerificationRequestScope(url,'GET'),'external');
});
