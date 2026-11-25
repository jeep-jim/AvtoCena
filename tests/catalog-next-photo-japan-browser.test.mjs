import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {photoJapanBinding,selectChinaRecoveryPhoto,japanObservation,verifyJapanFreshPage,
 verifyJapanWarmReuse,verifyJapanPowerPayload,runPhotoJapanBrowserAcceptance,runChinaPhotoBrowserAcceptance,
 photoOnlyRequestScope,getChinaPhotoJson,installPhotoOnlyRequestFence} from '../scripts/catalog-next/photo-japan-browser-acceptance.mjs';

const release='a'.repeat(40),nonce='b'.repeat(32),generation='gen_china_45369451603_1';
const oracle={version:1,runtimeSha:release,generationManifestSha256:'c'.repeat(64),expectedGeneration:generation};
const now=Date.parse('2026-11-25T15:00:00Z');
const unknown={id:'ajes-stats-unknown',market:'japan',japanPowerUnknown:true};
const preliminary={id:'ajes-stats-preliminary',market:'japan',japanPowerSearchHint:{offerId:'ajes-stats-preliminary',source:'ajes_pw_first',horsepower:115,requiresConfirmation:true}};
const known={id:'ajes-stats-known',market:'japan',powerHp:150};
const page={ok:true,stale:false,partial:false,interrupted:false,scanLimited:false,observedAt:new Date(now).toISOString(),
 items:[unknown,preliminary,known],total:null,countIncomplete:true,powerIncomplete:true,powerUnknownIncluded:true,powerUnknownCount:1,powerPreliminaryCount:1};

test('live gate binds the exact release, nonce and generation before constructing the screenshot query',()=>{
 const binding=photoJapanBinding(oracle,release,nonce);
 const url=new URL(binding.api,'https://avtocena.com');
 assert.equal(url.searchParams.get('preparedCut'),generation);assert.equal(url.searchParams.get('make'),'Hyundai');
 assert.equal(url.searchParams.get('model'),'Elantra');assert.equal(url.searchParams.get('city'),'Новокузнецк');
 assert.equal(url.searchParams.get('budgetFrom'),'1650000');assert.equal(url.searchParams.get('budgetTo'),'1750000');
 assert.equal(url.searchParams.get('yearFrom'),'2022');assert.equal(url.searchParams.get('yearTo'),'2023');
 assert.equal(url.searchParams.get('mileageTo'),'70000');assert.equal(url.searchParams.get('sort'),'totalRub');
 for(const changed of [{...oracle,runtimeSha:'d'.repeat(40)},{...oracle,generationManifestSha256:''},{...oracle,expectedGeneration:'../secret'}])
  assert.throws(()=>photoJapanBinding(changed,release,nonce),/oracle_binding/);
 assert.throws(()=>photoJapanBinding(oracle,release,'invalid'),/arguments/);
});

test('photo failure injection selects one exact signed rendition in the bound generation without freezing inventory count',()=>{
 const payload={ok:true,total:60,generationId:generation,items:Array.from({length:24},(_,index)=>({
  id:String(index+1).padStart(24,'0'),market:'china',preparedChinaSelection:{generationId:generation},
  cardImageUrl:'/api/catalog/photo/signed?url=https%3A%2F%2F2sc2.autoimg.cn%2Fescimg%2Fauto%2Ftest.jpg&market=china'}))};
 const selected=selectChinaRecoveryPhoto(payload,generation);
 const url=new URL(selected.url);assert.equal(url.searchParams.get('view'),'card');
 assert.equal(url.pathname,'/api/catalog/photo/signed');assert.equal(url.searchParams.get('url'),'https://2sc2.autoimg.cn/escimg/auto/test.jpg');
 assert.deepEqual([...url.searchParams.keys()],['url','market','view']);
 assert.equal(selectChinaRecoveryPhoto({...payload,total:59},generation).url,selected.url);
 assert.equal(selectChinaRecoveryPhoto({...payload,total:1,items:payload.items.slice(0,1)},generation).url,selected.url);
 assert.throws(()=>selectChinaRecoveryPhoto({...payload,total:0,items:[]},generation),/china_selection/);
 assert.throws(()=>selectChinaRecoveryPhoto({...payload,generationId:'other'},generation),/china_selection/);
 assert.throws(()=>selectChinaRecoveryPhoto({...payload,items:payload.items.map(row=>({...row,cardImageUrl:'https://source.invalid/image.jpg'}))},generation),/china_photo_sample/);
});

