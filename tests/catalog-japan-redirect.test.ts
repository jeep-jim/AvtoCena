import test from 'node:test';
import assert from 'node:assert/strict';
import {NextRequest} from 'next/server';
import {middleware} from '../apps/web/middleware';
test('paid Japanese auction query links have a single canonical redirect preserving source, grade and page',async()=>{
 for(const [path,target] of [
  ['/cars?market=japan&stock=auction&auctionGrade=4&make=Toyota&page=3','/cars/japan/Toyota?stock=auction&auctionGrade=4&page=3'],
  ['/cars/japan?make=Toyota','/cars/japan/Toyota'],
 ]){
  const response=await middleware(new NextRequest('https://avtocena.com'+path));
  assert.equal(response.status,308);assert.equal(response.headers.get('location'),'https://avtocena.com'+target);
  assert.doesNotMatch(response.headers.get('location')!,/\/green/);
  const final=await middleware(new NextRequest('https://avtocena.com'+target));
  assert.equal(final.status,200);assert.equal(final.headers.get('location'),null);
 }
 const uppercase=await middleware(new NextRequest('https://avtocena.com/cars?market=JAPAN&make=Toyota'));
 assert.equal(uppercase.status,200);assert.equal(uppercase.headers.get('location'),null);
});
test('Green Corner retains its own route; Korea reaches its canonical country page without a loop',async()=>{
 const green=await middleware(new NextRequest('https://avtocena.com/cars/green?market=japan&stock=green'));
 assert.equal(green.status,200);assert.equal(green.headers.get('location'),null);
 const korea=await middleware(new NextRequest('https://avtocena.com/cars?market=korea'));
 assert.equal(korea.status,308);assert.equal(korea.headers.get('location'),'https://avtocena.com/cars/korea');
 const final=await middleware(new NextRequest(korea.headers.get('location')!));
 assert.equal(final.status,200);assert.equal(final.headers.get('location'),null);
});
