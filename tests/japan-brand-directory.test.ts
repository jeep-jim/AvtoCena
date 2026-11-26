import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createAjesClient,readAjesMakeDirectory} from '../apps/web/lib/catalog/ajes-client';
import {ajesQuery,ajesSourceCacheSql} from '../apps/web/lib/catalog/ajes-query';
import {heavyVehicleSqlExclusion} from '../apps/web/lib/catalog/heavy-vehicle-families';
import {ajesQueryCacheLocation} from '../apps/web/lib/catalog/ajes-query-cache';
import {isJapanBrandDirectoryContext,parseJapanBrandDirectory,loadJapanBrandDirectory} from '../apps/web/lib/catalog/japan-brand-directory';

const ip='203.0.113.17',base={password:()=> 'fixture',assertEnabled:async()=>{},reserve:async()=>{}};
const names=['TOYOTA','NISSAN','HONDA','MAZDA','SUBARU','SUZUKI','DAIHATSU','LEXUS','MITSUBISHI','BMW','MERCEDES BENZ','AUDI','VOLKSWAGEN','VOLVO','PORSCHE','PEUGEOT','RENAULT','ASTON MARTIN'];
const rows=names.map(make=>({MARKA_NAME:make,TAG1:'12'}));
const sqlOf=(url:unknown)=>new URL(String(url)).searchParams.get('sql')!;
const isCount=(sql:string)=>sql.startsWith('select count(*)');
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
const snapshot=(patch:any={})=>({items:[],makes:names.map(make=>({make,total:12})),page:1,pageSize:500,received:names.length,rejected:0,stale:false,observedAt:new Date(Date.now()-3600000).toISOString(),...patch});
const payload=(makes=names)=>({makes,directoryComplete:true,generationId:new Date().toISOString(),stale:false,counts:{},modelCounts:{}});
async function deadline<T>(pending:Promise<T>){let timer:ReturnType<typeof setTimeout>;return Promise.race([pending,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('directory verification retained supplier slots')),2500);})]).finally(()=>clearTimeout(timer!));}

test('old fresh-looking empty make cache is refreshed into the complete directory, independently of a car page',async()=>{
 let calls=0;const empty=snapshot({makes:[],received:0,observedAt:new Date().toISOString()});
 const client=createAjesClient({...base,readQuery:async()=>empty,fetcher:async url=>{calls++;assert.match(sqlOf(url),/group by marka_name order by marka_name limit 0,500$/);return Response.json(rows);}});
 const directory=await readAjesMakeDirectory(client,{},ip);
 assert.equal(directory.complete,true);assert.equal(directory.stale,false);assert.deepEqual(directory.makes.map(row=>row.make),names);assert.equal(calls,1);
 assert.equal((await readAjesMakeDirectory(client,{},'203.0.113.18')).makes.length,names.length);assert.equal(calls,1);
});

test('unproved empty makes preserve the older complete directory and do not persist zero brands',async()=>{
 const saved=snapshot(),writes:Array<{sql:string;value:any}>=[];let lists=0,counts=0;
 const client=createAjesClient({...base,readQuery:async sql=>isCount(sql)?null:saved,saveQuery:async(sql,value)=>{writes.push({sql,value});},fetcher:async url=>isCount(sqlOf(url))?(counts++,Response.json([{total:660813}])):(lists++,Response.json([]))});
 const directory=await readAjesMakeDirectory(client,{},ip);await tick();
 assert.equal(directory.complete,true);assert.equal(directory.stale,true);assert.equal(directory.observedAt,saved.observedAt);assert.equal(directory.makes.length,names.length);
 assert.equal(writes.some(write=>!isCount(write.sql)&&write.value.makes?.length===0),false);
 assert.equal((await readAjesMakeDirectory(client,{},ip)).makes.length,names.length);assert.equal(lists,1);assert.equal(counts,1);
});

test('an empty make directory requires exact COUNT0 and retains its source-bound proof across restart',async t=>{
 const start=Date.now();t.mock.timers.enable({apis:['Date'],now:start});
 const values=new Map<string,any>(),sql=ajesSourceCacheSql(ajesQuery({aggregate:'makes'}).sql);let calls=0;
 const deps={...base,readQuery:async(key:string)=>values.get(key)??null,saveQuery:async(key:string,value:any)=>{values.set(key,value);}};
 const client=createAjesClient({...deps,fetcher:async url=>{calls++;return Response.json(isCount(sqlOf(url))?[{total:0}]:[]);}});
 assert.deepEqual((await readAjesMakeDirectory(client,{},ip)).makes,[]);await tick();
 assert.equal(values.get(sql).emptyPageEvidence.countTotal,0);assert.equal(calls,2);
 const restarted=createAjesClient({...deps,fetcher:async()=>{calls++;return new Response('unavailable',{status:503});}});
 assert.deepEqual((await readAjesMakeDirectory(restarted,{},ip)).makes,[]);assert.equal(calls,2);
 t.mock.timers.setTime(start+31*60000);
 await assert.rejects(readAjesMakeDirectory(restarted,{},ip),/http_503/,'expired proof is unavailable, not stale zero');assert.equal(calls,3);
});

