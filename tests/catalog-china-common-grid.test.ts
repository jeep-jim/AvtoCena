import './helpers/server-only-hook.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {openPreparedChinaSnapshot} from '../apps/web/lib/catalog/prepared-china-fixture-activation';
import {preparedPriceCardDigest,preparedPriceCardMarketDigest} from '../apps/web/lib/catalog/prepared-price-card-block';
import {dealerBrowsingHref} from '../apps/web/lib/dealers/browsing-context';
import type {CatalogPreparedChinaManifest} from '../apps/web/lib/catalog/storage';

const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const generationId='gen_1795166586455_testchina';
const prefix=`catalog/generations/${generationId}/indexes/prepared-china-read-v1/`;
const total=170_564, when=new Date().toISOString(), future=Date.now()+60_000, nChunks=Math.ceil(total/500);
const chunk=(i:number)=>'chunk-'+String(i+1).padStart(4,'0');
function sparseCut({corrupt=false,nonDense=false,duplicate=false,streaming=true}={}){
 const blobs=new Map<string,Buffer>(),calls:string[]=[];
 const put=(path:(sha:string)=>string,v:object)=>{
  const b=Buffer.from(JSON.stringify(v)),sum=sha(b);
  blobs.set(prefix+path(sum),b);return sum;
 };
 const chunks=Array.from({length:nChunks},(_,i)=>chunk(i));
 if(nonDense)chunks[1]='chunk-4000';
 const market={count:total,chunks,updatedAt:when};
 const manifest:CatalogPreparedChinaManifest={version:2,generationId,updatedAt:when,markets:{china:market}};
 const marketInventoryDigest=preparedPriceCardMarketDigest(manifest,'china');
 const chunkSha256=chunks.map(()=> 'f'.repeat(64));
 for(const ci of [0,1,nChunks-1]){
  const label=chunks[ci],n=Math.min(total-ci*500,corrupt&&ci===0?499:500),parts=[];
  for(let offset=0,part=0;offset<n;offset+=128,part++){
   const items=Array.from({length:Math.min(n-offset,128)},(_,i)=>{
    const ordinal=ci*500+offset+i;
    return {id:'car-'+(duplicate&&ordinal===23?22:ordinal),market:'china',totalRub:1_000_000+ordinal};
   });
   const projectionSha256=put(h=>`projections/${label}/${part}-${h}.json`,{generationId,items});
   parts.push({market:'china',generationId,sourceChunk:label,part,rows:items.length,projectionSha256,
     marketInventoryDigest,tariffValidUntil:future,sourceIdsSha256:preparedPriceCardDigest(items.map(x=>x.id))});
  }
  chunkSha256[ci]=put(h=>`chunks/${label}-${h}.json`,{version:1,generationId,chunk:label,parts,
    ...(streaming?{selectors:parts.map(()=>({makeMask:'0'.repeat(128),minYear:2021,maxYear:2022}))}:{})});
 }
 const directorySha256=put(h=>`directory-${h}.json`,{version:1,generationId,marketDigest:marketInventoryDigest,validUntil:future,
  rows:total,chunkSha256,...(streaming?{streamingSelector:true,navigationFacets:{generationId}}:{})});
 manifest.markets.china.preparedChinaPriceReadV1={directorySha256};
 let current=true;
 const open=()=>openPreparedChinaSnapshot(manifest,async(path,expected)=>{
  calls.push(path);
  const body=blobs.get(path);
  assert.ok(body,'must never read preceding/unrelated chunks '+path);
  assert.equal(sha(body),expected);return body;
 },async()=>{assert.ok(current,'active_changed');});
 return {open,calls,invalidate:()=>{current=false;}};
}
const ids=(n:number,length:number)=>Array.from({length},(_,i)=>'car-'+(n+i));
test('24-card pages 1/2, boundary and deep final page use only the sealed ordinal windows',async()=>{
 const f=sparseCut(),s=await f.open();
 for(const [start,length,reads] of [[0,24,2],[24,24,2],[480,24,4],[170544,20,2],[170568,0,0]]){
  f.calls.length=0;
  const got=await s.canonicalWindow(start,24,false);
  assert.equal(got?.total,total);
  assert.deepEqual(got?.items.map(x=>x.id),ids(start,length));
  assert.deepEqual(got?.items.map(x=>x.totalRub),Array.from({length},(_,i)=>1_000_000+start+i));
  assert.equal(f.calls.length,reads);
 }
 f.calls.length=0;
 assert.deepEqual(await s.canonicalWindow(0,24,true),{total,items:[]});
 assert.deepEqual(f.calls,[]);
 await s.assertCurrent();f.invalidate();await assert.rejects(s.assertCurrent(),/active_changed/);
});
test('fixed complete chunk proof and unique page IDs fail closed; old packs remain on their old adapter',async()=>{
 for(const [options,label] of [[{corrupt:true},'canonical_window_coverage'],[{duplicate:true},'canonical_window_coverage'],
    [{nonDense:true},'canonical_window_scope']] as const){
  const f=sparseCut(options),s=await f.open();
  await assert.rejects(s.canonicalWindow(0,24,false),new RegExp(label));
 }
 const s=await sparseCut({streaming:false}).open();
 assert.equal(await s.canonicalWindow(0,24,false),null);
});
test('selected China shares normal grid and canonical page href; other market rails stay untouched',()=>{
 const page=readFileSync('apps/web/components/catalog/CatalogContent.tsx','utf8');
 const ordinaryGrid=readFileSync('apps/web/components/catalog/CatalogLoadMore.tsx','utf8');
 assert.doesNotMatch(page,/Открыть полный список|data-china-default-showcase/);
 assert.match(page,/selectedMarket \? <CatalogLoadMore/);
 assert.match(page,/preparedCut:chinaCut.generationId/);
 assert.match(page,/readPreparedChinaHomeCards\(OVERVIEW_CARDS,\{city:common\.city\}\)/);
 assert.match(ordinaryGrid,/data-catalog-batch=\{batch.page\}[^\n]*grid-cols-2[^\n]*md:grid-cols-3 xl:grid-cols-4/);
 assert.match(ordinaryGrid,/<CatalogPagination/);
 assert.equal(dealerBrowsingHref('/cars?market=china&page=2&preparedCut='+generationId,null),'/cars/china?page=2&preparedCut='+generationId);
});
