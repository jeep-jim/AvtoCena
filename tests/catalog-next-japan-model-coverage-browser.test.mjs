import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {JAPAN_SOURCE_BOUNDED_COUNT_ACCEPTANCE as policy, japanModelCoverageRequirement,
  japanModelCoverageApi, japanModelCoverageApiAllowed, japanExactCountApi, verifyJapanModelCount,
  verifyJapanModelCoverage, verifyJapanSourceModelCoverage, collectJapanSourceModelOptions,
  checkedJapanModelCoverageBrowserFixture} from '../scripts/catalog-next/japan-exact-count-browser.mjs';
import {JAPAN_OBSERVED_TIMING_POLICY, verifyJapanPage, verifyJapanFullPage, verifyJapanPowerPage,
  verifyJapanSourceScopePage, runJapanBrowserAcceptance} from '../scripts/catalog-next/japan-browser-acceptance.mjs';
import {verifyJapanPriceSortCount} from '../scripts/catalog-next/japan-price-sort-browser.mjs';
import {JAPAN_STABILITY_CODE_SCOPE} from '../scripts/catalog-next/japan-stability-code-scope.mjs';
import {japanStabilitySearchApi,verifyJapanStabilityCombinedRows} from '../scripts/catalog-next/japan-stability-browser.mjs';

const now=Date.parse('2026-11-28T12:00:00Z'),observedAt=new Date(now-5000).toISOString();
const city='Новокузнецк';
const petrol='/api/catalog/search?'+new URLSearchParams({market:'japan',page:'1',pageSize:'24',city,powerTo:'160',fuel:'petrol'});
const cursor='j2.k.2.0.2.'+'a'.repeat(64)+'.'+'b'.repeat(64)+'.-';
const row=id=>({id:'ajes-stats-'+id,market:'japan',make:'AUDI',model:'A4 AVANT',fuel:'petrol',powerHp:150});
const page=()=>({ok:true,page:1,pageSize:24,items:Array.from({length:24},(_,i)=>row(String(i))),
  received:24,observedAt,stale:false,partial:false,selectionIncomplete:false,interrupted:false,scanLimited:false,
  total:null,countSummary:null,hasMore:true,nextCursor:cursor,reads:1,
  powerFilterSummary:{shown:24,localPower:24,supplierPower:0,unknownPower:0}});
const receipt=()=>({version:1,requestId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',queryHash:'c'.repeat(64),
  table:'stats',kind:'list',page:1,pageSize:24,startedAt:observedAt,finishedAt:observedAt,
  stage:'access',supplierAttempted:false,outcome:'fresh',observedAt});
const scoped=()=>({...page(),partial:true,sourceReceipts:[receipt()]});
const modelDirectory=count=>Array.from({length:count},(_,index)=>({make:'AUDI',model:'A4 EDITION '+index,total:1}));
const modelCard=(pair,index)=>({id:'ajes-stats-model-'+index,market:'japan',make:pair.make,model:pair.model});

test('incremental coverage retains every literal directory pair and separately proves exact card-backed UI extras',()=>{
  const directory=modelDirectory(94),cards=directory.slice(0,24).map(modelCard);
  cards[0]={...cards[0],make:'Audi'};
  const options=[...directory,{make:cards[0].make,model:cards[0].model}],progress={};
  const proof=verifyJapanSourceModelCoverage(directory,options,cards,progress);
  assert.equal(proof.coverageContract,'directory-and-visible-cards-v1');
  assert.equal(proof.sourcePairs,94);assert.equal(proof.accessiblePairs,94);assert.equal(proof.optionPairs,95);
  assert.equal(proof.cardBackedExtraPairs,1);assert.equal(proof.visibleCardPairs,24);
  assert.equal(proof.uiEqualsDirectory,false);assert.equal(proof.allOptionsSourceBacked,true);
  assert.equal(proof.pairsSha256,verifyJapanModelCoverage(directory,directory).pairsSha256);
  assert.notEqual(proof.pairsSha256,proof.optionPairsSha256);
  assert.equal(progress.modelOptions.missingDirectoryPairCount,0);
  assert.equal(progress.modelOptions.unbackedOptionPairCount,0);
  assert.throws(()=>verifyJapanModelCoverage(directory,options),/model_coverage/,'strict default still requires directory equality');
  const reversed=verifyJapanSourceModelCoverage([...directory].reverse(),[...options].reverse(),[...cards].reverse());
  for(const key of ['pairsSha256','optionPairsSha256','cardBackedExtraPairsSha256','visibleCardPairsSha256','cardProvenanceSha256'])
    assert.equal(reversed[key],proof[key],key+' is independent of display order');
  const plain=verifyJapanSourceModelCoverage(directory,directory,directory.slice(0,24).map(modelCard));
  assert.equal(plain.cardBackedExtraPairs,0);assert.equal(plain.uiEqualsDirectory,true);
  assert.equal(plain.optionPairsSha256,plain.pairsSha256);
});

