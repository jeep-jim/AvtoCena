import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);

async function fixture(dealer:any={id:'fixture',href:'/dealers/fixture',markets:['japan'],preview:false}){
 const calls:any[]=[];
 (globalThis as any).__greenLayoutFixture={dealer,calls};
 const mocks:Record<string,string>={
  'resolve-browsing-context':`export const resolveDealerBrowsingContext=async(id,preview)=>{const s=globalThis.__greenLayoutFixture;s.calls.push(['dealer',id,preview]);return id?s.dealer:null;};`,
  'headers':`export const cookies=async()=>({get:()=>({value:'Новокузнецк'})});`,
  'navigation':`export const redirect=href=>{throw Error('redirect:'+href);};`,
  'green-corner':`export const readGreenCorner=async()=>{globalThis.__greenLayoutFixture.calls.push(['read']);return {items:[{id:'green-fixture'}]};};export const publicGreenOffer=x=>x;export const readGreenCornerPage=async(items,params)=>{globalThis.__greenLayoutFixture.calls.push(['query',params]);return {items,total:21,page:Number(params.page||1),facets:{makes:['Nissan']}};};`,
 };
 for(const name of ['MarketResultCount','CatalogCountLabel','CatalogSidebar','GreenCornerDeliveryBanner','CatalogFilters','CatalogLoadMore','JapanSectionTabs','PublicHeader','CatalogCard'])mocks[name]=`export function ${name}(){return null;}`;
 mocks.DealerBrowsingContext=`export function DealerBrowsingProvider(){return null;}`;
 const output=await build({entryPoints:['apps/web/components/catalog/GreenCornerCatalog.tsx'],bundle:true,platform:'node',format:'cjs',write:false,jsx:'automatic',packages:'external',plugins:[{name:'fixture',setup(b){b.onResolve({filter:/.*/},a=>{const name=a.path.split('/').at(-1)!;return mocks[name]?{path:name,namespace:'fixture'}:null;});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);
 return {render:m.exports.GreenCornerCatalog,calls};
}
function elements(tree:any){
 const found:any[]=[];
 const visit=(node:any)=>{if(Array.isArray(node)){node.forEach(visit);return;}if(!node||typeof node!=='object')return;found.push(node);for(const name of ['children','header','filters','initialCards'])visit(node.props?.[name]);};visit(tree);return found;
}

test('embedded green stock is a direct dealer-shared root without a second provider or public header',async()=>{
 const {render,calls}=await fixture();
 const params={dealer:'fixture',preview:'1',make:'Nissan',market:'japan',stock:'green',powerTo:'160',page:'2',sort:'yearDesc',q:' NOTE '};
 const before={...params};
 const tree=await render({params,embedded:true});
 assert.equal(tree.type,'div');assert.match(tree.props.className,/\bdealer-shared-catalog\b/);assert.doesNotMatch(tree.props.className,/min-h-screen/);
 const nodes=elements(tree);
 assert.equal(nodes.filter(x=>x.type?.name==='DealerBrowsingProvider').length,0);
 assert.equal(nodes.filter(x=>x.type?.name==='PublicHeader').length,0);
 const sidebar=nodes.find(x=>x.type?.name==='CatalogSidebar');assert.equal(sidebar.props.dealerLayout,true);
 const filters=nodes.find(x=>x.type?.name==='CatalogFilters');
 assert.deepEqual(filters.props.initial,{...params,city:'Новокузнецк'});
 const more=nodes.find(x=>x.type?.name==='CatalogLoadMore');assert.deepEqual(more.props.greenQuery,filters.props.initial);assert.equal(more.props.initialTotal,21);assert.equal(more.props.initialPage,2);assert.equal(more.props.initialCards.length,1);
 assert.deepEqual(nodes.find(x=>x.type?.name==='JapanSectionTabs').props,{active:'green',params:filters.props.initial});
 assert.deepEqual(calls[0],['dealer','fixture',true]);assert.equal(calls.find(x=>x[0]==='query')[1].q,'note');assert.deepEqual(params,before);
});
test('standalone green stock keeps its own provider, header and explicit city',async()=>{
 const {render}=await fixture();
 const tree=await render({params:{dealer:'fixture',city:'Москва',make:'Nissan'}});
 assert.equal(tree.type.name,'DealerBrowsingProvider');assert.equal(tree.props.dealer.id,'fixture');
 const nodes=elements(tree),main=nodes.find(x=>x.type==='main');
 assert.ok(main);assert.doesNotMatch(main.props.className,/dealer-shared-catalog/);
 assert.equal(nodes.filter(x=>x.type?.name==='DealerBrowsingProvider').length,1);assert.equal(nodes.filter(x=>x.type?.name==='PublicHeader').length,1);
 assert.equal(nodes.find(x=>x.type?.name==='CatalogSidebar').props.dealerLayout,false);
 assert.equal(nodes.find(x=>x.type?.name==='CatalogFilters').props.initial.city,'Москва');
});
test('dealer market authorization still precedes reading green inventory',async()=>{
 const {render,calls}=await fixture({id:'restricted',href:'/dealers/restricted',markets:['china'],preview:false});
 await assert.rejects(render({params:{dealer:'restricted'},embedded:true}),/redirect:\/dealers\/restricted/);
 assert.deepEqual(calls,[['dealer','restricted',false]]);
});
