import test from 'node:test';
import assert from 'node:assert/strict';
import {adoptSelectionCity,readSelectedCity,persistCity} from '../apps/web/lib/location/selected-city';
import {dealerBrowsingHref} from '../apps/web/lib/dealers/browsing-context';
test('selection replaces stored city and retains it on cards and reload; later manual choice wins',()=>{
 const previous={window:globalThis.window,document:globalThis.document,localStorage:globalThis.localStorage};
 const values=new Map([['avtocena_city','Москва']]);let url=new URL('https://avtocena.com/dealers/dealer_topavto?selection=1&city=Новокузнецк');
 const win:any=new EventTarget();Object.defineProperty(win,'location',{get:()=>url});win.history={state:{},replaceState(_a:any,_b:any,path:string){url=new URL(path,url);}};
 Object.assign(globalThis,{window:win,document:{cookie:'avtocena_city='+encodeURIComponent('Москва')},localStorage:{getItem:(k:string)=>values.get(k)??null,setItem:(k:string,v:string)=>values.set(k,v)}});
 try{
  assert.equal(adoptSelectionCity(url.search),true);
  assert.equal(values.get('avtocena_city'),'Новокузнецк');
  const href=dealerBrowsingHref('/cars/offer/car',{id:'dealer_topavto',href:'/dealers/dealer_topavto',preview:false} as any,readSelectedCity());
  url=new URL(href,url);assert.equal(url.searchParams.get('city'),'Новокузнецк');assert.equal(url.searchParams.get('dealer'),'dealer_topavto');
  url=new URL('/cars/offer/car',url);assert.equal(readSelectedCity(),'Новокузнецк');
  persistCity('Казань');assert.equal(readSelectedCity(),'Казань');
  assert.equal(adoptSelectionCity('?selection=1'),false);assert.equal(readSelectedCity(),'Казань');
  assert.equal(adoptSelectionCity('?city=Москва'),false);
  assert.equal(adoptSelectionCity('?selection=1&city=%3Cscript%3E'),false);
 }finally{Object.assign(globalThis,previous);}
});