test('card-backed spelling cannot replace a source name or admit unrelated or unverified options',()=>{
  const directory=modelDirectory(30),cards=directory.slice(0,24).map(modelCard);
  cards[0]={...cards[0],make:'Audi'};
  const extra={make:cards[0].make,model:cards[0].model};
  for(const options of [[...directory.slice(1),extra],[...directory,{make:'Audi',model:'A4 invented'}],
    [...directory,{make:'AUDI',model:'a4 edition 0'}],[...directory,directory[0]],
    [...directory,{make:'AUDI',model:'<invalid>'}]]){
    const progress={};assert.throws(()=>verifyJapanSourceModelCoverage(directory,options,cards,progress));
    assert.equal(progress.modelOptions.sourcePairs,30,'rejection retains source diagnostics');
  }
  const progress={};
  assert.throws(()=>verifyJapanSourceModelCoverage(directory,[...directory.slice(1),extra],cards,progress));
  assert.deepEqual(progress.modelOptions.missingDirectoryPairs,[['AUDI','A4 EDITION 0']]);
  for(const changed of [cards.slice(0,0),[...cards,cards[0]],
    [{...cards[0],market:'china'}],[{...cards[0],make:'TOYOTA'}],[{...cards[0],id:'foreign-1'}],
    [{...cards[0],model:'bad|name'}],Array.from({length:25},(_,index)=>modelCard(directory[index],index))])
    assert.throws(()=>verifyJapanSourceModelCoverage(directory,[...directory,extra],changed));
});

test('coverage failure diagnostics contain only twelve bounded public pair samples plus exact counts and hashes',()=>{
  const directory=modelDirectory(20),cards=directory.map(modelCard),progress={};
  const options=Array.from({length:20},(_,index)=>({make:'AUDI',model:'A5 unknown '+index}));
  options.push({make:'AUDI',model:'<invalid>'});
  assert.throws(()=>verifyJapanSourceModelCoverage(directory,options,cards,progress));
  const value=progress.modelOptions;
  assert.equal(value.missingDirectoryPairCount,20);assert.equal(value.unbackedOptionPairCount,20);
  assert.equal(value.missingDirectoryPairs.length+value.unbackedOptionPairs.length,12);
  assert.equal(value.diagnosticPairsOmitted,28);assert.equal(value.invalidOptionPairs,1);
  assert.equal(JSON.stringify(value).includes('<invalid>'),false);
  for(const key of ['pairsSha256','optionPairsSha256','visibleCardPairsSha256','cardProvenanceSha256'])
    assert.match(value[key],/^[a-f0-9]{64}$/);
});

function delayedModelPicker(directory,cards,{omitSource=false,make='AUDI'}={}){
  let sourceApplied=false,limit=60,waits=0,cardFallbackRejected=false;
  const cardPairs=[...new Map(cards.map(row=>[JSON.stringify([row.make,row.model]),{make:row.make,model:row.model}])).values()];
  const all=[...new Map([...(omitSource?directory.slice(1):directory),...cardPairs]
    .map(row=>[JSON.stringify([row.make,row.model]),row])).values()];
  const current=()=>sourceApplied?all.slice(0,limit):cardPairs;
  const nodes=()=>current().map(row=>({getClientRects:()=>[{}],
    getAttribute:key=>key==='data-model-make'?row.make:row.model}));
  const more=()=>sourceApplied&&all.length>limit;
  const root={querySelectorAll:selector=>selector==='button'?more()?[{getClientRects:()=>[{}],textContent:'Показать ещё · '+(all.length-limit)}]:[]:nodes()};
  const input={value:'',getAttribute:()=> 'true',parentElement:root};
  const form={getClientRects:()=>[{}],querySelector:selector=>selector==='input[name="make"]'?{value:make}:input};
  const view={locator:()=>({evaluateAll:async callback=>callback(nodes())}),
    getByRole:()=>({count:async()=>Number(more()),click:async()=>{limit+=60;}}),
    waitForFunction:async(predicate,args)=>{
      const priorDocument=globalThis.document,priorStyle=globalThis.getComputedStyle;
      globalThis.document={querySelectorAll:()=>[form]};globalThis.getComputedStyle=()=>({visibility:'visible'});
      try{
        waits++;
        if(!sourceApplied){cardFallbackRejected=predicate(args)===false;sourceApplied=true;}
        if(!predicate(args))throw Error('mock model directory deadline');
        return {dispose:async()=>{}};
      }finally{
        if(priorDocument===undefined)delete globalThis.document;else globalThis.document=priorDocument;
        if(priorStyle===undefined)delete globalThis.getComputedStyle;else globalThis.getComputedStyle=priorStyle;
      }
    }};
  return {view,observed:()=>({waits,cardFallbackRejected})};
}

