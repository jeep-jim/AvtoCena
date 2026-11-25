import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {ajesOffer} from '../apps/web/lib/catalog/ajes-offer';
import {ajesLot} from '../apps/web/lib/catalog/ajes-query';
import {publicOffer} from '../apps/web/lib/catalog/storage';
const require=createRequire(import.meta.url);

async function bundled(entry:string,mocks:Record<string,string>){
 const built=await build({entryPoints:[entry],bundle:true,platform:'node',format:'cjs',write:false,jsx:'automatic',loader:{'.css':'empty','.module.css':'empty'},packages:'external',external:['react','react/jsx-runtime'],
  plugins:[{name:'bounded-fixture',setup(b){
   b.onResolve({filter:/.*/},a=>{const name=a.path.split('/').at(-1)!;return a.path in mocks?{path:a.path,namespace:'fixture'}:name in mocks?{path:name,namespace:'fixture'}:undefined;});
   b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'tsx'}));
  }}]});
 const m={exports:{} as any};
 new Function('require','module','exports',built.outputFiles[0].text)((id:string)=>id==='react'?{...require('react'),cache:(fn:any)=>fn}:require(id),m,m.exports);
 return m.exports;
}
const row=(id:string,power:unknown,patch:Record<string,unknown>={})=>({id:'ajes-stats-'+id,market:'japan',sourceId:'ajes_japan_feed',
 make:'TOYOTA',model:'FIXTURE',year:2023,engineCc:1500,fuel:'petrol',operational:{raw:{sourcePower:power}},...patch});
const catalogMocks:Record<string,string>={
 'server-only':'','next/headers':"export const headers=async()=>new Map([['x-real-ip','192.0.2.1']]);",
 'ajes-runtime':"export const ajesClient={read:()=>{globalThis.__japanPwResults.counts++;throw Error('unexpected supplier count');}};",
 'ajes-public':"export const cappedAjesQuery=async q=>q;export const readAjesPublic=async q=>globalThis.__japanPwResults.read(q);",
 'ajes-query':"export const ajesCatalogQuery=p=>({table:'stats',page:Number(p.page||1),pageSize:24});export class AjesFilterUnavailable extends Error{};export class AjesInputError extends Error{};",
 'ajes-client':"export const readAjesModelDirectory=async()=>({models:[]});export const readAjesMakeDirectory=async()=>({makes:[]});export class AjesUnavailable extends Error{};",
 'storage':"export const publicOffer=x=>x;",'market-page':"export const sortCatalogRows=x=>x;",
 'live-business-pricing':"export const applyActiveBusinessPricingBatch=async x=>{globalThis.__japanPwResults.pricing++;return x;};",
 'collection-controls':"export const assertCollectionEnabled=async()=>{};",
 'japan-preview-parameters':"export const japanPreviewParameters=()=>{throw Error('power missing');};",
 'calculation-evidence':"export const hasEncyclopediaCalculationEvidence=()=>false;",
};

test('the real filtered AJ reader keeps missing PW, reports unknown/preliminary counts, and never invents an exact <=160 total',async()=>{
 const rows=[row('first','52,170'),row('unknown',''),row('too_high','170,52'),row('known','250',{powerHp:150}),row('known_high','52',{powerHp:180})];
 const state={counts:0,pricing:0,reads:[] as number[],read:async(q:any)=>{state.reads.push(q.page);return {page:q.page,pageSize:24,received:rows.length,items:rows,observedAt:'2026-11-25T10:00:00Z',stale:false};}};
 (globalThis as any).__japanPwResults=state;
 try{
  const module=await bundled('apps/web/lib/catalog/ajes-catalog.ts',catalogMocks);
  const page=await module.readAjesCatalogPage({market:'japan',powerTo:'160'},undefined,{includeCount:false});
  assert.deepEqual(page.items.map((v:any)=>v.id),['ajes-stats-first','ajes-stats-unknown','ajes-stats-known']);
  assert.deepEqual(state.reads,[1]);assert.equal(state.counts,0);assert.equal(state.pricing,0,'preliminary PW never starts pricing');
  assert.equal(page.powerUnknownIncluded,true);assert.equal(page.powerUnknownCount,1);assert.equal(page.powerPreliminaryCount,1);
  assert.equal(page.powerIncomplete,true);assert.equal(page.countIncomplete,true);assert.equal(page.total,null);
  assert.equal(page.hasMore,false);assert.equal(page.nextCursor,null);assert.equal(page.partial,false);
  const summary=await module.readAjesCountSummary(JSON.stringify({market:'japan',powerTo:'160'}));
  assert.equal(summary.upperBound,true);assert.equal(state.counts,0);
  const mixed=await module.withAjesCount({total:12,marketCounts:{china:12}},{powerTo:'160'});
  assert.equal(mixed.total,12);assert.equal(mixed.countIncomplete,true);assert.equal(state.counts,0);
 }finally{delete (globalThis as any).__japanPwResults;}
});