test('AJ freshness rejects stale, partial, failed, expired and malformed samples without treating missing counts as failure',()=>{
 assert.equal(verifyJapanFreshPage(page,200,now).sampled,3);
 for(const changed of [{...page,stale:true},{...page,stale:undefined},{...page,partial:true},{...page,interrupted:true},
  {...page,scanLimited:true},{...page,items:[]},{...page,items:[unknown,unknown]},
  {...page,observedAt:new Date(now-30*60_000).toISOString()},{...page,observedAt:new Date(now+60_001).toISOString()}])
  assert.throws(()=>verifyJapanFreshPage(changed,200,now),/photo_japan_browser_japan_/);
 assert.throws(()=>verifyJapanFreshPage(page,503,now),/japan_http/);
 const observation=japanObservation(page,200,now);assert.equal(observation.total,null);assert.equal(observation.countIncomplete,true);
 assert.equal(JSON.stringify(observation).includes('ajes-stats'),false);
});

test('AJ warm reuse compares the observation and identity without exposing rows in the report',()=>{
 assert.deepEqual(verifyJapanWarmReuse(page,structuredClone(page)),{sameObservation:true,sameRows:true});
 assert.throws(()=>verifyJapanWarmReuse(page,{...page,items:[known,unknown,preliminary]}),/japan_warm_changed/);
 assert.throws(()=>verifyJapanWarmReuse(page,{...page,observedAt:new Date(now+1).toISOString()}),/japan_warm_changed/);
});

test('power API gate requires separate preliminary/unknown fields and honest incomplete total',()=>{
 assert.deepEqual(verifyJapanPowerPayload(page),{sampled:3,confirmed:1,preliminary:1,unknown:1,unknownIncluded:true,countIncomplete:true});
 for(const changed of [{...page,total:3},{...page,countIncomplete:false},{...page,powerIncomplete:false},
  {...page,powerUnknownIncluded:false},{...page,powerUnknownCount:0},{...page,powerPreliminaryCount:0},
  {...page,items:[{...unknown,japanPowerUnknown:undefined},preliminary,known]},
  {...page,items:[unknown,{...preliminary,japanPowerSearchHint:{...preliminary.japanPowerSearchHint,offerId:'wrong'}},known]},
  {...page,items:[unknown,{...preliminary,japanPowerSearchHint:{...preliminary.japanPowerSearchHint,horsepower:161}},known]},
  {...page,items:[unknown,preliminary,{...known,powerHp:170}]}])assert.throws(()=>verifyJapanPowerPayload(changed),/photo_japan_browser_japan_/);
});

