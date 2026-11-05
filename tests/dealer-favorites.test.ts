import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const require=createRequire(import.meta.url);
test('favorites hide discovery only for a resolved dealer and return to its catalog',async()=>{
 const result=await build({stdin:{contents:"export {default} from './apps/web/components/catalog/FavoritesContent';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',write:false,plugins:[{name:'favorites-shell',setup(b){
  b.onResolve({filter:/^next\/link$|DealerBrowsingContext$|PublicHeader$|DealerSubscription$|FavoriteToggle$|CatalogPrice$|useSavedCalculationPreview$/},a=>({path:a.path,namespace:'fixture'}));
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',resolveDir:process.cwd(),contents:a.path==='next/link'?"const React=require('react');export default p=>React.createElement('a',p);":a.path.endsWith('DealerBrowsingContext')?'export const useDealerBrowsing=()=>globalThis.__favoritesDealer;':a.path.endsWith('PublicHeader')?'export const PublicHeader=()=>null;':a.path.endsWith('DealerSubscription')?'export const SubscribedDealers=()=>null;':a.path.endsWith('FavoriteToggle')?'export const FavoriteToggle=()=>null;':a.path.endsWith('CatalogPrice')?'export const CatalogPrice=()=>null;':'export const useSavedCalculationPreview=()=>null;'}));
 }}]});
 const module={exports:{} as any};new Function('require','module','exports',result.outputFiles[0].text)(require,module,module.exports);
 try {
  (globalThis as any).__favoritesDealer=null;
  const general=renderToStaticMarkup(createElement(module.exports.default));
  assert.match(general,/aria-label="Каталоги"/);assert.match(general,/href="\/dealers"/);
  (globalThis as any).__favoritesDealer={id:'other',href:'/moscow/other'};
  const scoped=renderToStaticMarkup(createElement(module.exports.default));
  assert.doesNotMatch(scoped,/aria-label="Каталоги"|href="\/dealers"/);
  assert.match(scoped,/href="\/moscow\/other"/);
 } finally {delete (globalThis as any).__favoritesDealer;}
});
