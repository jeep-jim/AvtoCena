import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {createElement,isValidElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const require=createRequire(import.meta.url);
async function resolved(node:any):Promise<any> {
 if(Array.isArray(node))return Promise.all(node.map(resolved));
 if(!isValidElement(node))return node;
 const element:any=node;
 if(typeof element.type==='function')return resolved(await element.type(element.props));
 const props={...element.props};
 if('children' in props)props.children=await resolved(props.children);
 return createElement(element.type,props);
}
async function fixture(t:any){
 const state={control:'enabled',pageReads:[] as any[],countReads:[] as any[],cardOffers:[] as any[],
  page:{items:[] as any[],countSummary:null as any,received:0,pageSize:24,hasMore:false,partial:false,stale:false,filteredByPage:false,observedAt:'2026-11-26T04:30:00Z'},
  count:{total:660813,upperBound:false,stale:false,observedAt:'2026-11-26T04:30:00Z'}};
 (globalThis as any).__japanRailVisibility=state;t.after(()=>{delete (globalThis as any).__japanRailVisibility;});
 const mocks:Record<string,string>={
  'collection-controls':`export class CollectionDisabledError extends Error{};export const assertCollectionEnabled=async()=>{const state=globalThis.__japanRailVisibility;if(state.control==='disabled')throw new CollectionDisabledError();if(state.control==='unreadable')throw Error('settings storage unavailable');};`,
  'ajes-catalog':`export const readAjesCatalogPage=async(q,_measure,options)=>{const s=globalThis.__japanRailVisibility;s.pageReads.push({q,options});return s.page;};export const readAjesCountSummary=async key=>{const s=globalThis.__japanRailVisibility;s.countReads.push(JSON.parse(key));return s.count;};`,
  'ajes-query':`export class AjesFilterUnavailable extends Error{}`,
  'storage':'export const publicOffer=x=>x;',
  'DealerBrowsingContext':`import {createElement} from 'react';export const DealerLink=props=>createElement('a',props);`,
  'CatalogCard':`import {createElement} from 'react';export const CatalogCard=({offer})=>{globalThis.__japanRailVisibility.cardOffers.push(offer);return createElement('article',{'data-car-id':offer.id},offer.id);};`,
  'CatalogMarketFlag':`import {createElement} from 'react';export const CatalogMarketFlag=()=>createElement('span',{'aria-hidden':true},'🇯🇵');`,
 };
 const out=await build({stdin:{contents:'export * from "./apps/web/components/catalog/AjesRail";export * from "./apps/web/components/catalog/JapanRailFrame";',resolveDir:process.cwd()},bundle:true,platform:'node',format:'cjs',jsx:'automatic',write:false,packages:'external',loader:{'.css':'empty'},plugins:[{name:'japan-rail-fixture',setup(b){
  b.onResolve({filter:/.*/},a=>{const name=a.path.split('/').at(-1)!;return mocks[name]?{path:name,namespace:'fixture'}:undefined;});
  b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:mocks[a.path],resolveDir:process.cwd()}));
 }}]});
 const mod={exports:{} as any};new Function('require','module','exports',out.outputFiles[0].text)(require,mod,mod.exports);
 return {state,api:mod.exports,html:async(node:any)=>renderToStaticMarkup(await resolved(node))};
}

