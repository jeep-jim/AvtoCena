import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
test('stock rail removes hidden cards before taking six slots, keeping calculated and seller rows',async()=>{
 const result=await build({stdin:{contents:"export {GreenCornerRail} from './apps/web/components/catalog/GreenCornerRail';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,plugins:[{name:'rail-fixture',setup(b){
 b.onResolve({filter:/CatalogCard$|CatalogMarketFlag$|DealerBrowsingContext$|public-priority$|seller-price-contract$|modification-contract$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({resolveDir:process.cwd(),loader:'js',contents:a.path.endsWith('CatalogCard')?`import React from 'react';export const CatalogCard=({offer})=>React.createElement('article',{'data-id':offer.id},offer.id);`:a.path.endsWith('CatalogMarketFlag')?'export const CatalogMarketFlag=()=>null;':a.path.endsWith('DealerBrowsingContext')?'export const DealerLink=({children})=>children;':a.path.endsWith('public-priority')?'export const catalogOfferVisibleRub=o=>o.totalRub||0;':a.path.endsWith('seller-price-contract')?'export const isSellerPricedOffer=o=>o.seller===true;':'export const hasModificationSelection=o=>o.selection===true;'}));
 }}]});
 const module={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 const items=[{id:'green-1',totalRub:100},{id:'green-2',seller:true},{id:'green-3',selection:true},{id:'green-4'},...Array.from({length:4},(_,i)=>({id:'green-'+(i+5),totalRub:100}))].map(x=>({...x,market:'japan'}));
 const html=renderToStaticMarkup(module.exports.GreenCornerRail({items,total:items.length}));
 assert.equal((html.match(/<article /g)||[]).length,6);assert.ok(!html.includes('data-id="green-4"'));assert.ok(html.includes('data-id="green-7"'));assert.ok(!html.includes('data-id="green-8"'));
});
