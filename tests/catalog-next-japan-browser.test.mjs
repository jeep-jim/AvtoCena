import test from 'node:test';
import assert from 'node:assert/strict';
import {japanReleaseBinding,verifyJapanPage,verifyJapanWarmPage,verifyJapanPowerPage,japanVerificationRequestScope,installReadFence}
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

test('only actual image resources may read the exact four AJ photo hosts and permitted rendition paths',()=>{
 for(const host of ['7.tru.ru','7.ajes.com','8.ajes.com','9.ajes.com']){
  for(const pathname of ['/img/Abc-123_4','/imgs/Abc-123_4&w=320','/img/Abc-123_4&h=50&w=320']){
   const url='https://'+host+pathname;
   for(const method of ['GET','HEAD'])assert.equal(japanVerificationRequestScope(url,method,'image'),'supplier_image');
   for(const resourceType of [undefined,'document','script','fetch','xhr'])
    assert.equal(japanVerificationRequestScope(url,'GET',resourceType),'external');
   assert.equal(japanVerificationRequestScope(url,'POST','image'),'mutation');
  }
 }
});

test('an image resource cannot disguise an AJ API, another host, credentials, port, query or fragment',()=>{
 for(const url of [
  'https://ajes.com/api/','https://7.ajes.com/api/','https://7.ajes.com/api/aj_bids.txt',
  'https://7.ajes.com/img/api/query','https://7.ajes.com/img/abc?sql=select',
  'https://7.ajes.com/img/abc?','https://7.ajes.com/img/abc#fragment',
  'https://7.ajes.com/img/abc#','https://7.ajes.com/img/abc%3Fw=320',
  'https://7.ajes.com/img/../api/','https://7.ajes.com/img/abc&sql=select',
  'https://7.ajes.com/img/abc&w=320&redirect=https://other.example/',
  'https://7.ajes.com:8443/img/abc','https://7.ajes.com:443/img/abc',
  'https://secret@7.ajes.com/img/abc','https://@7.ajes.com/img/abc',
  'https://7.ajes.com.evil.example/img/abc','https://6.ajes.com/img/abc','http://7.ajes.com/img/abc',
  'https://other.example/img/abc','https://7.ajes.com\\img\\abc',
 ])assert.equal(japanVerificationRequestScope(url,'GET','image'),'external',url);
});

async function fencedRequest({url,method='GET',resourceType='image',status=200}){
 let handler;
 const report={productionMutations:0,directSupplierApiRequests:0};
 await installReadFence({route:async(pattern,callback)=>{assert.equal(pattern,'**/*');handler=callback;}},report);
 const calls={fetch:0,fulfill:0,dispose:0,aborts:[],options:undefined};
 const response={status:()=>status,dispose:async()=>{calls.dispose++;}};
 await handler({request:()=>({url:()=>url,method:()=>method,resourceType:()=>resourceType}),
  fetch:async options=>{calls.fetch++;calls.options=options;return response;},
  fulfill:async input=>{assert.equal(input.response,response);calls.fulfill++;},
  abort:async code=>{calls.aborts.push(code);}});
 return {report,calls};
}

test('the installed fence forwards only allowed photo reads and counts supplier images separately from API requests',async()=>{
 const {report,calls}=await fencedRequest({url:'https://7.ajes.com/img/Abc_123&w=320'});
 assert.equal(report.readOnlyBrowserFence,true);assert.equal(report.supplierImageRequests,1);
 assert.equal(report.directSupplierApiRequests,0);assert.equal(report.productionMutations,0);
 assert.equal(calls.fetch,1);assert.equal(calls.fulfill,1);assert.equal(calls.dispose,1);
 assert.deepEqual(calls.options,{maxRedirects:0,timeout:90_000});assert.deepEqual(calls.aborts,[]);
 assert.deepEqual(report.blockedRequests,{mutation:0,external:0,private:0,redirect:0});
 const local=await fencedRequest({url:'https://avtocena.com/logo.svg'});
 assert.equal(local.calls.fetch,1);assert.equal(local.report.supplierImageRequests,0);
});

test('blocked requests never reach fetch or inflate the supplier image counter',async()=>{
 for(const input of [
  {url:'https://7.ajes.com/api/',scope:'external'},
  {url:'https://7.ajes.com/img/abc',resourceType:'document',scope:'external'},
  {url:'https://7.ajes.com/img/abc?redirect=1',scope:'external'},
  {url:'https://7.ajes.com/img/abc',method:'POST',scope:'mutation'},
  {url:'https://avtocena.com/api/admin/settings',scope:'private'},
 ]){
  const {report,calls}=await fencedRequest(input);
  assert.equal(calls.fetch,0);assert.equal(calls.fulfill,0);assert.equal(calls.dispose,0);
  assert.equal(report.supplierImageRequests,0);assert.equal(report.directSupplierApiRequests,0);
  assert.equal(report.blockedRequests[input.scope],1);assert.deepEqual(calls.aborts,['blockedbyclient']);
 }
});

test('a permitted supplier image cannot redirect into any API, foreign origin or private page',async()=>{
 for(const status of [301,302,303,307,308]){
  const {report,calls}=await fencedRequest({url:'https://7.ajes.com/img/abc',status});
  assert.equal(calls.fetch,1);assert.equal(calls.options.maxRedirects,0);assert.equal(calls.fulfill,0);
  assert.equal(calls.dispose,1);assert.deepEqual(calls.aborts,['blockedbyclient']);
  assert.equal(report.supplierImageRequests,1);assert.equal(report.blockedRequests.redirect,1);
  assert.equal(report.directSupplierApiRequests,0);
 }
});
