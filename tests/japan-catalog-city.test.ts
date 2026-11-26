import test from 'node:test';
import assert from 'node:assert/strict';
import {adoptJapanCatalogCity,japanCatalogCity,persistCity,readSelectedCity} from '../apps/web/lib/location/selected-city';

function withBrowser(path:string,run:(browser:{navigate:(path:string)=>void;url:()=>URL;stored:()=>string|null;clear:()=>void})=>void){
 const previous={window:globalThis.window,document:globalThis.document,localStorage:globalThis.localStorage};
 let url=new URL(path,'https://avtocena.com');
 const values=new Map([['avtocena_city','Москва']]);
 const win:any=new EventTarget();
 Object.defineProperty(win,'location',{get:()=>url});
 win.history={state:{},replaceState(_a:any,_b:any,path:string){url=new URL(path,url);}};
 const document={cookie:'avtocena_city='+encodeURIComponent('Москва')};
 Object.assign(globalThis,{window:win,document,localStorage:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value)}});
 try{run({navigate:path=>{url=new URL(path,url);win.dispatchEvent(new Event('popstate'));},url:()=>url,stored:()=>values.get('avtocena_city')??null,clear:()=>{document.cookie='';values.clear();}});}
 finally{Object.assign(globalThis,previous);}
}

test('Japan URL delivery city wins before hydration adoption and survives the detail visit',()=>{
 for(const path of ['/cars/japan?fuel=petrol&city=Новокузнецк','/cars?market=japan&fuel=petrol&city=Новокузнецк','/cars/japan/Toyota/Noah?city=Новокузнецк'])withBrowser(path,browser=>{
  const original=browser.url().href;
  assert.equal(readSelectedCity(),'Новокузнецк');
  assert.equal(browser.stored(),'Москва','reading the snapshot has no storage side effect');
  assert.equal(adoptJapanCatalogCity(),true);
  assert.equal(browser.stored(),'Новокузнецк');
  assert.equal(browser.url().href,original,'adoption does not rewrite filters or history');
  browser.navigate('/cars/offer/ajes-stats-example');
  assert.equal(readSelectedCity(),'Новокузнецк');
 });
});

test('a new manual city and clearing the city supersede the original Japan URL',()=>{
 withBrowser('/cars/japan?fuel=petrol&city=Новокузнецк',browser=>{
  adoptJapanCatalogCity();
  persistCity('Казань');
  assert.equal(browser.url().searchParams.get('city'),'Казань');
  assert.equal(browser.url().searchParams.get('fuel'),'petrol');
  assert.equal(readSelectedCity(),'Казань');
  adoptJapanCatalogCity();
  assert.equal(browser.stored(),'Казань');
  persistCity('');
  assert.equal(browser.url().searchParams.has('city'),false);
  assert.equal(adoptJapanCatalogCity(),false);
  assert.equal(readSelectedCity(),'');
  assert.equal(browser.stored(),'');
 });
});

test('Back to an explicit Japan search restores that search city for subsequent details',()=>{
 withBrowser('/cars/japan?city=Новокузнецк',browser=>{
  adoptJapanCatalogCity();persistCity('Казань');
  browser.navigate('/cars?market=japan&fuel=petrol&powerTo=160&city=Новокузнецк');
  assert.equal(readSelectedCity(),'Новокузнецк');adoptJapanCatalogCity();
  browser.navigate('/cars/offer/ajes-stats-example');
  assert.equal(readSelectedCity(),'Новокузнецк');
 });
});

test('an explicit blank city clears stale Japan delivery context; an omitted city preserves it',()=>{
 withBrowser('/cars/japan?city=%20',browser=>{
  assert.equal(readSelectedCity(),'');assert.equal(adoptJapanCatalogCity(),true);assert.equal(browser.stored(),'');
 });
 withBrowser('/cars/japan?fuel=petrol',browser=>{
  assert.equal(readSelectedCity(),'Москва');assert.equal(adoptJapanCatalogCity(),false);assert.equal(browser.stored(),'Москва');
 });
});

test('invalid Japan query cities cannot replace stored delivery context',()=>{
 for(const city of ['<script>','Москва\u0000', 'x'.repeat(301)])withBrowser('/cars/japan?city='+encodeURIComponent(city),browser=>{
  assert.equal(japanCatalogCity(browser.url().pathname,browser.url().search),null);
  assert.equal(adoptJapanCatalogCity(),false);assert.equal(readSelectedCity(),'Москва');assert.equal(browser.stored(),'Москва');
  browser.clear();assert.equal(readSelectedCity(),'');
 });
});

test('other markets, Green Corner and ordinary navigation keep their existing stored-city precedence',()=>{
 for(const path of ['/cars/china?city=Новокузнецк','/cars/korea?city=Новокузнецк','/cars?market=japan%7Cchina&city=Новокузнецк','/cars/green?city=Новокузнецк','/cars/japan?stock=green&city=Новокузнецк','/?city=Новокузнецк','/cars/offer/ajes-stats-example?city=Новокузнецк'])withBrowser(path,browser=>{
  assert.equal(adoptJapanCatalogCity(),false);assert.equal(readSelectedCity(),'Москва');assert.equal(browser.stored(),'Москва');
 });
});