test('DOM readiness rejects a large card fallback until every mandatory directory pair is applied',async()=>{
  const directory=modelDirectory(10),cards=Array.from({length:24},(_,index)=>modelCard(
    index===0?{make:'Audi',model:directory[0].model}:{make:'AUDI',model:'A5 CARD '+index},index));
  const picker=delayedModelPicker(directory,cards),progress={modelExpansions:0};
  const result=await collectJapanSourceModelOptions(picker.view,directory,cards,progress);
  assert.equal(picker.observed().cardFallbackRejected,true,'24 fallback options cannot stand in for ten different source pairs');
  assert.equal(result.proof.accessiblePairs,10);assert.equal(result.proof.optionPairs,34);
  assert.equal(progress.directoryOptionsReady,true);assert.equal(progress.modelExpansions,0);
  const missing=delayedModelPicker(directory,cards,{omitSource:true}),failure={};
  await assert.rejects(collectJapanSourceModelOptions(missing.view,directory,cards,failure),/directory deadline/);
  assert.equal(failure.directoryOptionsReady,undefined);assert.equal(failure.modelOptions.missingDirectoryPairCount,1);
  const wrongMake=delayedModelPicker(directory,cards,{make:'TOYOTA'});
  await assert.rejects(collectJapanSourceModelOptions(wrongMake.view,directory,cards),/directory deadline/);
});

test('DOM expansion bound includes verified card extras beyond the next sixty-option boundary',async()=>{
  const directory=modelDirectory(119),cards=directory.slice(0,24).map(modelCard);
  cards[0]={...cards[0],make:'Audi'};cards[1]={...cards[1],make:'Audi'};
  const picker=delayedModelPicker(directory,cards),progress={modelExpansions:0};
  const result=await collectJapanSourceModelOptions(picker.view,directory,cards,progress);
  assert.equal(result.proof.sourcePairs,119);assert.equal(result.proof.optionPairs,121);
  assert.equal(result.proof.cardBackedExtraPairs,2);assert.equal(progress.modelExpansions,2);
  assert.equal(picker.observed().waits,3);assert.equal(picker.observed().cardFallbackRejected,true);
});

test('model acceptance parses only explicit 0/1 environment values and admits only three bounded Audi reads',()=>{
  assert.equal(japanModelCoverageRequirement(undefined),false);
  assert.equal(japanModelCoverageRequirement('0'),false);
  assert.equal(japanModelCoverageRequirement('1'),true);
  for(const value of [true,false,0,1,'','true','yes',null])assert.throws(()=>japanModelCoverageRequirement(value));
  for(const make of ['AUDI','Audi'])for(const kind of ['make','model','models'])
    assert.equal(japanModelCoverageApiAllowed(japanModelCoverageApi(kind,{make})),true);
  for(const kind of ['plain','combined','budget'])assert.equal(japanModelCoverageApiAllowed(
    japanExactCountApi(kind,kind==='budget'?{budgetTo:'1303000'}:{})),false);
  const api=japanModelCoverageApi('model');
  for(const value of [undefined,null,'https://avtocena.com'+api,api+'&page=1',api+'&private=1',
    api.replace('page=1','page=2'),api.replace('model=A4','model=A4+AVANT'),
    api.replace('market=japan','market=china'),api.replace('make=AUDI','make=TOYOTA'),
    japanModelCoverageApi('models')+'&model=A4'])assert.equal(japanModelCoverageApiAllowed(value),false);
  for(const options of [{page:2},{make:'TOYOTA'},null,[]])assert.throws(()=>japanModelCoverageApi('model',options));
});

