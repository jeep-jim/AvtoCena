import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('market cards remain ready and their late count resolves with exactly the same filtered query',async()=>{
 let resolveCount:(v:any)=>void=()=>{};
 const state={queries:[] as any[],options:[] as any[],countKeys:[] as string[],count:new Promise(resolve=>{resolveCount=resolve;})};
 (globalThis as any).__railFixture=state;
 const mocks:Record<string,string>={
  'ajes-catalog':`export const readAjesCatalogPage=async(q,measure,options)=>{globalThis.__railFixture.queries.push(q);globalThis.__railFixture.options.push(options);return {items:[{id:'car'}],countSummary:null,hasMore:true};};export const readAjesCountSummary=key=>{globalThis.__railFixture.countKeys.push(key);return globalThis.__railFixture.count;};`,
  'ajes-query':`export class AjesFilterUnavailable extends Error{}`,
  'collection-controls':`export const assertCollectionEnabled=async()=>{};`,
  'storage':`export const publicOffer=x=>x;`,
  'DealerBrowsingContext':`export const DealerLink=()=>null;`,
 };
 for(const name of ['CatalogCard','CatalogMarketFlag','CatalogSectionLoading'])mocks[name==='CatalogSectionLoading'?'CatalogLoading':name]=`export function ${name}(){return null;}`;
 try{
  const built=await build({entryPoints:['apps/web/components/catalog/AjesRail.tsx'],bundle:true,platform:'node',format:'cjs',write:false,jsx:'automatic',packages:'external',plugins:[{name:'rail-fixture',setup(b){b.onResolve({filter:/.*/},a=>{const name=a.path.split('/').at(-1)!;return name in mocks?{path:name,namespace:'stub'}:undefined;});b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:mocks[a.path]}));}}]});
  const mod={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,mod,mod.exports);
  for(const market of ['korea','japan','china']){
   const params={make:'Hyundai',model:'TUCSON',city:'Новокузнецк',market:'korea|japan'};
   const tree=await mod.exports.AjesRail({market,params});
   assert.deepEqual(state.options.at(-1),{includeCount:false,fillPreview:true});
   assert.equal(state.queries.at(-1).pageSize,'6');
   const nodes:any[]=[];function walk(node:any){if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;nodes.push(node);walk(node.props?.children);}walk(tree);
   assert.equal(nodes.filter(x=>x.type?.name==='CatalogCard').length,1);
   const late=nodes.find(x=>x.type?.name==='RailCount');assert.ok(late,'late count remains mounted after cards returned');
   const pending=late.type(late.props);resolveCount({total:20890,upperBound:false,stale:false,observedAt:'now'});
   const counter=await pending;assert.equal(counter.props.total,20890);
   assert.deepEqual(JSON.parse(state.countKeys.at(-1)!),state.queries.at(-1));
  }
  for(const market of ['japan','korea']){
   const tree=await mod.exports.AjesRail({market,params:{budget:'1500000',city:'Новокузнецк',page:'5',after:'1.0',source:'existing'},prepared:Promise.resolve({items:[],count:null,hasMore:true,nextCursor:'7.0',filteredByPage:true,partial:false,stale:false})});
   const nodes:any[]=[];function walk(node:any){if(Array.isArray(node))return node.forEach(walk);if(!node||typeof node!=='object')return;nodes.push(node);walk(node.props?.children);}walk(tree);
   const link=nodes.find(n=>n.props?.children==='Продолжить поиск');assert.ok(link);
   const q=new URL(link.props.href,'https://avtocena.com').searchParams;
   assert.equal(q.get('after'),'7.0');assert.equal(q.get('budget'),'1500000');assert.equal(q.get('city'),'Новокузнецк');assert.equal(q.get('market'),market);assert.equal(q.has('page'),false);assert.equal(q.has('source'),false);
   const all=nodes.find(n=>n.props?.children==='Все →');assert.equal(new URL(all.props.href,'https://avtocena.com').searchParams.has('after'),false);
  }
 }finally{delete (globalThis as any).__railFixture;}
});