test('unavailable COUNT and positive COUNT cannot validate an empty directory without useful saved names',async()=>{
 for(const count of [()=>Response.json([{total:1}]),()=>new Response('bot fixture')]){
  let calls=0;const client=createAjesClient({...base,fetcher:async url=>{calls++;return isCount(sqlOf(url))?count():Response.json([]);}});
  await assert.rejects(readAjesMakeDirectory(client,{},ip),/ajes_(?:empty_response|visitor_restricted)/);assert.equal(calls,2);
 }
});

test('complete make pagination retains every group and never compares a make offset with offer COUNT',async()=>{
 for(const finalRows of [[{MARKA_NAME:'RARE BRAND',TAG1:'1'}],[]]){
  let calls=0;const first=Array.from({length:500},(_,i)=>({MARKA_NAME:'BRAND '+String(i).padStart(3,'0'),TAG1:'2'}));
  const client=createAjesClient({...base,fetcher:async url=>{calls++;const sql=sqlOf(url);assert.equal(isCount(sql),false);return Response.json(sql.endsWith('limit 0,500')?first:finalRows);}});
  const directory=await readAjesMakeDirectory(client,{},ip);assert.equal(directory.complete,true);assert.equal(directory.makes.length,500+finalRows.length);assert.equal(calls,2);
 }
});

test('a partial or malformed stored directory cannot be labelled complete',async()=>{
 for(const patch of [{partial:true},{received:1}]){
  const client=createAjesClient({...base,readQuery:async()=>snapshot(patch),fetcher:async()=>new Response('unavailable',{status:503})});
  await assert.rejects(readAjesMakeDirectory(client,{},ip),/directory_incomplete/);
 }
});

test('two empty make queries release source admission before their exact count checks',async()=>{
 let release!:()=>void,started!:()=>void,active=0,peak=0,counts=0;
 const held=new Promise<void>(resolve=>release=resolve),twoCounts=new Promise<void>(resolve=>started=resolve);
 const client=createAjesClient({...base,fetcher:async url=>{active++;peak=Math.max(peak,active);try{if(isCount(sqlOf(url))){if(++counts===2)started();await held;return Response.json([{total:0}]);}await tick();return Response.json([]);}finally{active--;}}});
 const pending=[2008,2020].map(yearFrom=>readAjesMakeDirectory(client,{yearFrom},ip));
 try{await deadline(twoCounts);assert.equal(active,2);release();assert.ok((await Promise.all(pending)).every(result=>result.complete&&result.makes.length===0));assert.equal(peak,2);}
 finally{release();await Promise.allSettled(pending);}
});

test('make aggregate keeps the exact admitted source selection with the existing compact SQL identity',()=>{
 const query=ajesQuery({aggregate:'makes'}),canonical=ajesSourceCacheSql(query.sql),count=ajesSourceCacheSql(ajesQuery({aggregate:'count'}).sql);
 assert.equal(query.empty,false);assert.equal(query.pageSize,500);assert.ok(query.sql.includes(heavyVehicleSqlExclusion(false,false,true)));
 const where=canonical.slice(canonical.indexOf(' where ')+7,canonical.indexOf(' group by '));
 assert.equal(count,'select count(*) from stats where '+where);
 assert.ok(new URLSearchParams({sql:query.sql}).toString().length<6000);
 assert.match(ajesQueryCacheLocation(canonical).key,/\/directories\/makes-overall\.json$/);
 assert.equal(ajesQueryCacheLocation(query.sql).key,ajesQueryCacheLocation(canonical).key);
 assert.match(canonical,/year>=2008/);assert.match(canonical,/status='Sold'/);assert.match(canonical,/finish>0/);
});

