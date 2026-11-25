import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {photoJapanBinding,selectChinaRecoveryPhoto,japanObservation,verifyJapanFreshPage,
 verifyJapanWarmReuse,verifyJapanPowerPayload,runPhotoJapanBrowserAcceptance} from '../scripts/catalog-next/photo-japan-browser-acceptance.mjs';

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
