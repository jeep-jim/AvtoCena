import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CONTRACT,fenceStorage,fenceNetwork,readKeyPolicy,inspectUaeCoverage,idsOf} from '../.github/diagnostics/uae-budget-coverage.mjs';
import {getJsonStorage} from '../apps/web/lib/data';
import * as catalog from '../apps/web/lib/catalog/storage';
import * as publication from '../apps/web/lib/catalog/budget-selector-publication';
import * as parts from '../apps/web/lib/catalog-projection-parts';
import * as editorial from '../apps/web/lib/catalog/editorial';
import * as manual from '../apps/web/lib/catalog/uae-manual-specifications';
import * as encyclopedia from '../apps/web/lib/encyclopedia/calculation-index';
import * as evidence from '../apps/web/lib/encyclopedia/calculation-evidence';
import * as safety from '../apps/web/lib/catalog/safe-public-pricing';
import {buildBudgetCountIndex} from '../apps/web/lib/catalog/budget-count-index';
import {restoreReleaseEncyclopedia} from '../scripts/encyclopedia/restore-calculation-index.mjs';

test('real UAE projection and selector readers distinguish saved IDs from current eligibility without a write',async()=>{
 const generationId=CONTRACT.generation,prefix=`catalog/generations/${generationId}/indexes/`;
 const values=new Map<string,any>(),writes:string[]=[];
 const a='a'.repeat(24),b='b'.repeat(24),privateId='do-not-print-this-email@example.test';
 const rows=[a,b,privateId].map(id=>({id,market:'uae',sourceGroup:'dubicars_uae_exact',make:'Toyota',model:'Corolla',
  year:2025,cardProjectionVersion:3,calculationStatus:'needs_data',sourcePrice:null,totalRub:null}));
 const manifest={version:2,generationId,markets:{uae:{count:rows.length,chunks:['one']}}};
 const directories={base:'budget-markets-v3',candidate:'budget-markets-v7/'+'d'.repeat(64)};
 const index=buildBudgetCountIndex(generationId,[rows[0]] as any,new Map([[a,0]]),3);
 for(const directory of Object.values(directories)){
  const key=prefix+directory+'/';
  const entry=await publication.publishSelectorMarket(index,'uae',async name=>values.get(key+name+'.json'),
   async(name,value)=>{values.set(key+name+'.json',value);});
  values.set(key+'ready.json',{version:4,generationId,encyclopediaDigest:CONTRACT.encyclopedia,markets:{uae:entry}});
 }
 values.set(prefix+'projection/uae.json',{generationId,items:rows});
 values.set('catalog/public/projection/uae.json',{generationId,items:rows});
 values.set('catalog-editorial/current.json',{revision:'fixture',entries:{[b]:{id:b,market:'uae',status:'hidden'}}});
 const storage:any=getJsonStorage(),original=Object.fromEntries(['readJson','readJsonWithMeta','getBinary','readObjectMetadata','writeJson'].map(name=>[name,storage[name]]));
 storage.readJsonWithMeta=async(key:string,fallback:any)=>({found:values.has(key),etag:'fixture',value:structuredClone(values.get(key)??fallback)});
 storage.readJson=async(key:string,fallback:any)=>(await storage.readJsonWithMeta(key,fallback)).value;
 storage.getBinary=async(key:string)=>({data:Buffer.from(JSON.stringify(values.get(key)))});
 storage.readObjectMetadata=async(key:string)=>({found:values.has(key),etag:'fixture'});
 storage.writeJson=async(key:string)=>{writes.push(key);throw Error('unexpected_write');};
 editorial.resetCatalogEditorialCache();catalog.resetCatalogReadCachesForTests();
 try{
  const report=await inspectUaeCoverage({storage,runtime:{catalog,publication,parts,editorial,manual,encyclopedia,evidence,safety},selectorDirectories:directories,manifest});
  assert.equal(report.manifestRows,3);assert.equal(report.projections.immutable.gateEligible.count,3);
  assert.equal(report.projections.immutable.ordinaryPublicEligible.count,2);
  assert.equal(report.selectors.base.sourceRows,1);assert.equal(report.selectors.candidate.otherRows,1);
  assert.equal(report.selectors.candidate.missingGateEligible.count,2);
  assert.equal(report.selectors.candidate.missingOrdinaryPublicEligible.count,1);
  assert.equal(report.observedCandidateCoverage,'incomplete_or_unavailable');assert.equal(report.releaseAccepted,false);
  assert.equal(report.missingSamples[0].sourceCategory,'dubicars');assert.equal(report.missingSamples[0].raw.renderable,true);
  assert.equal(report.missingSamples[0].inSelector.base,false);assert.equal(report.publicDifference?.onlyPublic.count,0);
  assert.ok(!JSON.stringify(report).includes(privateId),'an unrecognised identity is hashed, never exposed verbatim');
  assert.deepEqual(writes,[]);
  const candidateKey=prefix+directories.candidate+'/';
  const ready=values.get(candidateKey+'ready.json');
  delete ready.encyclopediaDigest;
  const wrongDigest=await inspectUaeCoverage({storage,runtime:{catalog,publication,parts,editorial,manual,encyclopedia,evidence,safety},selectorDirectories:directories,manifest});
  assert.equal(wrongDigest.selectors.candidate.status,'wrong_encyclopedia');
  ready.encyclopediaDigest=CONTRACT.encyclopedia;
  const badSchema={...index,specificationFilterVersion:undefined};
  ready.markets.uae=await publication.publishSelectorMarket(badSchema,'uae',async name=>values.get(candidateKey+name+'.json'),
   async(name,value)=>{values.set(candidateKey+name+'.json',value);});
  const wrongSchema=await inspectUaeCoverage({storage,runtime:{catalog,publication,parts,editorial,manual,encyclopedia,evidence,safety},selectorDirectories:directories,manifest});
  assert.equal(wrongSchema.selectors.candidate.status,'wrong_specification_schema');
  assert.equal(wrongSchema.observedCandidateCoverage,'incomplete_or_unavailable');
  values.delete(prefix+directories.candidate+'/ready.json');
  const missing=await inspectUaeCoverage({storage,runtime:{catalog,publication,parts,editorial,manual,encyclopedia,evidence,safety},selectorDirectories:directories,manifest});
  assert.equal(missing.selectors.candidate.status,'absent');assert.equal(missing.observedCandidateCoverage,'incomplete_or_unavailable');
 }finally{Object.assign(storage,original);editorial.resetCatalogEditorialCache();catalog.resetCatalogReadCachesForTests();}
});

