import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('all-market filtered results retain Japan, filtered stock and navigation conditions',async()=>{
 const mocks:Record<string,string>={
 'ajes-market-selection':`export const usesAjesMarket=async market=>['china','korea','japan'].includes(market);`,
 'ajes-catalog':`export const withAjesCount=async x=>x;`,
 'green-corner-search':`export const filterGreenCorner=(items,params)=>items.filter(x=>x.make===params.make&&x.powerHp<=Number(params.powerTo));export const greenCornerFacets=()=>({});`,
 'green-corner':`export const readGreenCorner=async()=>({items:[{id:'match',make:'Volkswagen',powerHp:150},{id:'too-powerful',make:'Volkswagen',powerHp:200},{id:'wrong-brand',make:'Toyota',powerHp:100}]});export const publicGreenOffer=x=>x;export const currentGreenCornerPrices=async x=>x;`,
 'storage':`export const readCatalogFacets=async()=>({});export const searchOffers=async()=>({total:0,items:[],page:1,pageSize:10});`,
 'market-facets':`export const readGroupedCatalogFacets=async()=>({});`,
 'overview':`export const readCatalogOverview=async()=>null;`,
 'market-page':`export const readCatalogMarketPage=async()=>({total:0,items:[]});export const balanceBusinessRows=x=>x;export const businessOrder=()=>0;export const sortCatalogRows=x=>x;`,
 'live-business-pricing':`export const applyActiveBusinessPricingBatch=async x=>x;`,
 'offer-quality':`export const isRenderablePublicCatalogOffer=()=>true;`,
 'DealerBrowsingContext':`export const DealerLink=({children})=>children;`,
 'navigation':`export const redirect=()=>{throw Error('unexpected redirect')};`,
 };
 const ui=['GreenCornerCatalog','AjesCatalog','AjesRail','JapanSectionTabs','GreenCornerRail','PublicHeader','BrandLogoRail','CatalogLoadMore','CatalogCard','CatalogMarketFlag','CatalogFilters','CurrencyRatesStrip'];
 for(const name of ui)mocks[name]=`export function ${name}(){return null;}`;
 const output=await build({entryPoints:['apps/web/components/catalog/CatalogContent.tsx'],bundle:true,platform:'node',format:'cjs',write:false,jsx:'automatic',packages:'external',plugins:[{name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>{const n=a.path.split('/').at(-1)!;if(mocks[n])return {path:n,namespace:'fixtures'};});b.onLoad({filter:/.*/,namespace:'fixtures'},a=>({contents:mocks[a.path],loader:'js'}));}}]});
 const m={exports:{} as any};new Function('require','module','exports',output.outputFiles[0].text)(require,m,m.exports);
 const params={make:'Volkswagen',powerTo:'160',sort:'totalRub',city:'Новокузнецк'};
 const tree=await m.exports.CatalogContent({params});const elements:any[]=[];
 const walk=(node:any)=>{if(Array.isArray(node)){node.forEach(walk);return;}if(!node||typeof node!=='object')return;elements.push(node);walk(node.props?.children);};walk(tree);
 const rails=elements.filter(x=>x.type?.name==='AjesRail');
 assert.equal(rails.length,3);assert.deepEqual(rails.find(x=>!x.props.market).props.params,params);
 const green=elements.find(x=>x.type?.name==='GreenCornerRail');assert.equal(green.props.total,1);assert.equal(green.props.items[0].id,'match');
 const link=new URL(green.props.href,'https://avtocena.com');for(const [key,value] of Object.entries(params))assert.equal(link.searchParams.get(key),value);assert.equal(link.searchParams.get('stock'),'green');
});