test('Japan directory identity includes only source names and requires complete metadata',()=>{
 const result=parseJapanBrandDirectory(payload(['TOYOTA','Toyota','MERCEDES BENZ','WIESMANN']));
 assert.deepEqual(result.makes,['Mercedes-Benz','Toyota','WIESMANN']);assert.equal(result.complete,true);
 for(const value of [{counts:{TOYOTA:20}},{...payload(),directoryComplete:false},{...payload(),generationId:'invalid'},{...payload(),makes:['']}])assert.throws(()=>parseJapanBrandDirectory(value),/directory_invalid/);
 assert.deepEqual(parseJapanBrandDirectory(payload([])).makes,[]);
 assert.equal(isJapanBrandDirectoryContext('market=japan&fuel=petrol&powerTo=160'),true);
 for(const query of ['market=china','market=japan&stock=green','market=japan%7Cchina',''])assert.equal(isJapanBrandDirectoryContext(query),false);
});

test('rail and filter share one directory request; a failed refresh permits one explicit retry',async t=>{
 const start=Date.now();t.mock.timers.enable({apis:['Date'],now:start});let calls=0,fail=false;
 t.mock.method(globalThis,'fetch',async(input)=>{calls++;assert.equal(input,'/api/catalog/brand-counts?market=japan&directory=1');return fail?new Response('unavailable',{status:503}):Response.json(payload());});
 const [rail,filter]=await Promise.all([loadJapanBrandDirectory(),loadJapanBrandDirectory()]);assert.equal(calls,1);assert.deepEqual(rail.makes,filter.makes);assert.equal(rail.makes.length,names.length);
 t.mock.timers.setTime(start+31_000);fail=true;await assert.rejects(loadJapanBrandDirectory(),/unavailable/);assert.equal(calls,2);
 fail=false;assert.equal((await loadJapanBrandDirectory()).makes.length,names.length);assert.equal(calls,3);
});

test('the public full Japan directory strips list filters without changing other market brand counts',async()=>{
 const require=createRequire(import.meta.url),requests:any[]=[],other:any[]=[];
 (globalThis as any).__japanDirectoryRoute={requests,other};
 const stubs:Record<string,string>={
  'next/server':'export const NextResponse={json:(value,init)=>new Response(JSON.stringify(value),init)};',
  'next/headers':'export const cookies=async()=>({get:()=>undefined});',
  '@/lib/catalog/market-selection':'export const selectedCatalogMarkets=value=>value?[value]:[];export const marketSelectionUrl=()=>{throw Error("unexpected mixed market");};',
  '@/lib/catalog/ajes-market-selection':'export const usesAjesMarket=async market=>market==="japan";',
  '@/lib/catalog/ajes-catalog':`export const readAjesMakes=async key=>{globalThis.__japanDirectoryRoute.requests.push(JSON.parse(key));return {makes:${JSON.stringify(names.map(make=>({make,total:12})))},observedAt:'2026-11-26T11:00:00Z',stale:false,complete:true};};`,
  '@/lib/catalog/storage':'export const readCatalogBrandCounts=async params=>{globalThis.__japanDirectoryRoute.other.push(params);return {generationId:"other",counts:{BMW:2},modelCounts:{BMW:1}};};',
  '@/lib/catalog/editorial':'export const withCatalogEditorial=fn=>fn();export const applyCatalogEditorial=x=>x;export const editorialHidden=()=>false;',
  '@/lib/catalog/display-identity':'export const applyEncyclopediaDisplayIdentityBatch=async x=>x;',
  '@/lib/catalog/green-corner':'export const readGreenCorner=()=>{throw Error("must not read Green");};export const currentGreenCornerPrices=async x=>x;',
  '@/lib/catalog/green-corner-search':'export const filterGreenCorner=x=>x;export const greenCornerNeedsFullPricing=()=>false;',
 };
 try{
  const built=await build({entryPoints:['apps/web/app/api/catalog/brand-counts/route.ts'],bundle:true,platform:'node',format:'cjs',write:false,tsconfig:'apps/web/tsconfig.json',plugins:[{name:'directory-route-fixture',setup(b){b.onResolve({filter:/.*/},args=>args.path in stubs?{path:args.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:stubs[args.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
  const response=await mod.exports.GET(new Request('https://fixture.test/api/catalog/brand-counts?market=japan&directory=1&fuel=petrol&powerTo=160&make=TOYOTA&page=2&city=Новокузнецк'));
  const body=await response.json();assert.equal(response.status,200);assert.equal(body.directoryComplete,true);assert.deepEqual(body.makes,parseJapanBrandDirectory(payload()).makes);assert.deepEqual(requests,[{market:'japan'}]);
  const china=await mod.exports.GET(new Request('https://fixture.test/api/catalog/brand-counts?market=china&directory=1&powerTo=160'));
  assert.equal((await china.json()).counts.BMW,2);assert.equal(other[0].powerTo,160);assert.equal(other[0].market,'china');assert.equal(requests.length,1);
 }finally{delete (globalThis as any).__japanDirectoryRoute;}
});
