import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
import {DatabaseSync} from 'node:sqlite';
import {AjesUnavailable} from '../apps/web/lib/catalog/ajes-client';
import {ajesCatalogQuery,ajesQuery,AjesCursorRefreshRequired} from '../apps/web/lib/catalog/ajes-query';
import {resolveAjesQueryModels} from '../apps/web/lib/catalog/ajes-model-resolution';
import {resolveAjesMakeSelection} from '../apps/web/lib/catalog/ajes-make-resolution';
import {readFilteredAjesPage,readPowerOrderedAjesPage,ajesPowerEvidenceEpoch,assertAjesPowerCursorEpoch} from '../apps/web/lib/catalog/ajes-filtered-page';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {japanLocalPowerHp,japanSupplierPower,japanUnknownPower,japanPowerFilterSummary} from '../apps/web/lib/catalog/japan-source-power';
import {createAjesSourceCountSummary} from '../apps/web/lib/catalog/ajes-source-count';

type DirectoryState='fresh'|'stale'|'missing';
const city='Новокузнецк',params={market:'japan',make:'Audi',model:'A4',city};
const sourceText=readFileSync(new URL('../apps/web/lib/catalog/ajes-catalog.ts',import.meta.url),'utf8');
const start=sourceText.indexOf('export async function readAjesCatalogPage('),end=sourceText.indexOf('/** Add once to totals',start);
assert(start>=0&&end>start);
const pageBody=stripTypeScriptTypes(sourceText.slice(start,end).replace(/^export /,''),{mode:'transform'});
const cursorStart=sourceText.indexOf(' const cursorQuery=',start),cursorEnd=sourceText.indexOf('\n const initial=',cursorStart);
assert(cursorStart>start&&cursorEnd>cursorStart);
const cursorKey=new Function('query','params','evidenceEpoch','pricingContext',sourceText.slice(cursorStart,cursorEnd)+'\nreturn cursorQuery;');
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const powerHash=(query:unknown,input:unknown,epoch:string)=>digest([24,cursorKey(query,input,epoch),'japan-known-before-unknown-v1']);
const forbidIdentity=async()=>{throw Error('Audi must not require a legacy identity lookup');};

async function resolve(input:Record<string,any>,state:DirectoryState,names:string[]){
 return resolveAjesQueryModels(input,async()=>{
  if(state==='missing')throw new AjesUnavailable('local_busy');
  return {models:names.map(model=>({model})),stale:state==='stale'};
 },forbidIdentity);
}

test('the two observed production hashes differ only by the literal family predicate, now stable across directory states',async()=>{
 const epoch='988d991b330f62f40bcdd370c2aa5124d917508c76d40dfcd19b655fa22e5633';
 const input={...params,powerTo:'160'},query={table:'stats',page:1,pageSize:24,make:'AUDI',model:'A4',powerTo:160};
 assert.equal(powerHash(query,input,epoch),'d8853530d80def143c839e86392a07eae1425f73308fc4e35d93245ce812ebf5');
 assert.equal(powerHash({...query,modelFamilies:'A4'},input,epoch),'a91eb222ac7db401d0c0a6006fb7e714a1587fbdb50ba7b52b0c585ba3efe51a');
 const results=[];
 for(const state of ['fresh','stale','missing','fresh'] as const){
  const result=await resolve(query,state,['A4']);results.push(result);
  assert.equal(result.modelDirectoryUnavailable,state!=='fresh');
  assert.equal(powerHash(result.query,input,epoch),'a91eb222ac7db401d0c0a6006fb7e714a1587fbdb50ba7b52b0c585ba3efe51a');
 }
 assert.equal(new Set(results.map(result=>ajesQuery(result.query as any).sql)).size,1);
 assert.equal(new Set(results.map(result=>ajesQuery({...result.query,aggregate:'count'} as any).sql)).size,1);
});