test('read policy excludes CRM, foreign generations, other markets, traversal and bucket listing',async()=>{
 const allowed=readKeyPolicy(['budget-markets-v3']);
 assert.equal(allowed(`catalog/generations/${CONTRACT.generation}/indexes/budget-markets-v3/ready.json`),true);
 for(const key of ['clients/clients.json','catalog/generations/other/indexes/projection/uae.json',
  `catalog/generations/${CONTRACT.generation}/indexes/projection/china.json`,'catalog/../manifest.json'])assert.equal(allowed(key),false);
 let writes=0,reads=0;const storage:any={readJsonWithMeta:async()=>{reads++;return {found:true,value:1};},
  writeJson:async()=>{writes++;},deleteJson:async()=>{writes++;},listObjects:async()=>[]};
 fenceStorage(storage,allowed);assert.equal(await storage.readJson('catalog/manifest.json',null),1);
 for(const name of ['writeJson','deleteJson','putBinary','deletePrefix','listObjects','createBinaryDownloadUrl'])
  await assert.rejects(storage[name]('catalog/manifest.json',{}),/mutation_or_listing_forbidden/);
 await assert.rejects(storage.readJson('clients/clients.json',null),/read_forbidden/);
 assert.equal(writes,0);assert.equal(reads,1);
});

