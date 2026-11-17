import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';

const require=createRequire(import.meta.url);

// Execute the actual recommendation loader and actual source selector. Only
// storage/provider boundaries and unrelated grouping/presentation are fixtures.
async function fixture({market='korea',id='0123456789abcdef01234567',paid=true,published=true,manifestError=false}={}) {
  const state:any={paid,published,manifestError,current:{id,market,make:'BMW',model:'3 Series'},
    searches:[],ajes:[],counts:[],controls:[],selected:null};
  const output=await build({entryPoints:['apps/web/app/api/catalog/recommendations/data.ts'],
    bundle:true,platform:'node',format:'cjs',write:false,packages:'external',plugins:[{name:'recommendation-boundaries',setup(b){
      b.onResolve({filter:/.*/},a=>{
        if(a.path==='server-only')return {path:'empty',namespace:'fixture'};
        if(a.path==='@/lib/catalog/ajes-market-selection')return {path:path.resolve('apps/web/lib/catalog/ajes-market-selection.ts')};
        if(a.importer.endsWith('ajes-market-selection.ts')){
          if(a.path==='./collection-controls')return {path:'controls',namespace:'fixture'};
          if(a.path==='./storage')return {path:'manifest',namespace:'fixture'};
        }
        if(a.importer.endsWith('/recommendations/data.ts'))return {path:'boundaries',namespace:'fixture'};
      });
      b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path==='empty'?'':a.path==='controls'?`
        export async function assertCollectionEnabled(source){__fixture.controls.push(source);if(source==='encar_feed'&&!__fixture.paid)throw Error('disabled');}
      `:a.path==='manifest'?`
        export async function hasPublishedPaidEncar(){if(__fixture.manifestError)throw Error('unreadable_manifest');return __fixture.published;}
      `:`
        export async function getOfferDetailRecord(){return __fixture.current;}
        export async function getUnavailableOffer(){return null;}
        export async function searchOffers(params,maximum,context){__fixture.searches.push({params,maximum,context});return {items:[{id:'local-'+params.market,market:params.market}],total:17};}
        export async function readAjesPublic(params){__fixture.ajes.push(params);if(params.table==='korea'&&__fixture.paid&&__fixture.published)throw Error('AJ_Korea_disabled');return {items:[{id:'legacy-'+params.table,market:params.table}]};}
        export async function readAjesCount(params){__fixture.counts.push(params);return 9;}
        export async function readRelatedModelFamily(){return '3 Series family';}
        export async function selectRelatedOfferGroups(input){__fixture.selected=input;return {stockModels:[],sameModel:input.modelRows,crossMarketGroups:input.crossResults,marketRows:input.marketRows};}
        export function isRenderableRelatedOffer(){return true;}
        export async function readGreenCorner(){return null;}
        export const publicGreenOffer=x=>x,publicOffer=x=>x,filterGreenCorner=x=>x;
        export const isGreenCornerOffer=()=>false,applyActiveBusinessPricingBatch=async x=>x,priceCandidatesUntil=async x=>x;
        export const presentCatalogOffer=x=>({makeLabel:x.make,modelLabel:x.model,marketLabel:x.market});
        export const PUBLIC_CATALOG_MARKETS=['korea','japan','china','europe'];
      `}));
    }}]});
  const module={exports:{} as any};
  new Function('require','module','exports','__fixture',output.outputFiles[0].text)(require,module,module.exports,state);
  return {state,load:module.exports.loadRelatedRecommendations as (input:any)=>Promise<any>};
}

test('paid Korea recommendations use current local inventory when the old AJ source is retired',async()=>{
  const {state,load}=await fixture();
  const result=await load({id:state.current.id,markets:['korea']});
  assert.deepEqual(state.ajes,[]);assert.deepEqual(state.counts,[]);
  assert.equal(state.searches.length,2);
  assert.deepEqual(state.searches.map((row:any)=>row.params),[
    {market:'korea',make:'BMW',model:'3 Series family',pageSize:48,sort:'updatedAt'},
    {market:'korea',pageSize:48,sort:'updatedAt'},
  ]);
  for(const row of state.searches){assert.equal(row.maximum,48);assert.equal(row.context,'related');}
  assert.equal(result.partial,false);assert.equal(result.marketTotal,17);
  assert.equal(result.sameModel[0].id,'local-korea');
});

test('cross-market recommendations for paid Korea use the same selected source and retain query limits',async()=>{
  const {state,load}=await fixture({market:'europe'});
  const result=await load({id:state.current.id,markets:['korea']});
  assert.deepEqual(state.ajes,[]);
  assert.deepEqual(state.searches.find((row:any)=>row.params.market==='korea'),{
    params:{market:'korea',make:'BMW',model:'3 Series family',pageSize:24,sort:'updatedAt'},maximum:48,context:'related',
  });
  assert.equal(result.partial,false);
  assert.equal(result.crossMarketGroups[0].market,'korea');
  assert.equal(result.crossMarketGroups[0].items[0].id,'local-korea');
});

test('legacy-selected Korea retains AJ routing until the paid source and manifest are both selected',async()=>{
  for(const [paid,published] of [[false,false],[false,true],[true,false]]){
    const {state,load}=await fixture({id:'ajes-korea-fixture',paid,published});
    const result=await load({id:state.current.id,markets:['korea']});
    assert.deepEqual(state.searches,[]);assert.equal(state.ajes.length,2);
    assert.deepEqual(state.ajes[0],{table:'korea',make:'BMW',model:'3 Series',pageSize:24});
    assert.equal(state.counts.length,1);assert.equal(result.marketTotal,9);assert.equal(result.partial,false);
  }
});

test('Japan and selected legacy China keep their existing recommendation queries',async()=>{
  for(const [market,id,table] of [['japan','ajes-stats-fixture','stats'],['china','ajes-china-fixture','china']]){
    const {state,load}=await fixture({market,id});
    const result=await load({id,markets:[market]});
    assert.deepEqual(state.searches,[]);assert.equal(state.ajes.length,2);
    assert.equal(state.ajes[0].table,table);assert.equal(state.ajes[0].model,'3 Series');
    assert.deepEqual(state.controls,[]);assert.equal(result.partial,false);
  }
});

test('an unreadable paid source selection never falls back to the retired AJ provider',async()=>{
  const {state,load}=await fixture({manifestError:true});
  const result=await load({id:state.current.id,markets:['korea']});
  assert.deepEqual(state.ajes,[]);assert.deepEqual(state.searches,[]);
  assert.equal(result.partial,true);assert.deepEqual(result.sameModel,[]);
});
