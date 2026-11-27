import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import {checkedJapanPaginationCursor,japanPaginationPageApi,verifyJapanPaginationPair,japanPetrolPowerPageApi,
 japanPowerOrderRequirement,runJapanBrowserAcceptance}
  from '../scripts/catalog-next/japan-browser-acceptance.mjs';

const q='a'.repeat(64),m='b'.repeat(64),now=Date.parse('2026-11-27T02:00:00.000Z');
const token=(source=2,skip=4,page=2)=>'j1.'+source+'.'+skip+'.'+page+'.'+q+'.'+(skip?m:'-');
const url=(after=token(),kind='petrol_power')=>{
 const query=new URLSearchParams({city:'Новокузнецк',page:'2',after});
 if(kind!=='plain')query.set('powerTo','160');if(kind==='petrol_power')query.set('fuel','petrol');
 return 'https://avtocena.com/cars/japan?'+query;
};
function payload(page,{count=24,more=true}={}){
 const items=Array.from({length:count},(_,i)=>({id:'ajes-stats-v'+((page-1)*24+i),market:'japan',fuel:'petrol',powerHp:100}));
 return {ok:true,page,pageSize:24,items,received:24,stale:false,partial:false,interrupted:false,scanLimited:false,
  observedAt:new Date(now-1000).toISOString(),hasMore:more,nextCursor:more?token(page+1,4,page+1):null,
  total:null,countSummary:null,powerFilterSummary:{shown:count,localPower:count,supplierPower:0,unknownPower:0}};
}
const options=(extra={})=>({observedUrl:url(),kind:'petrol_power',firstStatus:200,nextStatus:200,now,...extra});
const epoch='c'.repeat(64);
const powerToken=({phase='k',source=2,skip=4,page=2,query=q,evidence=epoch,membership=skip?m:'-'}={})=>
 'j2.'+phase+'.'+source+'.'+skip+'.'+page+'.'+query+'.'+evidence+'.'+membership;
function powerPayload(page,{unknown=0,supplier=0,nextCursor=powerToken({source:page+1,page:page+1}),...rest}={}){
 const value=payload(page,rest);
 value.nextCursor=value.hasMore?nextCursor:null;
 value.items=value.items.map((row,index)=>{
  if(index>=value.items.length-unknown){const {powerHp,...other}=row;return {...other,japanPowerUnknown:true};}
  if(index<supplier){const {powerHp,...other}=row;return {...other,japanSupplierPower:{offerId:row.id,hp:150,unit:'hp',source:'ajes_pw'}};}
  return row;
 });
 value.powerFilterSummary={shown:value.items.length,localPower:value.items.length-unknown-supplier,supplierPower:supplier,unknownPower:unknown};
 return value;
}
const powerOptions=(extra={})=>options({observedUrl:url(powerToken()),requirePowerOrder:true,...extra});

test('new j1 grammar is bounded and binds the visible page and membership presence',()=>{
 const value=checkedJapanPaginationCursor(token(),2);
 assert.equal(value.sourcePage,2);assert.equal(value.acceptedSkip,4);assert.equal(value.visiblePage,2);
 assert.match(value.cursorSha256,/^[a-f0-9]{64}$/);assert(!JSON.stringify(value).includes(token()));
 assert.equal(checkedJapanPaginationCursor(token(3,0),2).acceptedSkip,0);
 for(const bad of ['2.4','jp1.'+'a'.repeat(32)+'.2.'+'b'.repeat(16),
  token(1_000_001),token(2,24),token(2,4,3),token(2,0).replace(/\.-$/,'.'+m),token().replace(m,'-'),
  token()+'.extra',token().replace(q,'A'.repeat(64))])
  assert.throws(()=>checkedJapanPaginationCursor(bad,2));
});

test('page2 application API is constructed only from the actual bounded ordinary UI query and token',()=>{
 const result=japanPaginationPageApi(url(),{kind:'petrol_power',expectedCursor:token()});
 const parsed=new URL(result,'https://avtocena.com');
 assert.equal(parsed.pathname,'/api/catalog/search');
 assert.deepEqual(Object.fromEntries(parsed.searchParams),{market:'japan',page:'2',pageSize:'24',city:'Новокузнецк',powerTo:'160',fuel:'petrol',after:token()});
 assert(japanPaginationPageApi(url(token(),'plain'),{kind:'plain'}).includes('after='));
 assert(japanPaginationPageApi(url(token(),'power'),{kind:'power'}).includes('powerTo=160'));
 assert.equal(japanPaginationPageApi(url().replace('/cars/japan?','/cars?market=japan&'),{kind:'petrol_power'}),result);
 for(const bad of [url().replace('https://avtocena.com','https://other.invalid'),
  url()+'&city=Москва',url()+'&refresh=1',url()+'&pageSize=48',url()+'#fragment',
  url().replace('powerTo=160','powerTo=170'),url().replace('fuel=petrol','fuel=diesel')])
  assert.throws(()=>japanPaginationPageApi(bad,{kind:'petrol_power'}));
 assert.throws(()=>japanPaginationPageApi(url(),{kind:'petrol_power',expectedCursor:token(3,4)}));
 // A new helper cannot silently weaken the old rejected-runtime cursor contract.
 assert.throws(()=>japanPetrolPowerPageApi(url()));
});