test('bounded model selection allows an honest unknown total and rejects zero, fabricated totals, and census claims',()=>{
  assert.deepEqual(verifyJapanModelCount(page()),{exact:false,countHonest:true});
  const exhausted={...page(),items:[row('one')],received:1,hasMore:false,total:1,
    countSummary:{total:1,upperBound:false,stale:false,observedAt}};
  assert.deepEqual(verifyJapanModelCount(exhausted),{exact:true,countHonest:true});
  for(const bad of [
    {...page(),total:0}, {...page(),total:700,countSummary:{total:700,upperBound:false}},
    {...page(),countSummary:{total:24,upperBound:false}}, {...exhausted,total:2},
    {...exhausted,countSummary:{...exhausted.countSummary,stale:true}},
    {...exhausted,countSummary:{...exhausted.countSummary,countProof:{complete:true}}},
    {...exhausted,reads:2},{...exhausted,received:24},
    {...exhausted,countSummary:{...exhausted.countSummary,observedAt:new Date(now).toISOString()}},
  ])assert.throws(()=>verifyJapanModelCount(bad));
});

test('separate loaded metadata permits the new uncertainty label only under the explicit incremental profile',()=>{
  const badge={status:'partial',loadedCount:'24',exactCount:null,text:'Количество уточняется'};
  const options={loaded:24,total:null,hasMore:true,countAcceptance:policy};
  assert.equal(verifyJapanPriceSortCount(badge,options).supplierCountNotPresentedAsExact,true);
  assert.throws(()=>verifyJapanPriceSortCount(badge,{loaded:24,total:null,hasMore:true}));
  assert.equal(verifyJapanPriceSortCount({...badge,text:'Загружено 24 · количество уточняется'},
    {loaded:24,total:null,hasMore:true}).visible,true);
  for(const [value,config] of [
    [{...badge,loadedCount:'23'},options],[{...badge,exactCount:'24'},options],
    [badge,{...options,total:123}],[{...badge,text:'24'},options],
    [{...badge,status:'exact',exactCount:'999',text:'999'},{...options,total:999}],
    [badge,{...options,countAcceptance:'other'}],[badge,{...options,requireExactCount:true}],
  ])assert.throws(()=>verifyJapanPriceSortCount(value,config));
});

test('exhausted power pages remain honestly uncounted only in the incremental profile',()=>{
  const value={...page(),hasMore:false,nextCursor:null};
  assert.throws(()=>verifyJapanPowerPage(value));
  assert.equal(verifyJapanPowerPage(value,1,{countAcceptance:policy}).countHonest,true);
  assert.throws(()=>verifyJapanPowerPage({...value,total:24,countSummary:{total:24,upperBound:false}},1,{countAcceptance:policy}));
  assert.throws(()=>verifyJapanPowerPage({...value,items:[{...row('bad'),powerHp:200}]},1,{countAcceptance:policy}));
});

test('fresh petrol source pages retain partial selection status with complete finite receipts, including cache hits',()=>{
  const value=scoped(),options={query:petrol,countAcceptance:policy,now};
  const proof=verifyJapanSourceScopePage(value,options);
  assert.deepEqual(proof,{partial:true,selectionComplete:false,limitation:'source_scope_unproven',
    freshSourcePages:1,sourcePagesComplete:true,fullSelectionExhaustionClaimed:false});
  assert.equal(value.sourceReceipts[0].supplierAttempted,false,'cache hit freshness uses original source date');
  const accepted=verifyJapanPage(value,200,now,options);
  assert.equal(accepted.partial,true);assert.equal(accepted.selectionComplete,false);
  assert.equal(accepted.total,null);assert.equal(verifyJapanFullPage(value,options).fullSelectionExhaustionClaimed,false);
  assert.throws(()=>verifyJapanPage(value,200,now));
  assert.throws(()=>verifyJapanFullPage(value));
  const second={...value,page:2,hasMore:false,nextCursor:null,items:[row('last')]};
  const query=petrol.replace('page=1','page=2')+'&after='+encodeURIComponent(cursor);
  assert.equal(verifyJapanSourceScopePage(second,{...options,query}).selectionComplete,false);
});

