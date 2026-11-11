import {test} from 'node:test';
import assert from 'node:assert/strict';
import {homeSnapshotMarketIsEmpty} from '../apps/web/lib/catalog/home-editorial-empty.ts';
test('known empty local Japan needs no reconciliation; another market is untouched',()=>{
 const s={marketCounts:{japan:0,uae:2},items:[{market:'uae'}]};
 assert.equal(homeSnapshotMarketIsEmpty(s,'japan'),true);
 assert.equal(homeSnapshotMarketIsEmpty(s,'uae'),false);
 assert.deepEqual(s,{marketCounts:{japan:0,uae:2},items:[{market:'uae'}]});
});
test('unknown, invalid or contradictory inventory cannot bypass editorial search',()=>{
 for(const count of [undefined,null,-1,NaN,Infinity,'0',1]){
  assert.equal(homeSnapshotMarketIsEmpty({marketCounts:{japan:count},items:[]},'japan'),false);
 }
 assert.equal(homeSnapshotMarketIsEmpty({marketCounts:{japan:0},items:[{market:'japan'}]},'japan'),false);
 assert.equal(homeSnapshotMarketIsEmpty({items:[]},'japan'),false);
});

test('actual wrapper skips empty Japan and reconciles populated UAE',async()=>{
 const {readFileSync}=await import('node:fs');
 const source=readFileSync(new URL('../apps/web/lib/catalog/storage.ts',import.meta.url),'utf8');
 const start=source.indexOf('export async function readHomeCatalogSnapshot(');
 const end=source.indexOf('\nexport async function getOffer',start);
 const code=source.slice(start,end).replace('export ','');
 const calls:string[]=[];
 const original={generationId:'gen_1_abc',marketCounts:{japan:0,uae:2},total:2,items:[{id:'old',market:'uae'}]};
 const timing={measure:(_phase:string,work:()=>any)=>work()};
 const run=new Function('createHomePhaseTiming','withCatalogEditorial','readHomeCatalogSnapshotOriginal','applyCatalogEditorial','MARKETS','editorialHasHidden','homeSnapshotMarketIsEmpty','searchOffers','compareCatalogDisplayOrder','mapWithConcurrency',code+';return readHomeCatalogSnapshot;')(
 ()=>timing,(work:()=>any)=>work(),async()=>original,(row:any)=>row,['japan','uae'],()=>true,homeSnapshotMarketIsEmpty,
 async(q:any)=>{calls.push(q.market);assert.equal(q.pageSize,10);assert.equal(q.sort,'updatedAt');return {total:1,items:[{id:'visible',market:'uae'}]};},()=>0,async(items:any[],limit:number,worker:any)=>{assert.equal(limit,2);return Promise.all(items.map(worker));});
 const result=await run(10);
 assert.deepEqual(calls,['uae']);assert.equal(result.total,1);assert.deepEqual(result.items,[{id:'visible',market:'uae'}]);
 assert.equal(original.total,2);assert.equal(original.items[0].id,'old');
});

test('home reconciliation overlaps at most two markets and preserves deterministic results',async()=>{
 const {readFileSync}=await import('node:fs');
 const s=readFileSync(new URL('../apps/web/lib/catalog/storage.ts',import.meta.url),'utf8');
 const begin=s.indexOf('export async function readHomeCatalogSnapshot(');
 const code=s.slice(begin,s.indexOf('\nexport async function getOffer',begin)).replace('export ','');
 const mapStart=s.indexOf('async function mapWithConcurrency<');
 const mapCode=s.slice(mapStart,s.indexOf('\nexport function searchProjectionFromOffer',mapStart))
  .replace(/async function mapWithConcurrency[^\n]+/, 'async function mapWithConcurrency(items, concurrency, worker) {').replace('new Array<R>','new Array');
 const mapper=new Function(mapCode+';return mapWithConcurrency;')();
 const markets=['uae','europe','georgia'];
 const original={marketCounts:{uae:2,europe:2,georgia:2},total:6,items:markets.map(market=>({id:'old-'+market,market}))};
 let active=0,peak=0;const calls:string[]=[];let fail=false;
 const run=new Function('createHomePhaseTiming','withCatalogEditorial','readHomeCatalogSnapshotOriginal','applyCatalogEditorial','MARKETS','editorialHasHidden','homeSnapshotMarketIsEmpty','searchOffers','compareCatalogDisplayOrder','mapWithConcurrency',code+';return readHomeCatalogSnapshot;')(
 ()=>({measure:(_:string,work:any)=>work()}),(work:any)=>work(),async()=>original,(v:any)=>v,markets,()=>true,homeSnapshotMarketIsEmpty,
 async({market}:any)=>{calls.push(market);active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,market==='uae'?15:1));active--;if(fail&&market==='europe')throw Error('search failed');return {total:1,items:[{id:market,market}]};},()=>0,mapper);
 const result=await run(10);
 assert.equal(peak,2);assert.deepEqual(calls,markets);assert.deepEqual(result.items.map((x:any)=>x.id),markets);assert.equal(result.total,3);
 assert.equal(original.total,6);assert.ok(original.items.every(x=>x.id.startsWith('old-')));
 fail=true;await assert.rejects(run(10),/search failed/);
});