test('fresh full page1 and its observed page2 prove bounded continuity without claiming a global total',()=>{
 const result=verifyJapanPaginationPair(payload(1),payload(2),options());
 assert.equal(result.followedEmittedCursor,true);assert.equal(result.distinctRows,true);
 assert.equal(result.first.shown,24);assert.equal(result.next.shown,24);
 assert.equal(result.first.total,null);assert.equal(result.next.total,null);
 assert(!JSON.stringify(result).includes('ajes-stats-v'));
 const final=verifyJapanPaginationPair(payload(1),payload(2,{count:7,more:false}),options());
 assert.equal(final.next.shown,7);assert.equal(final.next.hasMore,false);
});

test('new page-fill proof retains stale, partial, expiry and short-page rejection',()=>{
 for(const patch of [{stale:true},{partial:true},{interrupted:true},{scanLimited:true},
  {observedAt:new Date(now-30*60_000-1).toISOString()}])
  assert.throws(()=>verifyJapanPaginationPair(payload(1),{...payload(2),...patch},options()));
 assert.throws(()=>verifyJapanPaginationPair(payload(1),payload(2,{count:23}),options()));
 assert.throws(()=>verifyJapanPaginationPair(payload(1,{count:23}),payload(2),options()));
 assert.throws(()=>verifyJapanPaginationPair(payload(1),payload(2),options({nextStatus:500})));
});

test('changed tokens, duplicate rows, wrong visible page, false exact total and lost city fail closed',()=>{
 const next=payload(2);next.items[0]={...payload(1).items[0]};
 assert.throws(()=>verifyJapanPaginationPair(payload(1),next,options()));
 assert.throws(()=>verifyJapanPaginationPair(payload(1),payload(2),options({observedUrl:url(token(3,4))})));
 assert.throws(()=>verifyJapanPaginationPair(payload(1),{...payload(2),page:3},options()));
 assert.throws(()=>verifyJapanPaginationPair({...payload(1),total:600000},payload(2),options()));
 assert.throws(()=>verifyJapanPaginationPair({...payload(1),total:600000},payload(2),options({kind:'plain',observedUrl:url(token(),'plain')})));
 assert.throws(()=>verifyJapanPaginationPair(payload(1),payload(2),options({observedUrl:url()+'&city=Москва'})));
 assert.throws(()=>verifyJapanPaginationPair(payload(1),{...payload(2),nextCursor:token(3,4,2)},options()));
});

test('power-order j2 grammar binds phase, query, epoch, visible page and membership with exact bounds',()=>{
 const value=checkedJapanPaginationCursor(powerToken(),2,{requirePowerOrder:true});
 assert.deepEqual(value,{phase:'k',sourcePage:2,acceptedSkip:4,visiblePage:2,queryHash:q,epochHash:epoch,membershipHash:m,cursorSha256:value.cursorSha256});
 assert.match(value.cursorSha256,/^[a-f0-9]{64}$/);
 assert.equal(checkedJapanPaginationCursor(powerToken({phase:'u',source:1_000_000,skip:24}),2,{requirePowerOrder:true}).acceptedSkip,24);
 assert.equal(checkedJapanPaginationCursor(powerToken({skip:0}),2,{requirePowerOrder:true}).membershipHash,'-');
 for(const bad of [token(),powerToken({phase:'x'}),powerToken({source:0}),powerToken({source:1_000_001}),
  powerToken({skip:25}),powerToken({skip:'04'}),powerToken({page:3}),powerToken({skip:0,membership:m}),
  powerToken({membership:'-'}),powerToken({query:'A'.repeat(64)}),powerToken({evidence:'bad'}),powerToken()+'.extra','j2.'+'x'.repeat(320)])
  assert.throws(()=>checkedJapanPaginationCursor(bad,2,{requirePowerOrder:true}),/pagination_cursor/);
 for(const bad of [null,0,1,'false','true'])assert.throws(()=>checkedJapanPaginationCursor(powerToken(),2,{requirePowerOrder:bad}),/power_order_option/);
});