test('case-only directory spellings and lowercased typed literals use the same SQL and cursor identity',async()=>{
 const outputs=[];
 for(const model of ['A4','a4',' a4 '])for(const state of ['fresh','stale','missing'] as const)for(const spelling of ['A4','a4']){
  const input={...params,model,powerTo:'160'},query={...ajesCatalogQuery(input),make:'AUDI'};
  const result=await resolve(query,state,[spelling]);
  assert.equal(result.query.model,'A4');assert.equal(result.query.modelFamilies,'A4');
  assert.equal(result.modelDirectoryUnavailable,state!=='fresh');
  outputs.push([ajesQuery(result.query as any).sql,powerHash(result.query,input,'e'.repeat(64))]);
 }
 assert.equal(new Set(outputs.map(([sql])=>sql)).size,1);
 assert.equal(new Set(outputs.map(([,hash])=>hash)).size,1);
});

function fixture(t:any,size=96){
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.function('regexp',(pattern:any,value:any)=>value==null?0:Number(new RegExp(String(pattern),'i').test(String(value))));
 db.exec('create table stats(id text,year integer,auction_type integer,status text,finish integer,marka_name text,model_name text,grade text,auction_date text,power integer,pw text)');
 const insert=db.prepare('insert into stats values(?,?,?,?,?,?,?,?,?,?,?)');
 const seeded:Array<{id:string;model:string;powerHp:number|null}>=[];
 for(let index=0;index<size;index++){
  const model=['A4','A4 AVANT','A4 ALLROAD QUATTRO'][index%3],powerHp=[120,150,200,null][index%4],id='row-'+String(index).padStart(4,'0');
  // This cursor fixture uses locally known power and absent source PW.
  insert.run(id,2021,2,'Sold',120000,'AUDI',model,'','2026-11-27',powerHp,null);
  seeded.push({id:'ajes-stats-'+id,model,powerHp});
 }
 const state={directory:'fresh' as DirectoryState,directoryNames:null as string[]|null,revision:'literal-cursor-fixture',
  reads:[] as any[],countReads:0,transform:(result:any,_query:any)=>result};
 const snapshot=()=>({editorial:{revision:state.revision,entries:{}},calculationIndex:null});
 const resolveQuery=async(input:Record<string,unknown>)=>{
  const query=ajesCatalogQuery(input);
  Object.assign(query,resolveAjesMakeSelection(query.make!,[{make:'AUDI'}]));
  const names=state.directoryNames??db.prepare('select distinct model_name from stats order by model_name').all().map(row=>String(row.model_name));
  return {...await resolve(query,state.directory,names),makeDirectoryUnavailable:false};
 };
 const bindings={
  readAjesSourceSelection:async(query:any)=>({query,selectionIncomplete:false,sourceScopeComplete:true}),
  process:{env:{AVTOCENA_RELEASE_SHA:'a'.repeat(40)}},assertAjesJapanMarket:(market:unknown)=>assert.equal(market,'japan'),
  ajesResultFilter,readAjesPublicEvidenceSnapshot:async()=>snapshot(),
  captureAjesCountPricingContext:async()=>{throw Error('no price filter in this fixture');},
  ajesPowerEvidenceEpoch,assertAjesPowerCursorEpoch,ajesCatalogQuery,AjesCursorRefreshRequired,
  japanLocalPowerHp,japanSupplierPower,japanUnknownPower,japanPowerFilterSummary,
  resolvedCatalogQuery:async(key:string)=>resolveQuery(JSON.parse(key)),ajesSourceScopeSupportsExactCount:()=>true,
  parseCatalogSort:(sort?:string)=>sort?sort.split(','):[],
  readAjesCountSummary:async(key:string)=>{
   state.countReads++;const resolved=await resolveQuery(JSON.parse(key));
   const sql=ajesQuery({...resolved.query,aggregate:'count'} as any).sql,total=Number(db.prepare(sql).get()!['count(*)']);
   return createAjesSourceCountSummary({total,stale:false,observedAt:new Date().toISOString()},
    {requestedQueryHash:digest(JSON.parse(key)),sourceQueryHash:createHash('sha256').update(sql).digest('hex'),evidenceEpoch:'c'.repeat(64),
     sourceScopeComplete:!resolved.modelDirectoryUnavailable,directoryComplete:!resolved.modelDirectoryUnavailable});
  },
  readAjesPublic:async(query:any)=>{
   state.reads.push(structuredClone(query));const rows=db.prepare(ajesQuery(query).sql).all();
   return state.transform({items:rows.map(row=>({id:'ajes-stats-'+row.id,market:'japan',make:row.marka_name,model:row.model_name,
    powerHp:row.power,fuel:'petrol'})),received:rows.length,observedAt:new Date().toISOString(),stale:false,partial:false},query);
  },
  safePublicPricing:(row:any)=>row,hasEncyclopediaCalculationEvidence:()=>false,japanPreviewParameters:()=>({}),
  applyActiveBusinessPricingBatch:async(rows:any[])=>rows,readFilteredAjesPage,readPowerOrderedAjesPage,
  sortCatalogRows:(rows:any[])=>rows,withCatalogEditorialSnapshot:async(_snapshot:unknown,work:()=>Promise<any>)=>work(),publicOffer:(row:any)=>row,
 };
 const readPage=new Function(...Object.keys(bindings),pageBody+'\nreturn readAjesCatalogPage;')(...Object.values(bindings));
 return {state,db,seeded,readPage};
}