test('source-selection limitation cannot conceal failures, missing receipts, wrong queries or incomplete visible pages',()=>{
  const options={query:petrol,countAcceptance:policy,now};
  const mutations=[
    p=>{p.selectionIncomplete=true;},p=>{p.stale=true;},p=>{p.interrupted=true;},p=>{p.scanLimited=true;},
    p=>{p.total=0;},p=>{p.countSummary={total:0,upperBound:false};},p=>{p.reads=2;},p=>{p.reads=9;},
    p=>{p.sourceReceipts=[];},p=>{p.sourceReceipts[0].outcome='partial';},p=>{p.sourceReceipts[0].outcome='stale';},
    p=>{p.sourceReceipts[0].reason='http_503';},p=>{p.sourceReceipts[0].observedAt=new Date(now-31*60000).toISOString();},
    p=>{p.observedAt=new Date(now-4000).toISOString();},p=>{p.sourceReceipts[0].kind='models';},
    p=>{p.sourceReceipts[0].table='main';},p=>{p.sourceReceipts[0].pageSize=48;},
    p=>{p.items=p.items.slice(0,23);},p=>{p.nextCursor=null;},p=>{p.hasMore=false;},
    p=>{p.sourceReceipts.push(p.sourceReceipts[0]);p.reads=2;},
  ];
  for(const mutate of mutations){const value=scoped();mutate(value);assert.throws(()=>verifyJapanSourceScopePage(value,options));}
  for(const query of [undefined,petrol.replace('fuel=petrol','fuel=diesel'),petrol.replace('market=japan','market=china'),
    petrol.replace('powerTo=160','powerTo=170'),petrol+'&make=AUDI',petrol+'&fuel=petrol',
    petrol.replace('page=1','page=2'),'https://other.test'+petrol])
    assert.throws(()=>verifyJapanSourceScopePage(scoped(),{...options,query}));
  assert.throws(()=>verifyJapanSourceScopePage(scoped(),{...options,countAcceptance:undefined}));
});

test('only the existing exact grade-five petrol automatic power combination may use the same fresh receipt proof',()=>{
  const query=japanStabilitySearchApi('combined'),options={query,countAcceptance:policy,now};
  const value={...scoped(),items:scoped().items.map(item=>({...item,auctionGrade:'5',transmission:'automatic'}))};
  assert.equal(verifyJapanSourceScopePage(value,options).sourcePagesComplete,true);
  assert.equal(verifyJapanPage(value,200,now,options).selectionComplete,false);
  assert.equal(verifyJapanFullPage(value,options).fullSelectionExhaustionClaimed,false);
  assert.equal(verifyJapanPowerPage(value,1,{countAcceptance:policy}).countHonest,true);
  assert.equal(verifyJapanStabilityCombinedRows(value).shown,24);
  for(const changed of [
    query.replace('auctionGrade=5','auctionGrade=4'),query.replace('transmission=automatic','transmission=manual'),
    query.replace('fuel=petrol','fuel=diesel'),query.replace('powerTo=160','powerTo=170'),
    query.replace('page=1','page=2'),query.replace('&auctionGrade=5',''),query.replace('&transmission=automatic',''),
    query+'&after='+encodeURIComponent(cursor),query+'&make=AUDI',query+'&auctionGrade=5',
  ])assert.throws(()=>verifyJapanSourceScopePage(value,{...options,query:changed}));
  assert.throws(()=>verifyJapanSourceScopePage({...value,sourceReceipts:[]},options));
  assert.throws(()=>verifyJapanSourceScopePage({...value,sourceReceipts:[{...receipt(),outcome:'stale'}]},options));
  assert.throws(()=>verifyJapanSourceScopePage({...value,interrupted:true},options));
  for(const patch of [{auctionGrade:'4'},{transmission:'manual'},{fuel:'diesel'}])
    assert.throws(()=>verifyJapanStabilityCombinedRows({...value,items:[{...value.items[0],...patch}]}));
});