test('the reviewed power profile requires j2 only for power queries and retains plain/legacy j1 exactly',()=>{
 for(const kind of ['power','petrol_power']){
  const parsed=new URL(japanPaginationPageApi(url(powerToken(),kind),{kind,requirePowerOrder:true,expectedCursor:powerToken()}),'https://avtocena.com');
  assert.equal(parsed.searchParams.get('after'),powerToken());assert.equal(parsed.searchParams.get('powerTo'),'160');
  assert.equal(parsed.searchParams.get('fuel'),kind==='petrol_power'?'petrol':null);
  assert.throws(()=>japanPaginationPageApi(url(token(),kind),{kind,requirePowerOrder:true}),/pagination_cursor/);
  assert.throws(()=>japanPaginationPageApi(url(powerToken(),kind),{kind}),/pagination_cursor/);
  assert.throws(()=>japanPaginationPageApi(url(powerToken(),kind),{kind,requirePowerOrder:true,expectedCursor:powerToken({source:3})}),/pagination_emitted_cursor/);
 }
 assert.equal(japanPaginationPageApi(url(token(),'plain'),{kind:'plain',requirePowerOrder:true}),japanPaginationPageApi(url(token(),'plain'),{kind:'plain'}));
 assert.throws(()=>japanPaginationPageApi(url(powerToken(),'plain'),{kind:'plain',requirePowerOrder:true}),/pagination_cursor/);
 assert.throws(()=>japanPaginationPageApi(url(powerToken()),{kind:'petrol_power',requirePowerOrder:'1'}),/power_order_option/);
 assert.throws(()=>japanPetrolPowerPageApi(url(powerToken())),/continuation_cursor/);
 const plain=verifyJapanPaginationPair(payload(1),payload(2),options({kind:'plain',observedUrl:url(token(),'plain'),requirePowerOrder:true}));
 assert.equal(Object.hasOwn(plain,'powerOrder'),false);
 const old=verifyJapanPaginationPair(payload(1),payload(2),options());assert.equal(Object.hasOwn(old,'powerOrder'),false);
});

test('two actual power pages establish sampled K then U order and keep cursor/evidence fields private',()=>{
 const first=powerPayload(1,{supplier:4});
 const next=powerPayload(2,{unknown:8,supplier:3,nextCursor:powerToken({phase:'u',source:1,skip:8,page:3})});
 for(const kind of ['power','petrol_power']){
  const result=verifyJapanPaginationPair(first,next,powerOptions({kind,observedUrl:url(first.nextCursor,kind)}));
  assert.deepEqual(result.powerOrder,{pages:2,known:40,unknown:8,knownBeforeUnknown:true,distinctRows:true,cursorVersion:'j2'});
  assert.equal(result.followedEmittedCursor,true);assert.equal(result.visiblePages,2);
  assert.equal(result.first.total,null);assert.equal(result.next.total,null);
  assert.doesNotMatch(JSON.stringify(result),new RegExp('ajes-stats-|j2\\.|'+q+'|'+epoch+'|'+m));
 }
 const known=verifyJapanPaginationPair(powerPayload(1),powerPayload(2),powerOptions());
 assert.equal(known.powerOrder.known,48);assert.equal(known.powerOrder.unknown,0);
 const boundary=powerPayload(1,{nextCursor:powerToken({phase:'u',source:1,skip:0})});
 const remaining=powerPayload(2,{unknown:24,nextCursor:powerToken({phase:'u',source:2,skip:0,page:3})});
 assert.equal(verifyJapanPaginationPair(boundary,remaining,powerOptions({observedUrl:url(boundary.nextCursor)})).powerOrder.unknown,24);
 const final=powerPayload(2,{count:7,unknown:7,more:false});
 assert.equal(verifyJapanPaginationPair(boundary,final,powerOptions({observedUrl:url(boundary.nextCursor)})).next.hasMore,false);
});

test('j2 refuses changed query/epoch/membership and a cursor that repeats, regresses or returns U to K',()=>{
 const first=powerPayload(1);
 for(const nextCursor of [powerToken({source:3,page:3,query:'d'.repeat(64)}),
  powerToken({source:3,page:3,evidence:'d'.repeat(64)}),powerToken({source:2,skip:4,page:3}),
  powerToken({source:1,skip:5,page:3}),powerToken({source:2,skip:3,page:3}),
  powerToken({source:2,skip:5,page:3,membership:'d'.repeat(64)}),token(3,4,3)])
  assert.throws(()=>verifyJapanPaginationPair(first,powerPayload(2,{nextCursor}),powerOptions()),/power_cursor_|pagination_cursor/);
 const boundary=powerPayload(1,{unknown:8,nextCursor:powerToken({phase:'u',source:1,skip:8})});
 assert.throws(()=>verifyJapanPaginationPair(boundary,powerPayload(2,{unknown:24,nextCursor:powerToken({source:3,page:3})}),
  powerOptions({observedUrl:url(boundary.nextCursor)})),/power_cursor_phase/);
 assert.throws(()=>verifyJapanPaginationPair(first,powerPayload(2),powerOptions({observedUrl:url(powerToken({query:'d'.repeat(64)}))})),/pagination_emitted_cursor/);
});