for(const power of [false,true])test(`${power?'power160':'ordinary'} continuation survives fresh, stale, missing and recovered literal directories without changing IDs or order`,async t=>{
 const {state,seeded,readPage}=fixture(t),input={...params,...(power?{powerTo:'160'}:{})};
 const expected=power?[...seeded.filter(row=>row.powerHp!==null&&row.powerHp<=160),...seeded.filter(row=>row.powerHp===null)]:seeded;
 const actual:any[]=[];let after:string|undefined;
 for(let page=1;page<=8;page++){
  state.directory=(['fresh','stale','missing','fresh'] as const)[Math.min(page-1,3)];
  const result=await readPage({...input,...(page>1?{page:String(page),after,marketPage:'1'}:{})},undefined,{includeCount:page>1});
  assert.equal(result.selectionIncomplete,state.directory!=='fresh');
  assert.equal(result.partial,state.directory!=='fresh');assert.equal(result.stale,false);
  assert.equal(result.total,null);assert(result.reads<=8);actual.push(...result.items);
  if(result.countSummary){assert.equal(result.countSummary.upperBound,true);assert.equal(result.countSummary.sourceScopeComplete,true);assert.equal(result.countSummary.total,seeded.length);}
  else if(state.directory!=='fresh')assert.equal(result.countSummary,null);
  if(!result.hasMore){assert.equal(result.nextCursor,null);break;}
  assert(result.nextCursor);after=result.nextCursor;
  assert(page<8,'the finite fixture must exhaust without an unbounded walk');
 }
 assert.deepEqual(actual.map(row=>row.id),expected.map(row=>row.id));
 assert.equal(new Set(actual.map(row=>row.id)).size,expected.length);
 const sourceSql=state.reads.map(query=>ajesQuery({...query,page:1} as any).sql);
 assert.equal(new Set(sourceSql).size,1,'metadata availability never changes the source membership or ordering');
 assert(state.countReads>0,'a later scalar observation still does not invalidate the first cursor');
});

test('a selected literal variant preserves its own namespace and excludes sibling models in every directory state',async t=>{
 const {db}=fixture(t),query={table:'stats',page:1,pageSize:48,make:'AUDI',model:'A4 AVANT'};
 for(const state of ['fresh','stale','missing'] as const){
  const result=await resolve(query,state,['A4','A4 AVANT','A4 AVANT S LINE','A4 ALLROAD QUATTRO']);
  assert.equal(result.query.model,'A4 AVANT');assert.equal(result.query.modelFamilies,'A4 AVANT');
  const rows=db.prepare(ajesQuery(result.query as any).sql).all();assert(rows.length>0);
  assert(rows.every(row=>row.model_name==='A4 AVANT'));assert.equal(result.modelDirectoryUnavailable,state!=='fresh');
 }
});