test('enabled empty Japanese preview keeps its title, independently known count and filtered catalogue link',async t=>{
 const {state,api,html}=await fixture(t);
 const params={city:'Новокузнецк',powerTo:'160',make:'Toyota',page:'6',pageSize:'12',after:'old-cursor',source:'existing',market:'korea|japan'};
 const markup=await html(await api.AjesRail({params}));
 assert.match(markup,/aria-label="Япония"/);assert.match(markup,/660\s?813|660&#x27;813/);
 assert.match(markup,/В этой подборке автомобили пока не отображаются/);
 assert.doesNotMatch(markup,/По выбранным параметрам автомобили не найдены/);
 const href=new URL(api.japanRailHref(params),'https://avtocena.com');
 assert.equal(href.pathname,'/cars/japan');assert.equal(href.searchParams.get('powerTo'),'160');
 assert.equal(href.searchParams.get('city'),'Новокузнецк');assert.equal(href.searchParams.get('make'),'Toyota');
 for(const key of ['page','pageSize','source','market','after'])assert.equal(href.searchParams.has(key),false);
 assert.equal(state.pageReads.length,1);assert.equal(state.countReads.length,1);
 assert.deepEqual(state.pageReads[0].options,{includeCount:false});
 assert.deepEqual(state.countReads[0],state.pageReads[0].q);
});

test('an unreadable collection switch stays fail-closed and visibly unavailable instead of hiding Japan',async t=>{
 const {state,api,html}=await fixture(t);state.control='unreadable';
 const data=await api.readAjesRailData('japan');
 assert.equal(data.disabled,false);assert.equal(data.unavailable,true);
 const markup=await html(await api.AjesRail({prepared:Promise.resolve(data)}));
 assert.match(markup,/aria-label="Япония"/);assert.match(markup,/Не удалось загрузить автомобили/);
 assert.match(markup,/Количество уточняется/);assert.equal(state.pageReads.length,0);assert.equal(state.countReads.length,0);
});

test('an explicitly disabled Japanese source is still hidden without supplier page or count reads',async t=>{
 const {state,api}=await fixture(t);state.control='disabled';
 assert.equal(await api.AjesRail(),null);
 assert.equal(await api.readAjesRailCount('japan',{}),null);
 assert.equal(state.pageReads.length,0);assert.equal(state.countReads.length,0);
});

test('partial and stale Japanese previews keep their cards and expose the saved or partial status',async t=>{
 const {state,api,html}=await fixture(t);
 state.page={...state.page,items:[{id:'auction-1'}],partial:true,stale:true};
 const markup=await html(await api.AjesRail());
 assert.match(markup,/data-car-id="auction-1"/);assert.match(markup,/Показана сохранённая подборка от 26\.11\.2026, 11:30/);
 state.page={...state.page,items:[],stale:false};
 assert.match(await html(await api.AjesRail()),/В загруженной подборке совпадений нет/);
 state.page={...state.page,partial:false,countSummary:{...state.count,total:0}};
 assert.match(await html(await api.AjesRail()),/По выбранным параметрам автомобили не найдены/);
});

test('the streamed Japanese fallback has the same accessible title and preserves the selected city and filters',async t=>{
 const {api,html}=await fixture(t);
 const markup=await html(api.JapanRailLoading({params:{city:'Казань',fuel:'electric',powerTo:'160'}}));
 assert.match(markup,/aria-label="Япония"/);assert.match(markup,/aria-busy="true"/);assert.match(markup,/Загружаем автомобили/);
 assert.match(markup,/\/cars\/japan\?/);assert.match(markup,/fuel=electric/);assert.match(markup,/powerTo=160/);
 assert.match(markup,/Количество уточняется/);assert.doesNotMatch(markup,/data-catalog-market-count="0"/);
});

test('a quiet Japanese power rail preserves supplier and unknown card evidence without a false exact count',async t=>{
 const {state,api,html}=await fixture(t);
 const offers=[
  {id:'ajes-stats-known',market:'japan',sourceId:'ajes_japan_feed',japanSupplierPower:{offerId:'ajes-stats-known',hp:160,unit:'hp',source:'ajes_pw'}},
  {id:'ajes-stats-unknown',market:'japan',sourceId:'ajes_japan_feed',japanPowerUnknown:true},
 ];
 const expected=structuredClone(offers);
 state.page={...state.page,items:offers,filteredByPage:true,hasMore:true};
 state.count={...state.count,total:0,upperBound:true};
 const markup=await html(await api.AjesRail({params:{powerTo:'160'}}));
 assert.match(markup,/data-japan-auction-rail="true"/);assert.match(markup,/data-status="ready"/);
 assert.doesNotMatch(markup,/Мощность по данным поставщика:/);assert.doesNotMatch(markup,/Мощность не указана:/);
 assert.doesNotMatch(markup,/Отбор не подтверждает право/);assert.match(markup,/Количество уточняется/);
 assert.doesNotMatch(markup,/data-catalog-market-count="0"/);
 assert.equal((markup.match(/data-car-id=/g)||[]).length,2);
 assert.deepEqual(state.cardOffers,expected);
 assert.deepEqual(state.page.items,expected,'the rail must not mutate the original power evidence');
 assert.deepEqual(state.cardOffers[0].japanSupplierPower,{offerId:'ajes-stats-known',hp:160,unit:'hp',source:'ajes_pw'});
 assert.equal(state.cardOffers[1].japanPowerUnknown,true);
 assert.equal(Object.hasOwn(state.cardOffers[1],'japanSupplierPower'),false);
 for(const offer of state.cardOffers)for(const field of ['powerHp','powerKw'])
  assert.equal(Object.hasOwn(offer,field),false,'the rail must not invent or promote '+field);
});