test('missing required preceding gates or conflicting exact mode cannot start incremental acceptance',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'japan-model-options-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const base={codeScope:JAPAN_STABILITY_CODE_SCOPE,requireModelCoverage:true,requirePowerOrder:true,
    requireBrandDirectory:true,requirePriceSort:true,requireExactCount:false,timingPolicy:JAPAN_OBSERVED_TIMING_POLICY};
  const changes=[{requireModelCoverage:'1'},{requirePowerOrder:false},{requireBrandDirectory:false},
    {requirePriceSort:false},{requireExactCount:true},{timingPolicy:undefined},{codeScope:'catalog-japan-recovery-v1'}];
  for(const [index,change] of changes.entries()){
    const report=await runJapanBrowserAcceptance({...base,...change,outputFile:path.join(directory,index+'.json')});
    assert.equal(report.passed,false);assert.equal(report.error.stage,'preconditions');
    assert.equal(report.explicitJapanApiRequests,0);assert.notEqual(report.japanModelCoveragePassed,true);
  }
});

const fixture=()=>({passed:true,productionRequests:0,supplierRequests:0,forbiddenTransportAttempts:0,
  cases:['preserved_controls','remounted_controls'].map(name=>({name,incrementalModelCoverage:{passed:true,
    countAcceptance:policy,japanModelCoverageRequired:true,japanModelCoveragePassed:true,
    japanExactCountRequired:false,japanExactCountPassed:null,positiveExactCountsSupplied:0,countsIncomplete:true,
    directoryWait:{delayedResponses:1,completedDelays:1,cardFallbackOptionsBeforeDirectory:24},
    modelCoverage:{sourcePairs:94,accessiblePairs:94,allSourceModelsAccessible:true,noForeignModels:true,
      make:'AUDI',coverageContract:'directory-and-visible-cards-v1',optionPairs:95,cardBackedExtraPairs:1,
      visibleCardPairs:24,uiEqualsDirectory:false,allOptionsSourceBacked:true,optionPairsSha256:'e'.repeat(64),
      cardBackedExtraPairsSha256:'f'.repeat(64),visibleCardPairsSha256:'a'.repeat(64),cardProvenanceSha256:'b'.repeat(64),
      sourceMatchesUi:true,pairsSha256:'d'.repeat(64),typedBase:'A4',typedFamilyNotNarrowed:true,
      modelExpansions:1,sourceFamilyModels:30,directory:{status:200,stale:false,sourcePairs:94,pairsSha256:'d'.repeat(64),browserMatchesApi:true},
      selection:{shown:24,observedSourceNamesOnly:true},fullPage:true,countHonest:true,explicitApiReads:3,
      liveExhaustiveScan:false,pageErrors:0,checks:['make','model'].map(kind=>({kind,count:{exact:false,countHonest:true},
        total:null,countStatus:'partial',uiMatchesApi:true,rowOrderMatchesApi:true}))}}}))});

test('offline model-only fixture proof requires both full UI lifecycle cases and no supplied positive total',()=>{
  assert.equal(checkedJapanModelCoverageBrowserFixture(fixture()).exactCountAccepted,false);
  for(const mutate of [
    p=>{p.positiveExactCountsSupplied=1;},p=>{p.japanExactCountPassed=true;},p=>{p.countsIncomplete=false;},
    p=>{p.modelCoverage.sourceMatchesUi=false;},p=>{p.modelCoverage.accessiblePairs=60;},
    p=>{p.modelCoverage.modelExpansions=0;},p=>{p.modelCoverage.directory.stale=true;},
    p=>{p.modelCoverage.checks[0].count.exact=true;},p=>{p.modelCoverage.checks[1].total=94;},
    p=>{delete p.modelCoverage.coverageContract;},p=>{p.modelCoverage.optionPairs=94;},
    p=>{p.modelCoverage.cardBackedExtraPairs=0;},p=>{p.modelCoverage.cardBackedExtraPairs=25;},
    p=>{p.modelCoverage.visibleCardPairs=0;},p=>{p.modelCoverage.uiEqualsDirectory=true;},
    p=>{p.modelCoverage.allOptionsSourceBacked=false;},p=>{p.modelCoverage.cardProvenanceSha256='';},
    p=>{p.modelCoverage.optionPairsSha256=p.modelCoverage.pairsSha256;},
    p=>{p.modelCoverage.directory.browserMatchesApi=false;},p=>{delete p.directoryWait;},
    p=>{p.directoryWait.cardFallbackOptionsBeforeDirectory=0;},p=>{p.directoryWait.completedDelays=0;},
  ]){const report=fixture();mutate(report.cases[0].incrementalModelCoverage);assert.throws(()=>checkedJapanModelCoverageBrowserFixture(report));}
  assert.throws(()=>checkedJapanModelCoverageBrowserFixture({...fixture(),cases:fixture().cases.slice(0,1)}));
});
