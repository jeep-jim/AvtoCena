import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {isPriceOnRequestDubicarsOffer} from '../apps/web/lib/catalog/dubicars-owner-policy';

const offer={id:'dubicars-test',market:'uae',sourceId:'dubicars_uae_exact',sourceGroup:'dubicars_uae_exact',make:'Toyota',model:'Corolla',title:'Toyota Corolla',year:2022,status:'active',calculationStatus:'needs_data',sourcePrice:null,totalRub:null,sellerPriceRub:null,images:[],cardProjectionVersion:3};

test('price on request does not admit other sources or stale amounts and previews',()=>{
 assert.equal(isPriceOnRequestDubicarsOffer(offer),true);
 for(const change of [{market:'china'},{sourceId:'unknown'},{calculationStatus:'ready'},{sourcePrice:100},...[1,-1,NaN,'0'].flatMap(value=>[{totalRub:value},{sellerPriceRub:value},{publicVisibleRub:value}]),{deliveredCalculationPreview:{totalRub:1}},{japanDeliveredPreview:{totalRub:1}},{savedCalculationPreview:{totalRub:1}}])assert.equal(isPriceOnRequestDubicarsOffer({...offer,...change}),false,JSON.stringify(change));
});

test('real catalog card renders unpriced Dubicars and keeps ordinary invalid rows hidden',async()=>{
 const dir=mkdtempSync(join(process.cwd(),'.unpriced-card-test-'));
 try{
  const path=join(dir,'card.cjs');
  await build({entryPoints:['apps/web/components/catalog/CatalogCard.tsx'],outfile:path,bundle:true,platform:'node',format:'cjs',packages:'external',jsx:'automatic',loader:{'.css':'empty'},logLevel:'silent',plugins:[{name:'router-fixture',setup(b){
   b.onResolve({filter:/^next\/navigation$/},()=>({path:'router',namespace:'fixture'}));
   b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const useRouter=()=>({prefetch(){}});export const usePathname=()=>"/cars";export const useSearchParams=()=>new URLSearchParams();'}));
  }}]});
  const {CatalogCard}=createRequire(import.meta.url)(path);
  const render=(extra:any={})=>renderToStaticMarkup(React.createElement(CatalogCard,{offer:{...offer,...extra}}));
  const html=render();
  assert.match(html,/Toyota Corolla/);assert.match(html,/Цена по запросу/);assert.match(html,/data-price-on-request/);
  assert.doesNotMatch(html,/Расчёт под ключ/);
  assert.equal(render({market:'europe',sourceId:'unknown',sourceGroup:'unknown'}),'');
  assert.equal(render({sourceId:'proauctions'}),'');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