test('equivalent directory permutations preserve every nonliteral source spelling and the same cursor binding',async()=>{
 const names=['A4','A4 AVANT','A4-AVANT','A4L','A  4 ALLROAD','Ａ４ CABRIOLET'];
 const query={table:'stats',page:1,pageSize:24,make:'AUDI',model:'A4',powerTo:160},input={...params,powerTo:'160'};
 const first=await resolve(query,'fresh',names),stale=await resolve(query,'stale',[...names].reverse());
 assert.deepEqual(first.query,stale.query);assert.equal(stale.modelDirectoryUnavailable,true);
 for(const name of ['A4-AVANT','A4L','A  4 ALLROAD','Ａ４ CABRIOLET'])assert(first.query.model!.split('|').includes(name),name);
 assert.equal(powerHash(first.query,input,'e'.repeat(64)),powerHash(stale.query,input,'e'.repeat(64)));
 const large=['A4',...Array.from({length:26},(_,index)=>'A4'+String.fromCharCode(65+index))];
 const left=await resolve(query,'fresh',large),right=await resolve(query,'stale',[...large].reverse());
 assert.deepEqual(left.query,right.query);assert.deepEqual(left.query.resolvedModels?.exact,[...large].sort());
 assert.deepEqual(left.query.resolvedModels?.families,['A4']);
});

test('new, lost or recovered nonliteral aliases still require refresh before a source LIST',async t=>{
 const {state,db,readPage}=fixture(t);
 db.prepare('insert into stats values(?,?,?,?,?,?,?,?,?,?,?)').run('zz-alias',2021,2,'Sold',120000,'AUDI','A4L','','2026-11-27',150,null);
 for(const [before,after] of [['literal','alias'],['alias','literal'],['alias','missing']] as const){
  state.directory='fresh';state.directoryNames=before==='alias'?['A4','A4 AVANT','A4L']:['A4','A4 AVANT'];
  const first=await readPage({...params,powerTo:'160'},undefined,{includeCount:false});assert(first.nextCursor);
  const reads=state.reads.length;state.directory=after==='missing'?'missing':'fresh';
  state.directoryNames=after==='alias'?['A4','A4 AVANT','A4L']:['A4','A4 AVANT'];
  await assert.rejects(readPage({...params,powerTo:'160',page:'2',after:first.nextCursor},undefined,{includeCount:false}),AjesCursorRefreshRequired);
  assert.equal(state.reads.length,reads);
 }
});

test('changed filters, city, local epoch and consumed source membership retain their cursor protection',async t=>{
 const {state,readPage}=fixture(t),input={...params,powerTo:'160'};
 const first=await readPage(input,undefined,{includeCount:false});
 for(const patch of [{powerTo:'150'},{city:'Кемерово'},{model:'A4 AVANT'}]){
  const reads=state.reads.length;
  await assert.rejects(readPage({...input,...patch,page:'2',after:first.nextCursor},undefined,{includeCount:false}),AjesCursorRefreshRequired);
  assert.equal(state.reads.length,reads);
 }
 state.revision='changed';const reads=state.reads.length;
 await assert.rejects(readPage({...input,page:'2',after:first.nextCursor},undefined,{includeCount:false}),AjesCursorRefreshRequired);
 assert.equal(state.reads.length,reads);state.revision='literal-cursor-fixture';
 state.transform=(result:any)=>({...result,partial:true,items:result.items.filter((row:any)=>row.powerHp>0&&row.powerHp<=160).slice(0,3)});
 const partial=await readPage(input,undefined,{includeCount:false});assert.equal(partial.items.length,3);assert.match(partial.nextCursor,/^j2\.k\.1\.3\.2\./);
 state.transform=(result:any)=>({...result,partial:true,items:result.items.filter((row:any)=>row.powerHp>0&&row.powerHp<=160).slice(1,4)});
 await assert.rejects(readPage({...input,page:'2',after:partial.nextCursor},undefined,{includeCount:false}),AjesCursorRefreshRequired);
});

test('stable literal predicates do not turn incomplete metadata into an exact small total',async t=>{
 const {state,readPage}=fixture(t,1);
 const fresh=await readPage(params,undefined,{includeCount:false});assert.equal(fresh.total,1);assert.equal(fresh.countSummary.upperBound,false);
 for(const directory of ['stale','missing'] as const){
  state.directory=directory;const page=await readPage(params,undefined,{includeCount:false});
  assert.equal(page.items.length,1);assert.equal(page.selectionIncomplete,true);assert.equal(page.partial,true);
  assert.equal(page.stale,false);assert.equal(page.total,null);assert.equal(page.countSummary,null);
 }
});
