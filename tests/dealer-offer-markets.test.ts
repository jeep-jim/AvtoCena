import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
test('dealer directions show full counts and shared green stock only when Japan is enabled',async()=>{
 const state={greenReads:0,fail:false};(globalThis as any).__dealerMarketsTest=state;
 const result=await build({stdin:{contents:"export {DealerOfferMarkets} from './apps/web/components/dealers/DealerOfferMarkets';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,plugins:[{name:'isolated-catalog',setup(b){
 b.onResolve({filter:/^@\/lib\/catalog\/(storage|green-corner|market-page|live-business-pricing|related-offer-selection)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onResolve({filter:/CatalogCard$|CatalogMarketFlag$|GreenCornerRail$|DealerBrowsingContext$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path.endsWith('/storage')?`export async function searchOffers(){if(globalThis.__dealerMarketsTest.fail)throw Error('unavailable');return {items:[{id:'one'}],total:12345};}`:a.path.endsWith('/green-corner')?`export async function readGreenCorner(){globalThis.__dealerMarketsTest.greenReads++;return {items:[{id:'green'}]};}export const publicGreenOffer=x=>x;`:a.path.endsWith('/market-page')?`export const balanceBusinessRows=x=>x;`:a.path.endsWith('/live-business-pricing')?`export const applyActiveBusinessPricingBatch=async x=>x;`:a.path.endsWith('/related-offer-selection')?`export const isRenderableRelatedOffer=()=>true;`:a.path.endsWith('DealerBrowsingContext')?`export const DealerLink=({children})=>children;`:a.path.endsWith('GreenCornerRail')?`export const GreenCornerRail=({total})=>'GREEN:'+total;`:`export const CatalogCard=()=>null;export const CatalogMarketFlag=()=>null;`}));
 }}]});
 const module={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 let html=renderToStaticMarkup(await module.exports.DealerOfferMarkets({markets:['china']}));
 assert.ok(html.includes('12 345'));assert.equal(state.greenReads,0);assert.ok(!html.includes('GREEN:'));
 html=renderToStaticMarkup(await module.exports.DealerOfferMarkets({markets:['japan']}));assert.equal(state.greenReads,1);assert.ok(html.includes('GREEN:1'));assert.ok(!html.includes('Китай'));
 html=renderToStaticMarkup(await module.exports.DealerOfferMarkets({markets:[]}));assert.equal(html,'');assert.equal(state.greenReads,1);
 delete (globalThis as any).__dealerMarketsTest;
});
