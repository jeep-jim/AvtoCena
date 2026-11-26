import test from 'node:test';
import assert from 'node:assert/strict';
import {japanReleaseBinding,verifyJapanPage,verifyJapanWarmPage,verifyJapanPowerPage,japanVerificationRequestScope,installReadFence,japanResponseObservation,
 japanCalculationReadGrant,checkedJapanCalculationRead,verifyJapanDeliveredCalculation,japanPetrolPowerUrl}
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

test('a rejected partial response preserves typed flags and counts without disclosing rows or upstream details',()=>{
 const value={...page(),partial:true,interrupted:true,scanLimited:true,received:24,
  supplierUrl:'https://private.example/?token=secret',visitorIp:'private',error:{raw:'private failure'}};
 const observed=japanResponseObservation(value,200);
 assert.deepEqual(observed,{status:200,ok:true,shown:3,received:24,observedAt:value.observedAt,
  stale:false,partial:true,interrupted:true,scanLimited:true,hasMore:true,total:null});
 assert.throws(()=>verifyJapanPage(value,200,now),/japan_browser_unavailable_or_stale/);
 assert.equal(JSON.stringify(observed).includes('private'),false);
 assert.equal(JSON.stringify(observed).includes('ajes-stats-'),false);
});

test('missing or wrongly typed response metadata is recorded as unknown, never a fabricated false or zero',()=>{
 const empty={status:null,ok:null,shown:null,received:null,observedAt:null,
  stale:null,partial:null,interrupted:null,scanLimited:null,hasMore:null,total:null};
 assert.deepEqual(japanResponseObservation(null,undefined),empty);
 assert.deepEqual(japanResponseObservation({ok:'true',items:{},received:'24',observedAt:'invalid',
  stale:'false',partial:0,interrupted:'false',scanLimited:1,hasMore:'true',total:-1},'200'),empty);
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

test('an exhausted second page cannot turn its own row count into a complete filtered total',()=>{
 const value={...page(),hasMore:false,total:null,countSummary:{total:600000,upperBound:true}};
 assert.equal(verifyJapanPowerPage(value,2).countHonest,true);
 for(const changed of [{total:3},{countSummary:{total:3,upperBound:false}}])
  assert.throws(()=>verifyJapanPowerPage({...value,...changed},2),/japan_browser_false_exact_count/);
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

async function fencedRequest({url,method='GET',resourceType='image',status=200,grant,body,headers,frameUrl,responseData={}}){
 let handler;
 const report={productionMutations:0,directSupplierApiRequests:0};
 await installReadFence({route:async(pattern,callback)=>{assert.equal(pattern,'**/*');handler=callback;}},report,
  grant?{getCalculationGrant:()=>grant}:{});
 const calls={fetch:0,fulfill:0,dispose:0,aborts:[],options:undefined};
 const response={status:()=>status,body:async()=>Buffer.from(JSON.stringify(responseData)),dispose:async()=>{calls.dispose++;}};
 await handler({request:()=>({url:()=>url,method:()=>method,resourceType:()=>resourceType,postData:()=>body,
   headers:()=>headers,frame:()=>({url:()=>frameUrl})}),
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

const calculationRow=()=>({...copy(supplier),japanSupplierPower:{...copy(supplier.japanSupplierPower),combustionPreviewEligible:true},
 fuel:'petrol',year:2019,engineCc:660,sourcePrice:170000,sourceCurrency:'JPY'});
const calculationDraft=()=>({vehicleCategory:'',grossVehicleWeightKg:'',n1IceFuel:'',year:'2019',productionMonth:'',productionDay:'',
 transportToBorderRub:'',engineCc:'660',fuel:'petrol',powerHp:'160',powerKw:'117.6798',hybridKind:'',power30MinKw:'',icePowerKw:'',deliveryCity:'Новокузнецк'});
function calculationRequest(grant=japanCalculationReadGrant(calculationRow())){
 return {url:'https://avtocena.com/api/catalog/offer/'+grant.offerId+'/calculate',method:'POST',resourceType:'fetch',
  frameUrl:grant.detailUrl,headers:{origin:'https://avtocena.com','content-type':'application/json'},body:JSON.stringify(calculationDraft()),grant};
}
const calculationResult=()=>({requiresConfirmation:true,customs:{status:'ready'},totalRub:732137,
 currencyRate:{currency:'JPY',sourcePrice:170000,sourcePriceRub:82137},
 deliveryQuote:{city:'Новокузнецк',status:'estimated',amountRub:120000},
 breakdown:[{id:'car',amountRub:82137},{id:'delivery',amountRub:120000},{id:'fees',amountRub:530000}]});

test('the city and filter proof accepts both canonical Japan routes and preserves its actual page',()=>{
 const query=new URLSearchParams({fuel:'petrol',powerTo:'160',city:'Новокузнецк'});
 for(const base of ['/cars/japan?','/cars?market=japan&']){
  assert.equal(japanPetrolPowerUrl(base+query),true);
  assert.equal(japanPetrolPowerUrl(base+query+'&page=2',2),true);
  assert.equal(japanPetrolPowerUrl(base+query+'&page=2'),false);
 }
 for(const [field,value] of [['city','Москва'],['fuel','hybrid'],['powerTo','200']]){
  const bad=new URLSearchParams(query);bad.set(field,value);assert.equal(japanPetrolPowerUrl('/cars/japan?'+bad),false);
 }
 assert.equal(japanPetrolPowerUrl('/cars?market=china&'+query),false);
 assert.equal(japanPetrolPowerUrl('https://other.example/cars/japan?'+query),false);
});

test('the ephemeral calculation grant binds exact offer, scalar PW, year, volume and observed detail link',()=>{
 const row=calculationRow(),grant=japanCalculationReadGrant(row);
 assert.equal(grant.year,2019);assert.equal(grant.engineCc,660);assert.equal(grant.powerHp,160);
 assert.ok(checkedJapanCalculationRead(calculationRequest(grant),grant));
 const slug='https://avtocena.com/cars/offer/'+row.id+'/suzuki-alto-2019';
 const linked=japanCalculationReadGrant(row,'Новокузнецк',slug);
 assert.ok(checkedJapanCalculationRead(calculationRequest(linked),linked));
 for(const changed of [{market:'china'},{fuel:'hybrid'},{powerHp:150},{powerKw:110},{japanPowerUnknown:true},{year:0},{engineCc:0},
  {sourcePrice:null},{sourceCurrency:'USD'},{japanSupplierPower:{...row.japanSupplierPower,offerId:'ajes-stats-other'}},
  {japanSupplierPower:{...row.japanSupplierPower,combustionPreviewEligible:undefined}}])
  assert.throws(()=>japanCalculationReadGrant({...row,...changed}),/japan_browser_calculation_binding/);
 for(const href of ['https://other.example/cars/offer/'+row.id,slug+'?city=Москва',
  'https://avtocena.com/cars/offer/'+row.id+'other',slug+'#anything'])
  assert.throws(()=>japanCalculationReadGrant(row,'Новокузнецк',href),/japan_browser_calculation_detail_binding/);
});

test('all save/admin calls, other frames, other parameters, malformed JSON and excessive bodies stay blocked',()=>{
 const grant=japanCalculationReadGrant(calculationRow()),valid=calculationRequest(grant);
 const changes=[{method:'PUT'},{method:'GET'},{resourceType:'document'},
  {url:valid.url.replace('/calculate','/save')},{url:valid.url.replace('source2','other')},
  {url:valid.url+'?write=1'},{url:'https://avtocena.com/api/admin/save'},
  {frameUrl:'https://other.example/cars/offer/'+grant.offerId},
  {frameUrl:grant.detailUrl+'other'},{frameUrl:grant.detailUrl+'?city=Москва'},
  {headers:{origin:'https://other.example','content-type':'application/json'}},
  {headers:{origin:'https://avtocena.com','content-type':'text/plain'}},
  {body:'null'},{body:'[]'},{body:'{'},{body:'x'.repeat(4097)}];
 for(const value of changes)assert.equal(checkedJapanCalculationRead({...valid,...value},grant),null,JSON.stringify(value));
 for(const delta of [{powerHp:'159'},{year:'2018'},{engineCc:'1500'},{fuel:'hybrid'},{deliveryCity:'Москва'},
  {powerKw:'NaN'},{powerKw:'117'},{powerHp:160},{vehicleCategory:'N1'},{grossVehicleWeightKg:'1500'},
  {transportToBorderRub:'1'},{power30MinKw:'20'},{icePowerKw:'100'},{customsCalculationDate:'2026-01-01'},
  {productionMonth:'13'},{productionDay:'31'},{save:'1'}])
  assert.equal(checkedJapanCalculationRead({...valid,body:JSON.stringify({...calculationDraft(),...delta})},grant),null,JSON.stringify(delta));
 assert.equal(checkedJapanCalculationRead(valid,null),null);
});

test('the installed fence counts only its bounded read-only calculations and never forwards a third request or different body',async()=>{
 const grant=japanCalculationReadGrant(calculationRow()),request=calculationRequest(grant),value=calculationResult();
 const first=await fencedRequest({...request,responseData:value});
 assert.equal(first.calls.fetch,1);assert.equal(first.calls.fulfill,1);assert.equal(first.calls.dispose,1);
 assert.equal(first.report.japanPreviewCalculationRequests,1);assert.equal(first.report.productionMutations,0);
 assert.equal(first.report.directSupplierApiRequests,0);assert.equal(first.report.supplierImageRequests,0);
 assert.deepEqual(first.calls.options,{maxRedirects:0,timeout:90000});assert.equal(grant.requests,1);
 assert.deepEqual(grant.response,{status:200,data:value});
 const changed=await fencedRequest({...request,body:JSON.stringify({...calculationDraft(),productionMonth:'1'})});
 assert.equal(changed.calls.fetch,0);assert.equal(changed.report.blockedRequests.mutation,1);assert.equal(grant.requests,1);
 const second=await fencedRequest({...request,responseData:value});assert.equal(second.calls.fetch,1);assert.equal(grant.requests,2);
 const third=await fencedRequest({...request,responseData:value});assert.equal(third.calls.fetch,0);
 assert.equal(third.report.blockedRequests.mutation,1);assert.equal(grant.requests,2);
 const noGrant=await fencedRequest({...request,grant:undefined});assert.equal(noGrant.calls.fetch,0);
 const save=await fencedRequest({...calculationRequest(japanCalculationReadGrant(calculationRow())),url:request.url.replace('/calculate','/save')});
 assert.equal(save.calls.fetch,0);assert.equal(save.report.blockedRequests.mutation,1);
});

test('an allowed calculation never follows redirects into save or another service',async()=>{
 const grant=japanCalculationReadGrant(calculationRow());
 const result=await fencedRequest({...calculationRequest(grant),status:307});
 assert.equal(result.calls.fetch,1);assert.equal(result.calls.options.maxRedirects,0);assert.equal(result.calls.fulfill,0);
 assert.equal(result.report.blockedRequests.redirect,1);assert.equal(grant.response,null);
});

test('a real delivered result requires the same invoice, complete customs, selected city and a balanced ledger',()=>{
 const grant=japanCalculationReadGrant(calculationRow()),value=calculationResult();
 const result=verifyJapanDeliveredCalculation(value,200,grant);
 assert.equal(result.totalRub,732137);assert.equal(result.carRub,82137);assert.equal(result.city,'Новокузнецк');
 for(const mutate of [v=>v.requiresConfirmation=false,v=>v.customs.status='needs_data',v=>v.totalRub=82137,
  v=>v.deliveryQuote.city='Москва',v=>v.deliveryQuote.amountRub=0,v=>v.deliveryQuote.status='needs_quote',
  v=>v.currencyRate.sourcePrice=1,v=>v.currencyRate.currency='USD',v=>v.currencyRate.sourcePriceRub=100000,
  v=>v.breakdown[2].amountRub+=1,v=>v.breakdown[2].amountRub='530000',v=>v.breakdown=null]){
  const changed=copy(value);mutate(changed);assert.throws(()=>verifyJapanDeliveredCalculation(changed,200,grant));
 }
 assert.throws(()=>verifyJapanDeliveredCalculation(value,400,grant),/japan_browser_calculation_response/);
});