test('a binding failure produces a false report before browser import or any network access',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'photo-japan-gate-'));
 try{
  const oraclePath=path.join(directory,'oracle.json'),outputFile=path.join(directory,'report.json');
  await fs.writeFile(oraclePath,JSON.stringify({...oracle,runtimeSha:'d'.repeat(40)}));
  const result=await runPhotoJapanBrowserAcceptance({oraclePath,releaseSha:release,nonce,outputFile,playwrightModule:'must-not-import'});
  assert.equal(result.passed,false);assert.equal(result.explicitJapanApiRequests,0);assert.equal(result.japanUiNavigations,0);
  assert.equal(result.error.code,'photo_japan_browser_oracle_binding');assert.deepEqual(result.screenshots,[]);
  assert.equal(JSON.parse(await fs.readFile(outputFile,'utf8')).chinaPhotoPassed,false);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('photo-only proof remains a separate failed profile when its exact source binding is wrong',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'china-photo-gate-'));
 try{
  const oraclePath=path.join(directory,'oracle.json'),outputFile=path.join(directory,'report.json');
  await fs.writeFile(oraclePath,JSON.stringify({...oracle,runtimeSha:'d'.repeat(40)}));
  const result=await runChinaPhotoBrowserAcceptance({oraclePath,releaseSha:release,nonce,outputFile,
   playwrightModule:'must-not-import',includeJapan:true});
  assert.equal(result.kind,'china-photo-browser-v1');assert.equal(result.codeScope,'catalog-photo-recovery-v1');
  assert.equal(result.passed,false);assert.equal(result.chinaPhotoPassed,false);assert.equal(result.readOnlyBrowserFence,false);
  assert.equal(result.error.code,'photo_japan_browser_oracle_binding');
  for(const key of ['productionMutations','directSupplierRequests','explicitJapanApiRequests','japanUiNavigations'])assert.equal(result[key],0);
  for(const key of ['japanFreshnessPassed','japanPowerApiPassed','japanUiPassed'])assert.equal(Object.hasOwn(result,key),false);
  assert.deepEqual(JSON.parse(await fs.readFile(outputFile,'utf8')),result);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('photo-only browser fence allows the signed China proxy but blocks supplier, Japan and mutation requests',()=>{
 const signed='/api/catalog/photo/'+'a'.repeat(43);
 for(const url of [
  'https://avtocena.com/api/health',
  'https://avtocena.com/cars/china/Hyundai/Elantra?city=Novokuznetsk',
  'https://avtocena.com/api/catalog/search?market=china&page=1',
  'https://avtocena.com'+signed+'?url=https%3A%2F%2F2sc2.autoimg.cn%2Fphoto.jpg&market=china&view=card',
  'https://avtocena.com/_next/static/chunks/page.js',
  'https://avtocena.com/_next/static/chunks/app/(public)/cars/%5Bmarket%5D/page.js',
  'https://avtocena.com/api/catalog/brand-counts?market=china&make=Hyundai',
  'https://avtocena.com/api/catalog/models?market=china&scope=facets',
  'https://avtocena.com/api/catalog/colors?market=china',
  'https://avtocena.com/brand-logos/local/light/hyundai.png',
  'https://avtocena.com/api/catalog/brand-logo/hyundai?theme=dark',
  'https://avtocena.com/favicon-round-v3.svg',
 ])assert.equal(photoOnlyRequestScope(url,'GET'),'allowed',url);
 for(const url of ['https://avtocena.com/cars/japan','https://avtocena.com/cars/%6aapan?page=1',
  'https://avtocena.com/api/catalog/search?market=japan','https://avtocena.com/api/ajes/list',
  'https://avtocena.com/cars/ajes-stats-123'])assert.equal(photoOnlyRequestScope(url,'GET'),'japan');
 for(const url of ['https://supplier.invalid/path','https://2sc2.autoimg.cn/photo.jpg','https://avtocena.com.invalid/api/health',
  'https://user@avtocena.com/api/health','not-a-url'])assert.equal(photoOnlyRequestScope(url,'GET'),'external');
 assert.equal(photoOnlyRequestScope('https://avtocena.com/api/catalog/search?market=korea','GET'),'otherMarket');
 for(const url of ['/cars/korea','/cars/uae','/cars/europe','/cars/georgia'])
  assert.equal(photoOnlyRequestScope('https://avtocena.com'+url,'GET'),'otherMarket');
 for(const url of ['/cars','/cars/offer/'+'1'.repeat(24),'/api/catalog/home',
  '/api/catalog/search?countOnly=1','/api/catalog/search?market=china&market=china',
  '/api/catalog/search?market=china&source=ajes','/api/catalog/brand-counts','/api/catalog/models?scope=facets',
  '/api/catalog/colors','/api/catalog/saved-previews?ids='+'1'.repeat(24),
  signed+'?market=china&url=https%3A%2F%2Fci.encar.com%2Fphoto.jpg',
  signed+'?market=china&url=https%3A%2F%2F2sc2.autoimg.cn%2Fphoto.jpg&url=https%3A%2F%2Fsupplier.invalid',
  signed+'?market=china&url=https%3A%2F%2F2sc2.autoimg.cn.evil.invalid%2Fphoto.jpg',
  signed+'?market=china&url=https%3A%2F%2Fuser%402sc2.autoimg.cn%2Fphoto.jpg',
  signed+'?market=china&url=http%3A%2F%2F2sc2.autoimg.cn%2Fphoto.jpg',
  '/_next/static/%252e%252e/api/catalog/home'])assert.equal(photoOnlyRequestScope('https://avtocena.com'+url,'GET'),'unreviewed',url);
 for(const market of ['japan','china,japan','china&market=japan'])
  assert.equal(photoOnlyRequestScope('https://avtocena.com/api/catalog/search?market='+market,'GET'),'japan');
 for(const method of ['POST','PUT','DELETE','PATCH'])assert.equal(photoOnlyRequestScope('https://avtocena.com/api/health',method),'mutation');
 assert.equal(photoOnlyRequestScope('https://avtocena.com/api/health','HEAD'),'allowed');
});

test('photo-only API reads validate scope before I/O and cannot follow redirects outside that scope',async()=>{
 const calls=[],context={request:{async get(url,options){calls.push({url,options});return {status:()=>302,json:async()=>null};}}};
 for(const url of ['/cars/china','/api/catalog/home','/api/catalog/search?countOnly=1',
  '/api/catalog/search?market=china,japan','//supplier.invalid','https://supplier.invalid'])
  await assert.rejects(getChinaPhotoJson(context,url),/photo_api_scope/);
 assert.deepEqual(calls,[]);
 const result=await getChinaPhotoJson(context,photoJapanBinding(oracle,release,nonce).api);
 assert.deepEqual(result,{status:302,data:null});assert.equal(calls.length,1);
 assert.equal(calls[0].options.maxRedirects,0);assert.equal(calls[0].options.timeout,30_000);
 assert.equal(new URL(calls[0].url).searchParams.get('market'),'china');
 await getChinaPhotoJson(context,'/api/health');assert.equal(calls.length,2);assert.equal(calls[1].options.maxRedirects,0);
});

test('photo-only browser forwards original same-origin bytes once, refuses redirects and never forwards forbidden reads',async()=>{
 let handler;const report={};
 await installPhotoOnlyRequestFence({async route(pattern,callback){assert.equal(pattern,'**/*');handler=callback;}},report);
 assert.equal(report.readOnlyBrowserFence,true);
 const original={status:()=>200,async dispose(){events.push('dispose');}},events=[];
 const routeFor=(url,response=original)=>({
  request:()=>({url:()=>url,method:()=>'GET'}),
  async fetch(options){events.push(['fetch',options]);return response;},
  async fulfill(value){events.push(['fulfill',value]);assert.equal(value.response,response);},
  async abort(reason){events.push(['abort',reason]);},
  async continue(){assert.fail('native redirect-following continuation is forbidden in the photo-only fence');},
 });
 for(const url of ['https://avtocena.com/api/catalog/home','https://avtocena.com/cars',
  'https://avtocena.com/api/catalog/search?countOnly=1','https://avtocena.com/cars/japan','https://supplier.invalid/photo.jpg'])
  await handler(routeFor(url));
 assert.equal(events.filter(event=>Array.isArray(event)&&event[0]==='fetch').length,0);
 assert.equal(report.blockedRequests.unreviewed,3);assert.equal(report.blockedRequests.japan,1);assert.equal(report.blockedRequests.external,1);
 events.length=0;await handler(routeFor('https://avtocena.com/_next/static/chunks/main.js'));
 assert.deepEqual(events,[['fetch',{maxRedirects:0,timeout:30_000}],['fulfill',{response:original}],'dispose']);
 events.length=0;
 const redirect={status:()=>302,async dispose(){events.push('dispose');}};
 await handler(routeFor('https://avtocena.com/cars/china',redirect));
 assert.deepEqual(events,[['fetch',{maxRedirects:0,timeout:30_000}],['abort','blockedbyclient'],'dispose']);
 assert.equal(report.blockedRequests.redirect,1);
});
