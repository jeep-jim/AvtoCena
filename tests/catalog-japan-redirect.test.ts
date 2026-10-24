import test from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {middleware} from '../apps/web/middleware';
test('paid Japanese auction links remain available without redirecting into Green Corner',async()=>{
 for(const path of ['/cars?market=japan&stock=auction&auctionGrade=4&make=Toyota&page=3','/cars/japan?make=Toyota','/cars?market=JAPAN&make=Toyota']){
  const response=await middleware(new NextRequest('https://avtocena.com'+path));
  assert.equal(response.status,200);assert.equal(response.headers.get('location'),null);
 }
});

test('Green Corner and other markets do not enter a redirect loop',async()=>{
 for(const path of ['/cars/green?market=japan&stock=green','/cars?market=korea']){
  const response=await middleware(new NextRequest('https://avtocena.com'+path));
  assert.equal(response.status,200);assert.equal(response.headers.get('location'),null);
 }
});