test('all-known complete results may have an exact count; missing-power pages retain cursor identity without extra scans',async()=>{
 let pages:Record<number,any[]>={1:[row('known','',{powerHp:150}),row('excluded','',{powerHp:180})]};
 const state={counts:0,pricing:0,reads:[] as number[],read:async(q:any)=>{state.reads.push(q.page);const rows=pages[q.page]||[];return {page:q.page,pageSize:24,received:rows.length,items:rows,observedAt:'2026-11-25T10:00:00Z',stale:false};}};
 (globalThis as any).__japanPwResults=state;
 try{
  const module=await bundled('apps/web/lib/catalog/ajes-catalog.ts',catalogMocks);
  const known=await module.readAjesCatalogPage({market:'japan',powerTo:'160'},undefined,{includeCount:false});
  assert.equal(known.total,1);assert.equal(known.countIncomplete,false);assert.equal(known.powerIncomplete,false);
  pages={1:Array.from({length:24},(_,i)=>row('missing_'+i,'')),2:[row('last','')]};state.reads=[];
  const first=await module.readAjesCatalogPage({market:'japan',powerTo:'160'},undefined,{includeCount:false});
  assert.equal(first.items.length,24);assert.equal(first.powerUnknownCount,24);assert.equal(first.nextCursor,'2.0');assert.deepEqual(state.reads,[1]);
  const next=await module.readAjesCatalogPage({market:'japan',powerTo:'160',after:first.nextCursor,page:'2'},undefined,{includeCount:false});
  assert.deepEqual(next.items.map((v:any)=>v.id),['ajes-stats-last']);assert.equal(next.powerUnknownCount,1);assert.equal(next.hasMore,false);
  assert.deepEqual(state.reads,[1,2]);assert.equal(new Set([...first.items,...next.items].map((v:any)=>v.id)).size,25);
  assert.equal(next.total,null);assert.equal(next.countIncomplete,true);assert.equal(state.counts,0);
 }finally{delete (globalThis as any).__japanPwResults;}
});

const walk=(node:any):any[]=>Array.isArray(node)?node.flatMap(walk):!node||typeof node!=='object'?[]:[node,...Object.values(node.props||{}).flatMap(walk)];
test('Japan rail remains visible when empty or awaiting data and filtered UI does not show a supplier-wide count',async()=>{
 const mocks={
  'ajes-catalog':'export const readAjesCatalogPage=async()=>({});export const readAjesCountSummary=async()=>{throw Error("count must not run");};',
  'ajes-query':'export class AjesFilterUnavailable extends Error{};',
  'collection-controls':'export const assertCollectionEnabled=async()=>{};',
  'storage':'export const publicOffer=x=>x;',
  'DealerBrowsingContext':'export const DealerLink=({children,href})=><a href={href}>{children}</a>;',
  'CatalogCard':'export const CatalogCard=({offer})=><article data-offer-id={offer.id}/>;',
  'CatalogMarketFlag':'export const CatalogMarketFlag=()=>null;',
  'CatalogLoading':'export const CatalogSectionLoading=()=>null;',
 };
 const module=await bundled('apps/web/components/catalog/AjesRail.tsx',mocks);
 const base={disabled:false,items:[],count:{total:999999,upperBound:false,stale:false,observedAt:'2026-11-25'},unavailable:false,unsupported:false,partial:false,stale:false,filteredByPage:true,hasMore:false};
 const empty=await module.AjesRail({params:{powerTo:'160'},prepared:Promise.resolve(base)});
 const html=renderToStaticMarkup(empty);
 assert.match(html,/aria-label="Япония"/);assert.match(html,/Открыть Японию/);assert.doesNotMatch(html,/999.?999/);
 assert.match(html,/без указанной мощности тоже показаны/);
 const ready=await module.AjesRail({params:{powerTo:'160'},prepared:Promise.resolve({...base,items:[row('unknown','')]})});
 assert.equal(walk(ready).filter(v=>v.type?.name==='CatalogCard').length,1);
 assert.match(renderToStaticMarkup(ready),/без мощности: 1/);
 assert.match(renderToStaticMarkup(module.AjesRailPending()),/aria-label="Япония"/);
 assert.equal(await module.AjesRail({prepared:Promise.resolve({...base,disabled:true})}),null,'the owner switch still applies');
});