test('raw HTTP fence rejects mutation and private targets before fetch, and caps read bytes',async()=>{
 let calls=0;
 const env={YC_OBJECT_STORAGE_ENDPOINT:'https://s3.regru.cloud',YC_OBJECT_STORAGE_BUCKET:'fixture',YC_OBJECT_STORAGE_PREFIX:'prefix'};
 const allowed=readKeyPolicy([]),url='https://s3.regru.cloud/fixture/prefix/catalog/manifest.json';
 const network=fenceNetwork(env,allowed,async()=>{calls++;return new Response('{}');});
 for(const [target,method] of [[url,'PUT'],[url,'DELETE'],['https://s3.regru.cloud/fixture/prefix/clients/clients.json','GET'],
  ['https://s3.regru.cloud/fixture?list-type=2','GET'],['https://www.cbr.ru/scripts/XML_daily.asp','GET']])
  await assert.rejects(network.fetch(target,{method}),/http_(?:method|target)_forbidden/);
 assert.equal(calls,0);assert.equal(await (await network.fetch(url)).text(),'{}');assert.equal(calls,1);
 assert.equal(network.stats.bytes,2);assert.deepEqual(network.stats.methods,{GET:1,HEAD:0});
 const tiny=fenceNetwork(env,allowed,async()=>new Response('too large'),{...CONTRACT.limits,objectBytes:1});
 await assert.rejects((await tiny.fetch(url)).text(),/byte_bound_exceeded/);
});

test('duplicate and invalid identity accounting does not silently deduplicate coverage',()=>{
 const result=idsOf([{id:'a'.repeat(24)},{id:'a'.repeat(24)},{id:' bad '},{id:null}]);
 assert.equal(result.ids.size,1);assert.equal(result.duplicates.size,1);assert.equal(result.invalid,2);
});

test('actual projection writer chunk keys and iterator are accepted only for the two pinned UAE roots',async()=>{
 const values=new Map<string,any>(),allowed=readKeyPolicy([]);
 const store:any={writeJson:async(key:string,value:any)=>{values.set(key,value);},readJson:async(key:string)=>values.get(key),
  getBinary:async(key:string)=>({data:Buffer.from(JSON.stringify(values.get(key)))})};
 const rows=Array.from({length:1001},(_,i)=>({id:String(i),market:'uae'}));
 for(const key of [`catalog/generations/${CONTRACT.generation}/indexes/projection/uae.json`,'catalog/public/projection/uae.json']){
  const directory=await parts.writeCatalogProjectionBatches(store,key,CONTRACT.generation,[rows]);
  assert.equal(directory.parts.length,2);
  for(const descriptor of directory.parts)assert.equal(allowed(descriptor.path),true,descriptor.path);
  const restored=[];for await(const batch of parts.readCatalogProjectionBatches(store,key))restored.push(...batch.items);
  assert.deepEqual(restored,rows);
 }
 assert.equal(new Set([...values.keys()].filter(key=>key.includes('/projection-parts/')).map(key=>key.split('/').slice(0,-1).join('/'))).size,2);
});

test('actual restoration helper writes only the local private index path consumed by the runtime',async()=>{
 const before=process.cwd(),temp=await fs.mkdtemp(path.join(os.tmpdir(),'uae-private-index-path-'));
 const models={},digest=createHash('sha256').update(JSON.stringify(models)).digest('hex'),release='a'.repeat(40);
 const key=`knowledge/encyclopedia/calculation-indexes/${digest}.json`,reads:string[]=[];
 const storage={readJson:async(name:string)=>{reads.push(name);return name===key?{version:1,digest,models}
  :name===`knowledge/encyclopedia/calculation-releases/${release}.json`?{release,digest,key}:null;}};
 try{
  await fs.symlink(path.join(before,'apps'),path.join(temp,'apps'),'dir');
  assert.equal(await restoreReleaseEncyclopedia(storage,temp,release),digest);
  process.chdir(temp);encyclopedia.resetCalculationIndexForTests();
  assert.equal(encyclopedia.readCalculationIndex()?.digest,digest);
  assert.equal(JSON.parse(await fs.readFile(path.join(temp,'data/knowledge/encyclopedia/calculation-v1.json'),'utf8')).digest,digest);
  assert.deepEqual(reads,[`knowledge/encyclopedia/calculation-releases/${release}.json`,key]);
 }finally{process.chdir(before);encyclopedia.resetCalculationIndexForTests();await fs.rm(temp,{recursive:true,force:true});}
});
