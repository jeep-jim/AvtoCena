import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {normalizeGreenCorner} from '../apps/web/lib/catalog/green-corner-normalize';
import {publicGreenOffer} from '../apps/web/lib/catalog/green-corner';
import {publicOffer} from '../apps/web/lib/catalog/storage';
import {filterGreenCorner} from '../apps/web/lib/catalog/green-corner-search';
import {isGreenCornerOffer} from '../apps/web/lib/catalog/green-corner-contract';
import {isSellerPricedOffer} from '../apps/web/lib/catalog/seller-price-contract';
import {japanRecommendationCardVisible} from '../apps/web/lib/catalog/related-card-visibility';
import {ajesLot} from '../apps/web/lib/catalog/ajes-query';
import {ajesOffer} from '../apps/web/lib/catalog/ajes-offer';

const require=createRequire(import.meta.url),observedAt='2026-11-27T06:00:00Z';
const rate={currency:'JPY',rateSource:'cbr',effectiveRate:0.5,rateDate:'2026-11-27'} as any;
function stock(){
 const row=normalizeGreenCorner({id:700001,isSold:false,location:'japan',subgroup:'auto',priceInJapanCurrency:'JPY',priceInJapan:334950,cifFreightJpy:74000,year:2013,horsepower:122,company:'Mercedes-Benz',model:'B-Class',paymentQuote:{sell:55.11,nominal:100,fetchedAt:observedAt},media:['https://img.akebono.world/cars/fixture.jpg']},rate,observedAt);
 return {...row,vin:'PRIVATE-VIN',frameNumber:'PRIVATE-FRAME',japanDeliveredPreview:{totalRub:875944.35,engineCc:1600,estimated:true}};
}
function auction(){
 const lot=ajesLot({ID:'related-example',MARKA_NAME:'MERCEDES BENZ',MODEL_NAME:'B CLASS',YEAR:'2016',AUCTION_TYPE:'2',STATUS:'Sold',FINISH:'120000',TIME:'',IMAGES:'https://7.tru.ru/imgs/fixtureABC&h=50'},'stats',false)!;
 return ajesOffer(lot,{...rate,sourcePrice:120000},observedAt);
}
async function compile(entries:string[],mocks:Record<string,string>){
 const out=await build({stdin:{contents:entries.map(path=>`export * from ${JSON.stringify('./'+path)};`).join('\n'),resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,packages:'external',loader:{'.css':'empty'},plugins:[{name:'japan-recommendation-fixture',setup(builder){
  builder.onResolve({filter:/.*/},args=>{const name=args.path==='server-only'?args.path:args.path.split('/').at(-1)!;return name in mocks?{path:name,namespace:'fixture'}:undefined;});
  builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:mocks[args.path],resolveDir:process.cwd()}));
 }}]});
 const module={exports:{} as any};new Function('require','module','exports',out.outputFiles[0].text)(require,module,module.exports);return module.exports;
}
async function fixture(t:any){
 const state={current:{id:'china-b-class',market:'china',make:'Mercedes-Benz',model:'B-Class'},family:'B-Class',green:[stock()],japan:{items:[auction()],stale:false,partial:false},japanCount:{total:400,stale:false,upperBound:true,observedAt},failure:false,japanQueries:[] as any[],searches:[] as any[],project:publicOffer,projectGreen:publicGreenOffer,filterGreen:filterGreenCorner,view:'grid'};
 (globalThis as any).__japanRecommendations=state;t.after(()=>{delete (globalThis as any).__japanRecommendations;});
 const data=await compile(['apps/web/app/api/catalog/recommendations/data.ts'],{
  'server-only':'',
  'offer-page-data':'export const getOfferDetailRecord=async()=>globalThis.__japanRecommendations.current;',
  storage:'export const publicOffer=row=>globalThis.__japanRecommendations.project(row);export const getUnavailableOffer=async()=>null;export const searchOffers=async(...args)=>{globalThis.__japanRecommendations.searches.push(args);return {items:[],total:0};};',
  'ajes-catalog':'export const readAjesCountSummary=async()=>globalThis.__japanRecommendations.japanCount;export const readAjesResolvedPublic=async query=>{const s=globalThis.__japanRecommendations;s.japanQueries.push(query);if(s.failure)throw Error("source_unavailable");return s.japan;};',
  'related-model-family':'export const readRelatedModelFamily=async()=>globalThis.__japanRecommendations.family;',
  'green-corner':'export const readGreenCorner=async()=>({items:globalThis.__japanRecommendations.green});export const publicGreenOffer=row=>globalThis.__japanRecommendations.projectGreen(row);',
  'green-corner-search':'export const filterGreenCorner=(rows,params)=>globalThis.__japanRecommendations.filterGreen(rows,params);',
  'live-business-pricing':'export const applyActiveBusinessPricingBatch=async rows=>rows;',
  presentation:'export const presentCatalogOffer=row=>({makeLabel:row.make,modelLabel:row.model,marketLabel:row.market});',
  'runtime-config':'export const PUBLIC_CATALOG_MARKETS=["china","japan","europe"];',
 });
 const view=await compile(['apps/web/components/catalog/CatalogCard.tsx','apps/web/components/catalog/RelatedOffersView.tsx'],{
  CatalogSelectionContext:'export const useCatalogView=()=>globalThis.__japanRecommendations.view;',
  DealerBrowsingContext:'import {createElement} from "react";export const useDealerBrowsing=()=>null;export const DealerLink=props=>createElement("a",props);',
  useSavedCalculationPreview:'export const useSavedCalculationPreview=()=>undefined;',
  FavoriteToggle:'export const FavoriteToggle=()=>null;',
  CatalogCover:'export const CatalogCover=()=>null;',
  IntentPrefetchLink:'export const IntentPrefetchLink=({children})=>children;',
  'RecyclingPower.module.css':'export default {};',
 });
 return {state,data,view};
}