test('detail displays a separate preliminary supplier value and unknown status without a calculator default',async()=>{
 const module=await bundled('apps/web/components/catalog/JapanSourcePowerNotice.tsx',{});
 const known=renderToStaticMarkup(module.JapanSourcePowerNotice({offer:row('first','52,64')}));
 assert.match(known,/52 л\.с\. · предварительно/);assert.match(known,/data-japan-source-power="ajes_pw_first"/);
 assert.match(known,/первое указанное значение/);assert.match(known,/подтвердите мощность по документам/);assert.doesNotMatch(known,/64/);
 const unknown=renderToStaticMarkup(module.JapanSourcePowerNotice({offer:row('empty','')}));
 assert.match(unknown,/data-japan-source-power="unknown"/);assert.match(unknown,/сохранён в каталоге/);
 assert.equal(module.JapanSourcePowerNotice({offer:row('manual','52',{powerHp:150})}),null);
 assert.equal(module.JapanSourcePowerNotice({offer:row('foreign','52',{market:'china'})}),null);
});

test('actual card rendering keeps public AJ rows in grid and list with first-PW or unknown labels',async()=>{
 const module=await bundled('apps/web/components/catalog/CatalogCard.tsx',{
  'CatalogSelectionContext':"export const useCatalogView=()=>globalThis.__japanPwCardView;",
  'DealerBrowsingContext':"export const useDealerBrowsing=()=>null;",
  'useSavedCalculationPreview':"export const useSavedCalculationPreview=()=>null;",
  'FavoriteToggle':"export const FavoriteToggle=()=>null;",
  'CatalogPrice':"export const CatalogPrice=()=>null;",
  'CatalogCover':"export const CatalogCover=()=>null;",
  'IntentPrefetchLink':"export const IntentPrefetchLink=({children,href})=><a href={href}>{children}</a>;",
 });
 const at='2026-11-25T10:00:00Z';
 const rate:any={currency:'JPY',sourcePrice:935000,rateSource:'cbr',effectiveRate:0.6,rate:0.6,baseRate:0.6,observedAt:at};
 try{
  for(const view of ['grid','list'])for(const power of ['52,64',''])for(const fuel of ['P','H']){
   (globalThis as any).__japanPwCardView=view;
   const lot=ajesLot({ID:'card',MARKA_NAME:'TOYOTA',MODEL_NAME:'FIXTURE',YEAR:'2023',AUCTION_TYPE:'2',STATUS:'Sold',FINISH:'935000',PW:power,ENG_V:'1500',TIME:fuel},'stats')!;
   const dto=publicOffer(ajesOffer(lot,rate,at));
   const html=renderToStaticMarkup(createElement(module.CatalogCard,{offer:dto,compact:true,dense:true}));
   assert.match(html,/ac-catalog-card|ac-catalog-list-row/,'unknown horsepower must not remove the card');
   assert.match(html,power?/52 л\.с\. · предварительно/:/Мощность не указана/);
   assert.doesNotMatch(html,/64 л\.с\./);
   if(power){
    const legacy={...dto,japanPowerEstimate:{offerId:dto.id,values:[110,150],requiresConfirmation:true}};
    const conflictHtml=renderToStaticMarkup(createElement(module.CatalogCard,{offer:legacy,compact:true,dense:true}));
    assert.match(conflictHtml,/52 л\.с\. · предварительно/,'the first supplier PW wins over an older preliminary estimate');
    assert.doesNotMatch(conflictHtml,/110 \/ 150/);
   }
  }
 }finally{delete (globalThis as any).__japanPwCardView;}
});
