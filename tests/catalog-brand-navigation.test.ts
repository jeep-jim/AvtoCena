import test from 'node:test';
import assert from 'node:assert/strict';
import {brandContextQuery,brandSelectionQuery,brandFilterHref,catalogFilterHref} from '../apps/web/lib/catalog/brand-navigation';
test('brand selection on country routes preserves country, source and filters',()=>{
 for(const market of ['china','korea','japan']){
  const context=brandContextQuery('city=Красноярск&page=4',{market,source:'ajes',fuel:'petrol',yearFrom:'2022',model:'Old'});
  const p=new URLSearchParams(brandSelectionQuery(context,['Toyota']));
  assert.equal(p.get('market'),market);assert.equal(p.get('source'),'ajes');assert.equal(p.get('city'),'Красноярск');assert.equal(p.get('fuel'),'petrol');assert.equal(p.get('yearFrom'),'2022');assert.equal(p.get('make'),'Toyota');assert.equal(p.has('model'),false);assert.equal(p.has('page'),false);
  const cleared=new URLSearchParams(brandSelectionQuery(p.toString(),[]));assert.equal(cleared.has('make'),false);assert.equal(cleared.get('market'),market);
 }
});
test('server-resolved route context takes precedence while unrelated query values survive',()=>{
 const p=new URLSearchParams(brandContextQuery('market=korea&dealer=test',{market:'china',make:'Toyota'}));assert.equal(p.get('market'),'china');assert.equal(p.get('dealer'),'test');assert.equal(p.get('make'),'Toyota');
});

test('public logos and the sidebar share canonical routes in all markets; an old cut is not a filter',()=>{
 for(const market of ['china','korea','japan','uae','europe','georgia']){
  const context=brandContextQuery('page=2&after=old&preparedCut=gen_old&model=Old&source=manual&selection=1&fuel=petrol&sort=year',{market});
  const url=brandFilterHref(context,['Toyota'],null,'Новокузнецк');
  const parsed=new URL(url,'https://example.test');
  assert.equal(parsed.pathname,`/cars/${market}/Toyota`,market);
  assert.equal(parsed.searchParams.get('source'),'manual');
  assert.equal(parsed.searchParams.get('fuel'),'petrol');
  assert.equal(parsed.searchParams.get('sort'),'year');
  assert.equal(parsed.searchParams.get('selection'),'1');
  assert.equal(parsed.searchParams.get('city'),'Новокузнецк');
  assert.ok(['preparedCut','page','after','model','brand'].every(k=>!parsed.searchParams.has(k)));
  assert.equal(url,catalogFilterHref(new URLSearchParams(`source=manual&selection=1&fuel=petrol&sort=year&market=${market}&make=Toyota&city=Новокузнецк`),null));
  const clear=new URL(brandFilterHref(context,[],null),'https://example.test');
  assert.equal(clear.pathname,`/cars/${market}`);
  assert.equal(clear.searchParams.get('source'),'manual');
 }
});
test('public default, mixed markets, green and untouched dealer routing remain supported',()=>{
 assert.equal(brandFilterHref('fuel=hybrid',['BMW'],null),'/cars?fuel=hybrid&make=BMW');
 const mixed=new URL(brandFilterHref('market=china%7Ckorea&city=Новосибирск',['Mercedes-Benz','BMW'],null),'https://example.test');
 assert.equal(mixed.pathname,'/cars');assert.equal(mixed.searchParams.get('market'),'china|korea');
 assert.equal(mixed.searchParams.get('make'),'BMW,Mercedes-Benz');
 const green=new URL(brandFilterHref('market=japan&stock=green&page=5',['Toyota'],null),'https://example.test');
 assert.equal(green.pathname,'/cars/green');assert.equal(green.searchParams.get('stock'),'green');
 const dealer={id:'fixture',name:'Fixture',href:'/dealers/fixture/cars?preview=1',preview:true,logoLight:'',logoDark:'',markets:['china']} as const;
 const href=catalogFilterHref(new URLSearchParams('market=china&make=Toyota'),{...dealer,markets:['china']});
 assert.equal(href,'/dealers/fixture/cars?preview=1&market=china&make=Toyota');
});