test('B-Class Japan recommendations retain stock price identity through the real public DTO and grid/list cards',async t=>{
 const {state,data,view}=await fixture(t);
 const result=await data.loadRelatedRecommendations({id:state.current.id,markets:['japan']});
 assert.deepEqual(state.japanQueries,[{market:'japan',make:'Mercedes-Benz',model:'B-Class',pageSize:24,sort:'updatedAt'}]);
 assert.equal(result.partial,false);
 assert.deepEqual(result.crossMarketGroups.map((group:any)=>group.market),['japan']);
 const rows=result.crossMarketGroups[0].items;
 assert.deepEqual(rows.map((row:any)=>row.id),['ajes-stats-related-example','green-700001']);
 const saved=rows[1],legacy=publicOffer(stock() as any);
 assert.equal(isSellerPricedOffer(legacy),false,'generic public projection loses the ATB stock identity');
 assert.equal(isGreenCornerOffer(saved),true);assert.equal(isSellerPricedOffer(saved),true);
 assert.equal(saved.sellerPriceRub,225372);assert.equal(saved.totalRub,null);assert.equal(saved.engineCc,undefined);
 assert.equal(saved.powerHp,122);assert.equal(saved.japanDeliveredPreview.totalRub,875944.35);
 for(const field of ['operational','vin','frameNumber'])assert.equal(saved[field],undefined,field);
 assert.equal(rows[0].sourceId,undefined,'auction provenance remains private');
 for(const mode of ['grid','list']){
  state.view=mode;
  assert.equal(renderToStaticMarkup(createElement(view.CatalogCard,{offer:legacy})), '');
  const card=renderToStaticMarkup(createElement(view.CatalogCard,{offer:saved}));
  assert.match(card,mode==='grid'?/ac-catalog-card/:/ac-catalog-list-row/);
  const html=renderToStaticMarkup(createElement(view.RelatedOffersView,{data:result}));
  assert.match(html,/data-related-market="japan"/);
  assert.equal((html.match(mode==='grid'?/class="ac-catalog-card\s/g:/class="ac-catalog-list-row"/g)||[]).length,2);
 }
});

test('a malformed old stock DTO cannot leave a heading with an empty Japan rail',async t=>{
 const {state,data,view}=await fixture(t);
 const result=await data.loadRelatedRecommendations({id:state.current.id,markets:['japan']});
 const legacy=publicOffer(stock() as any);
 assert.equal(japanRecommendationCardVisible(legacy),false);
 result.crossMarketGroups=[{market:'japan',items:[legacy]}];
 const html=renderToStaticMarkup(createElement(view.RelatedOffersView,{data:result}));
 assert.doesNotMatch(html,/data-related-market="japan"|data-related-section="other-markets"/);
 assert.equal(japanRecommendationCardVisible({market:'china'}),true,'other-market admission is unchanged');
});

test('Japan recommendations use the resolved family path and keep source failures honest',async t=>{
 const {state,data}=await fixture(t);
 state.current={...state.current,id:'ajes-stats-current',market:'japan',model:'B CLASS SPORT'};
 const japanResult=await data.loadRelatedRecommendations({id:state.current.id,markets:['japan']});
 assert.equal(japanResult.marketTotal,null,'raw source COUNT cannot become an exact visible Japanese total');
 assert.equal(state.japanQueries[0].model,'B-Class');
 state.current={id:'china-b-class',market:'china',make:'Mercedes-Benz',model:'B-Class'};
 state.japan.stale=true;
 assert.equal((await data.loadRelatedRecommendations({id:state.current.id,markets:['japan']})).partial,true);
 state.japan.stale=false;state.failure=true;
 const partial=await data.loadRelatedRecommendations({id:state.current.id,markets:['japan']});
 assert.equal(partial.partial,true);assert.deepEqual(partial.crossMarketGroups[0].items.map((row:any)=>row.id),['green-700001']);
 const reads=state.japanQueries.length;
 await data.loadRelatedRecommendations({id:state.current.id,markets:['europe']});
 assert.equal(state.japanQueries.length,reads,'unrequested Japan is not queried');
 assert.ok(state.searches.every(call=>call[0].market!=='japan'&&call[1]===48&&call[2]==='related'));
});
