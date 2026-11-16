import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CONTRACT,fenceStorage,fenceNetwork,readKeyPolicy,inspectUaeCoverage,idsOf,planUaeCardScan,inspectUaeCardReferences} from '../.github/diagnostics/uae-budget-coverage.mjs';
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
 const [a,b]=CONTRACT.cardTargets,privateId='do-not-print-this-email@example.test';
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
 values.set(prefix+'budget-cards-v3/0.json',{generationId,items:rows});
 values.set('catalog-editorial/current.json',{revision:'fixture',entries:{[b]:{id:b,market:'uae',status:'hidden'}}});
 const storage:any=getJsonStorage(),original=Object.fromEntries(['readJson','readJsonWithMeta','getBinary','readObjectMetadata','writeJson'].map(name=>[name,storage[name]]));
 storage.readJsonWithMeta=async(key:string,fallback:any)=>({found:values.has(key),etag:'fixture',value:structuredClone(values.get(key)??fallback)});
 storage.readJson=async(key:string,fallback:any)=>(await storage.readJsonWithMeta(key,fallback)).value;
 storage.getBinary=async(key:string)=>({data:Buffer.from(JSON.stringify(values.get(key)))});
 storage.readObjectMetadata=async(key:string)=>({found:values.has(key),etag:'fixture'});
 storage.writeJson=async(key:string)=>{writes.push(key);throw Error('unexpected_write');};
 editorial.resetCatalogEditorialCache();catalog.resetCatalogReadCachesForTests();
 try{
  const authorized:string[]=[];
  const report=await inspectUaeCoverage({storage,runtime:{catalog,publication,parts,editorial,manual,encyclopedia,evidence,safety},selectorDirectories:directories,manifest,
   cardScan:{authorize(keys:string[]){authorized.push(...keys);}}});
  assert.equal(report.manifestRows,3);assert.equal(report.projections.immutable.gateEligible.count,3);
  assert.equal(report.projections.immutable.ordinaryPublicEligible.count,2);
  assert.equal(report.selectors.base.sourceRows,1);assert.equal(report.selectors.candidate.otherRows,1);
  assert.equal(report.selectors.candidate.missingGateEligible.count,2);
  assert.equal(report.selectors.candidate.missingOrdinaryPublicEligible.count,1);
  assert.equal(report.observedCandidateCoverage,'incomplete_or_unavailable');assert.equal(report.releaseAccepted,false);
  assert.equal(report.missingSamples[0].sourceCategory,'dubicars');assert.equal(report.missingSamples[0].raw.renderable,true);
  assert.equal(report.missingSamples[0].inSelector.base,false);assert.equal(report.publicDifference?.onlyPublic.count,0);
  assert.deepEqual(authorized,[0,1].map(block=>prefix+`budget-cards-v3/${block}.json`));
  assert.equal(report.cardReferences?.targets[1].foundInCheckedBlocks,true);
  assert.equal(report.cardReferences?.targets[1].matches[0].preparedMatchesImmutable,true);
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

function cardFixture(){
 const generationId=CONTRACT.generation,key=(block:number)=>`catalog/generations/${generationId}/indexes/budget-cards-v3/${block}.json`;
 const row=(id:string)=>({id,market:'uae',sourceGroup:'dubicars_uae_exact',make:'Toyota',model:'Corolla',year:2025,
  cardProjectionVersion:3,calculationStatus:'needs_data',catalogPricingMode:'seller',sourcePrice:100000,
  sourceCurrency:'AED',sellerPriceRub:2000000,totalRub:null,cardImageUrl:'https://private-fixture.invalid/photo',
  calculationSnapshot:{currencyRate:{currency:'AED',sourcePrice:100000,effectiveRate:20,rateSource:'cbr',rateDate:'2026-11-16'}},
  supplierPrivateDetails:'never-print-this-private-field'});
 const base=Array.from({length:256},(_,i)=>row(`private-person-${i}@example.invalid`));
 const targets=CONTRACT.cardTargets.map(row),all=[...targets,...base];
 const manifest={generationId,markets:{uae:{count:all.length}}};
 const index=buildBudgetCountIndex(generationId,base as any,new Map(base.map(row=>[row.id,10])),3);
 const values=new Map<string,any>([[key(9),{generationId,items:structuredClone(targets)}],[key(10),{generationId,items:structuredClone(base)}]]);
 const allowedKeys=new Set<string>(),allowed=readKeyPolicy([],allowedKeys),reads:string[]=[],heads:string[]=[];
 const storage:any={readJsonWithMeta:async(name:string)=>{reads.push(name);return {found:values.has(name),
  value:structuredClone(values.get(name)??null),...(values.has(name)?{etag:'revision-'+name}:{})};},
  readObjectMetadata:async(name:string)=>{heads.push(name);return {found:values.has(name),...(values.has(name)?{etag:'revision-'+name}:{})};}};
 const guard=fenceStorage(storage,allowed),runtime={catalog,manual,encyclopedia,evidence,safety};
 const prepared=catalog.prepareCatalogProjectionRows(all as any);
 const immutable={rows:all.length,invalidIds:0,foreignMarkets:0,duplicates:new Set<string>(),gateEligibleDuplicates:new Set<string>(),
  ids:new Set(all.map(row=>row.id)),gateEligible:new Set(prepared.map(row=>row.id))};
 const targetRows=new Map(targets.map(row=>[row.id,{raw:row,prepared:prepared.find(item=>item.id===row.id)}]));
 const run=()=>inspectUaeCardReferences({storage,runtime,index,manifest,immutable,targets:targetRows,
  authorize(keys:string[]){for(const key of keys)allowedKeys.add(key);}});
 return {key,row,manifest,index,values,storage,allowedKeys,allowed,reads,heads,guard,immutable,run};
}

test('bounded real-runtime card scan recovers the three missing identities from the lower boundary without exposing rows',async()=>{
 const fixture=cardFixture();assert.equal(fixture.allowed(fixture.key(10)),false,'no card key is allowed before validated selector mapping');
 const report=await fixture.run();
 assert.deepEqual(fixture.reads,[9,10,11].map(fixture.key));assert.deepEqual(fixture.heads,fixture.reads);
 assert.equal(fixture.allowed(fixture.key(8)),false);assert.equal(fixture.allowed(fixture.key(12)),false);
 assert.equal(report.checkedScopeComplete,true);assert.equal(report.allBaseIdsMapped,true);
 assert.equal(report.allImmutableEligibleIdsMapped,true);assert.equal(report.uaeIdsOutsideBase.count,3);
 assert.equal(report.immutableEligibleMissingCards.count,0);assert.equal(report.immutableEligibleMissingEligibleCards.count,0);
 assert.equal(report.universalAbsenceProven,false);assert.equal(report.etagsUnchanged,true);
 assert.equal(report.blocks[0].referenced,false);assert.equal(report.blocks[0].uaeRows,3);
 assert.equal(report.blocks[1].missingMappedIds.count,0);assert.equal(report.blocks[2].found,false);
 for(const target of report.targets){assert.equal(target.inBaseSelector,false);assert.equal(target.foundInCheckedBlocks,true);
  assert.equal(target.occurrences,1);assert.equal(target.matches[0].block,9);
  assert.equal(target.matches[0].rawMatchesImmutable,true);assert.equal(target.matches[0].preparedMatchesImmutable,true);
  assert.equal(target.matches[0].gateEligible,true);}
 assert.deepEqual(fixture.guard,{readFailures:0,blockedOperations:0});
 const serialized=JSON.stringify(report);
 for(const secret of ['private-person','@example.invalid','private-fixture.invalid','never-print-this-private-field'])assert.ok(!serialized.includes(secret));
});

test('card scan preserves uncertainty for missing referenced blocks, wrong generations and duplicate identities',async()=>{
 const missing=cardFixture();missing.values.delete(missing.key(10));
 const missingReport=await missing.run();assert.equal(missingReport.checkedScopeComplete,false);
 assert.equal(missingReport.missingReferencedBlocks,1);assert.equal(missingReport.allBaseIdsMapped,false);
 const wrong=cardFixture();wrong.values.get(wrong.key(9)).generationId='different';
 const wrongReport=await wrong.run();assert.equal(wrongReport.invalidBlocks,1);assert.equal(wrongReport.checkedScopeComplete,false);
 assert.ok(wrongReport.targets.every(target=>target.status==='unknown_incomplete_scope'&&!target.foundInCheckedBlocks));
 const duplicate=cardFixture();duplicate.values.set(duplicate.key(11),structuredClone(duplicate.values.get(duplicate.key(9))));
 const duplicateReport=await duplicate.run();assert.equal(duplicateReport.duplicateIds.count,3);
 assert.equal(duplicateReport.checkedScopeComplete,false);assert.equal(duplicateReport.allImmutableEligibleIdsMapped,false);
 assert.ok(duplicateReport.targets.every(target=>target.occurrences===2));
 const repeated=cardFixture();repeated.values.get(repeated.key(9)).items=Array.from({length:20},()=>repeated.row(CONTRACT.cardTargets[0]));
 const repeatedReport=await repeated.run();assert.equal(repeatedReport.targets[0].occurrences,20);
 assert.equal(repeatedReport.targets[0].matches.length,CONTRACT.limits.samples);assert.equal(repeatedReport.targets[0].omittedMatches,10);
 assert.equal(repeatedReport.checkedScopeComplete,false);
 const absent=cardFixture();absent.values.delete(absent.key(9));const absentReport=await absent.run();
 assert.equal(absentReport.checkedScopeComplete,true);assert.equal(absentReport.universalAbsenceProven,false);
 assert.ok(absentReport.targets.every(target=>target.status==='not_found_in_checked_blocks'));
});

test('card identity alone is insufficient: changed projection inputs are reported and changing ETags abort the scan',async()=>{
 const changed=cardFixture();changed.values.get(changed.key(9)).items[0].sourcePrice=100001;
 changed.values.get(changed.key(9)).items[0].calculationSnapshot.currencyRate.sourcePrice=100001;
 const report=await changed.run();assert.equal(report.targets[0].foundInCheckedBlocks,true);
 assert.equal(report.targets[0].matches[0].rawMatchesImmutable,false);
 assert.equal(report.targets[0].matches[0].preparedMatchesImmutable,false);
 const invalidQuote=cardFixture();invalidQuote.values.get(invalidQuote.key(9)).items[0].sourcePrice=100001;
 const invalidQuoteReport=await invalidQuote.run();assert.equal(invalidQuoteReport.targets[0].foundInCheckedBlocks,true);
 assert.equal(invalidQuoteReport.targets[0].matches[0].gateEligible,false);
 assert.equal(invalidQuoteReport.immutableEligibleMissingEligibleCards.count,1);assert.equal(invalidQuoteReport.allImmutableEligibleIdsMapped,false);
 const duplicateProjection=cardFixture();duplicateProjection.immutable.duplicates.add(CONTRACT.cardTargets[0]);
 const malformedReport=await duplicateProjection.run();assert.equal(malformedReport.immutableIdentityValid,false);
 assert.equal(malformedReport.allImmutableEligibleIdsMapped,false);
 const moving=cardFixture(),head=moving.storage.readObjectMetadata;
 moving.storage.readObjectMetadata=async(key:string)=>({...await head(key),...(key===moving.key(10)?{etag:'changed'}:{})});
 await assert.rejects(moving.run(),/coverage_card_object_changed/);
});

test('invalid card mappings cannot authorize reads and the scan excludes interior holes instead of widening the allowlist',async()=>{
 for(const block of ['10',-1,1.5,Number.MAX_SAFE_INTEGER,Infinity]){
  const fixture=cardFixture();fixture.index.otherRows![0][5]!.block=block as any;
  await assert.rejects(fixture.run(),/coverage_card_selector_block_invalid/);
  assert.equal(fixture.allowedKeys.size,0);assert.deepEqual(fixture.reads,[]);
 }
 const fixture=cardFixture(),badCount=structuredClone(fixture.index);badCount.sourceRows++;
 assert.throws(()=>planUaeCardScan(badCount,fixture.manifest),/coverage_card_selector_count_invalid/);
 const duplicate=structuredClone(fixture.index);duplicate.otherRows![1][5]!.id=duplicate.otherRows![0][5]!.id;
 assert.throws(()=>planUaeCardScan(duplicate,fixture.manifest),/coverage_card_selector_identity_invalid/);
 const far=structuredClone(fixture.index);far.otherRows![0][5]!.block=99999;
 assert.throws(()=>planUaeCardScan(far,fixture.manifest),/coverage_card_selector_span_invalid/);
 const hole=structuredClone(fixture.index);hole.otherRows![0][5]!.block=12;
 const plan=planUaeCardScan(hole,{...fixture.manifest,markets:{uae:{count:600}}});
 assert.deepEqual(plan.blocks,[9,10,12,13]);assert.equal(plan.unreadInteriorBlocks,1);
});

test('dynamic card GET allowlist and card byte caps remain enforced below the storage layer',async()=>{
 const fixture=cardFixture();let calls=0;
 const env={YC_OBJECT_STORAGE_ENDPOINT:'https://s3.regru.cloud',YC_OBJECT_STORAGE_BUCKET:'fixture',YC_OBJECT_STORAGE_PREFIX:'prefix'};
 const url='https://s3.regru.cloud/fixture/prefix/'+fixture.key(10);
 const network=fenceNetwork(env,fixture.allowed,async()=>{calls++;return new Response('too large');},{...CONTRACT.limits,cardObjectBytes:2});
 await assert.rejects(network.fetch(url),/http_target_forbidden/);assert.equal(calls,0);
 for(const block of planUaeCardScan(fixture.index,fixture.manifest).blocks)fixture.allowedKeys.add(fixture.key(block));
 await assert.rejects((await network.fetch(url)).text(),/byte_bound_exceeded/);assert.equal(calls,1);
 await assert.rejects(network.fetch('https://s3.regru.cloud/fixture/prefix/'+fixture.key(12)),/http_target_forbidden/);
 await assert.rejects(network.fetch(url,{method:'PUT'}),/http_method_forbidden/);
 assert.equal(calls,1);
});
