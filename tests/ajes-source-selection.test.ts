import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
const require=createRequire(import.meta.url);
const now=Date.parse('2026-11-28T12:00:00Z');
const fact={modelId:'test',variantId:'one',revision:'one',year:2021,trims:['test'],constraints:{},
 values:{powerHp:150,bodyType:'suv'},sources:{powerHp:{kind:'manual'},bodyType:{kind:'manual'}}};
const snapshot={editorial:{revision:'one',entries:{}},calculationIndex:{version:1,digest:'a'.repeat(64),manifestDigest:'b'.repeat(64),createdAt:new Date(now).toISOString(),models:{'toyota:test':[fact]}}};

async function fixture(){
 const state={calls:[] as any[],savedReads:0,sourceFields:undefined as string[]|undefined,stale:false,
  observedAt:new Date(now).toISOString(),models:[{make:'TOYOTA',model:'T E S T',total:100}],failure:null as Error|null};
 (globalThis as any).__selectionClient={
  read:async(query:any)=>{state.calls.push(query);if(state.failure)throw state.failure;
   assert.equal(query.aggregate,'models','selection planning reads names, never vehicle LISTs');
   const models=state.models.slice((query.page-1)*500,query.page*500);
   return {models,received:models.length,page:query.page,pageSize:500,stale:state.stale,observedAt:state.observedAt};},
  readSavedSourceFields:async()=>{state.savedReads++;return state.sourceFields;},
 };
 const compiled=await build({entryPoints:['apps/web/lib/catalog/ajes-source-selection.ts'],bundle:true,platform:'node',format:'cjs',write:false,
  plugins:[{name:'offline-adapters',setup(b){
   b.onResolve({filter:/^(server-only|next\/headers)$|^\.\/ajes-runtime$/},args=>({path:args.path,namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='server-only'?'':args.path==='next/headers'
    ?"export const headers=async()=>({get:()=> '198.51.100.10'});"
    :'export const ajesClient=globalThis.__selectionClient;'}));
  }}]});
 const mod={exports:{} as any};new Function('require','module','exports',compiled.outputFiles[0].text)(require,mod,mod.exports);
 delete (globalThis as any).__selectionClient;
 return {state,read:mod.exports.readAjesSourceSelection};
}

test('source selection resolves every permitted directory page before narrowing known-power candidates',async t=>{
 t.mock.method(Date,'now',()=>now);
 const {state,read}=await fixture();
 state.models=[...Array.from({length:500},(_,i)=>({make:'TOYOTA',model:'OTHER '+i,total:1})),{make:'TOYOTA',model:'T E S T',total:100}];
 const query={table:'stats',powerTo:160,sort:'totalRubDesc',page:1,pageSize:24};
 const result=await read(query,{powerTo:'160'},snapshot);
 assert.equal(result.selectionIncomplete,false);assert.equal(result.sourceScopeComplete,true);
 assert.deepEqual(state.calls.map(q=>q.page),[1,2]);assert.equal(state.savedReads,0);
 assert.ok(state.calls.every(q=>q.powerTo===undefined&&q.sort===undefined));
 const sql=ajesQuery({...result.query,sourcePhase:'k'}).sql;
 assert.match(sql,/marka_name like '%TOYOTA%' and model_name like '%T E S T%' and year=2021/);assert.match(sql,/pw<=160/);assert.match(sql,/order by finish desc/);
 assert.equal(query.powerTo,160);assert.equal('sourceSelection' in query,false,'cached source query is never mutated');
 const again=await read(query,{powerTo:'160'},snapshot);
 assert.deepEqual(again.query,result.query);assert.equal(state.calls.length,2,'complete fresh names are reused without LIST reads');
});

test('a body selection without observed source schema retains verified candidates and reports incomplete scope',async t=>{
 t.mock.method(Date,'now',()=>now);
 const {state,read}=await fixture();
 const result=await read({table:'stats',powerTo:160,page:1,pageSize:24},{bodyType:'suv',powerTo:'160'},snapshot);
 assert.equal(result.selectionIncomplete,false);assert.equal(result.sourceScopeComplete,false);
 assert.ok(result.query.sourceSelection.body);assert.equal(state.savedReads,1);
 const sql=ajesQuery({...result.query,sourcePhase:'k'}).sql;
 assert.match(sql,/marka_name like '%TOYOTA%' and model_name like '%T E S T%' and year=2021/);assert.doesNotMatch(sql,/body_type/);
});

test('an already observed body field opens the nonempty source body branch without a schema fetch',async t=>{
 t.mock.method(Date,'now',()=>now);
 const {state,read}=await fixture();state.sourceFields=['BODY_TYPE','PW'];
 const result=await read({table:'stats',page:1,pageSize:24},{bodyType:'suv'},snapshot);
 assert.equal(result.sourceScopeComplete,true);assert.equal(state.calls.length,1);assert.equal(state.savedReads,1);
 assert.match(ajesQuery(result.query).sql,/body_type is not null/);
});

test('directory reuse expires from its source observation, not from the selection request',async t=>{
 let clock=now;t.mock.method(Date,'now',()=>clock);
 const {state,read}=await fixture();state.observedAt=new Date(now-29*60000).toISOString();
 const query={table:'stats',powerTo:160,page:1,pageSize:24};
 await read(query,{powerTo:'160'},snapshot);clock=now+60001;
 state.observedAt=new Date(clock).toISOString();await read(query,{powerTo:'160'},snapshot);
 assert.equal(state.calls.length,2,'the source directory must refresh after its original thirty-minute expiry');
});

test('retained partial names keep the established query and cannot certify a narrowed known-power sequence',async t=>{
 t.mock.method(Date,'now',()=>now);
 const {state,read}=await fixture();state.stale=true;
 const query={table:'stats',powerTo:160,page:1,pageSize:24};
 const result=await read(query,{powerTo:'160'},snapshot);
 assert.equal(result.query,query);assert.equal(result.selectionIncomplete,true);assert.equal(result.sourceScopeComplete,false);
 assert.equal(state.calls.length,1);assert.equal(state.savedReads,0);
});

test('a complete retained directory preserves the issued selection through a later partial refresh without extending freshness',async t=>{
 let clock=now;t.mock.method(Date,'now',()=>clock);
 const {state,read}=await fixture();
 const query={table:'stats',powerTo:160,page:1,pageSize:24};
 const fresh=await read(query,{powerTo:'160'},snapshot);
 clock+=31*60000;state.stale=true;state.models=[];
 const retained=await read(query,{powerTo:'160'},snapshot);
 assert.deepEqual(retained.query,fresh.query,'a metadata outage cannot silently change the K/U cursor selection');
 assert.equal(retained.selectionIncomplete,true);assert.equal(retained.sourceScopeComplete,false);
 clock=now+7*86400000;
 const expired=await read(query,{powerTo:'160'},snapshot);
 assert.equal(expired.query,query,'seven-day metadata cannot be resurrected or given a new observation date');
 assert.equal(expired.selectionIncomplete,true);
});

test('unfiltered Japan leaves source requests and metadata work unchanged',async()=>{
 const {state,read}=await fixture();const query={table:'stats',page:1,pageSize:24};
 const result=await read(query,{},snapshot);
 assert.equal(result.query,query);assert.equal(state.calls.length,0);assert.equal(state.savedReads,0);
});