test('j2 refuses known after unknown inside or across pages and cursor phases inconsistent with visible rows',()=>{
 const boundary=powerPayload(1,{unknown:1,nextCursor:powerToken({phase:'u',source:1,skip:1})});
 assert.throws(()=>verifyJapanPaginationPair(boundary,powerPayload(2),powerOptions({observedUrl:url(boundary.nextCursor)})),/known_after_unknown/);
 const mixed=powerPayload(2,{unknown:1,nextCursor:powerToken({phase:'u',source:1,skip:1,page:3})});
 [mixed.items[0],mixed.items[23]]=[mixed.items[23],mixed.items[0]];
 assert.throws(()=>verifyJapanPaginationPair(powerPayload(1),mixed,powerOptions()),/known_after_unknown/);
 const impossible=powerPayload(1,{unknown:1});
 assert.throws(()=>verifyJapanPaginationPair(impossible,powerPayload(2,{unknown:24,nextCursor:powerToken({phase:'u',source:2,skip:0,page:3})}),powerOptions()),/power_cursor_phase/);
 assert.throws(()=>verifyJapanPaginationPair(powerPayload(1),powerPayload(2,{unknown:1}),powerOptions()),/power_cursor_phase/);
 const premature=powerPayload(1,{nextCursor:powerToken({phase:'u',source:2,skip:0})});
 assert.throws(()=>verifyJapanPaginationPair(premature,powerPayload(2,{unknown:24,nextCursor:powerToken({phase:'u',source:3,skip:0,page:3})}),
  powerOptions({observedUrl:url(premature.nextCursor)})),/power_cursor_phase/);
});

test('the power proof keeps existing full/fresh/fuel/city/count and public power provenance requirements',()=>{
 for(const patch of [{stale:true},{partial:true},{interrupted:true},{scanLimited:true},{total:600000},
  {observedAt:new Date(now-30*60_000-1).toISOString()},{nextCursor:null}])
  assert.throws(()=>verifyJapanPaginationPair(powerPayload(1),{...powerPayload(2),...patch},powerOptions()));
 assert.throws(()=>verifyJapanPaginationPair(powerPayload(1),powerPayload(2,{count:23}),powerOptions()),/short_page_with_more/);
 const diesel=powerPayload(2);diesel.items[0].fuel='diesel';
 assert.throws(()=>verifyJapanPaginationPair(powerPayload(1),diesel,powerOptions()),/pagination_fuel/);
 const falseKnown=powerPayload(2);falseKnown.items[0].powerHp=161;
 assert.throws(()=>verifyJapanPaginationPair(powerPayload(1),falseKnown,powerOptions()),/local_power/);
 assert.throws(()=>verifyJapanPaginationPair(powerPayload(1),powerPayload(2),powerOptions({observedUrl:url(powerToken())+'&city=Москва'})),/pagination_query/);
});

test('power requirement environment is exact and a new requirement cannot be enabled in an old scope',async t=>{
 assert.equal(japanPowerOrderRequirement(undefined),false);assert.equal(japanPowerOrderRequirement('0'),false);assert.equal(japanPowerOrderRequirement('1'),true);
 for(const value of ['',true,false,0,1,null,'true','false','01',' 1','1\n'])assert.throws(()=>japanPowerOrderRequirement(value),/power_order_option/);
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'japan-power-gate-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
 for(const [index,requirePowerOrder] of [true,'1',1,null].entries()){
  const outputFile=path.join(directory,'bad-'+index+'.json');
  const report=await runJapanBrowserAcceptance({oraclePath:path.join(directory,'not-read.json'),releaseSha:'a'.repeat(40),nonce:'b'.repeat(32),
   outputFile,requirePowerOrder,codeScope:index===0?'catalog-japan-pagination24-v1':'catalog-japan-stability-v1'});
  assert.equal(report.passed,false);assert.deepEqual(report.error,{stage:'preconditions',code:'japan_browser_power_order_option',timeout:false});
  assert.equal(report.explicitJapanApiRequests,0);
  assert.notEqual(report.japanPowerOrderPassed,true);
 }
 const outputFile=path.join(directory,'cli.json');
 const rejected=spawnSync(process.execPath,['scripts/catalog-next/japan-browser-acceptance.mjs'],{cwd:new URL('../',import.meta.url),
  env:{PATH:process.env.PATH,OUTPUT:outputFile,CATALOG_JAPAN_POWER_ORDER_REQUIRED:'true'},encoding:'utf8',timeout:10_000,maxBuffer:16*1024});
 assert.equal(rejected.status,1);assert.equal(rejected.stderr.trim(),'japan_browser_report_failed');
 await assert.rejects(()=>fs.access(outputFile),{code:'ENOENT'});
});
