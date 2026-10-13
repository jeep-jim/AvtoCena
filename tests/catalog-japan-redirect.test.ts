import test from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {middleware} from '../apps/web/middleware';
test('Japan auction links redirect before HTML streaming and preserve stock filters',async()=>{
 for(const path of ['/cars?market=japan&stock=auction&auctionGrade=4&make=Toyota&page=3','/cars/japan?make=Toyota','/cars?market=JAPAN&make=Toyota']){
  const response=await middleware(new NextRequest('https://avtocena.com'+path));
  assert.equal(response.status,307);
  const target=new URL(response.headers.get('location')!);
  assert.equal(target.pathname,'/cars/green');assert.equal(target.searchParams.get('stock'),'green');assert.equal(target.searchParams.get('make'),'Toyota');
  assert.equal(target.searchParams.has('auctionGrade'),false);assert.equal(target.searchParams.has('page'),false);
 }
});
test('Green Corner and other markets do not enter a redirect loop',async()=>{
 for(const path of ['/cars/green?market=japan&stock=green','/cars?market=korea']){
  const response=await middleware(new NextRequest('https://avtocena.com'+path));
  assert.equal(response.status,200);assert.equal(response.headers.get('location'),null);
 }
});
