import assert from 'node:assert/strict';
import test from 'node:test';
import {EncarCompleteAdapter} from '../apps/web/lib/catalog/encar-complete-source';
import {GET} from '../apps/web/app/api/internal/encar-egress-71b8e4/route';

test('Encar rejects old years before details, exposes source count and propagates access refusal',async()=>{
 const proto=EncarCompleteAdapter.prototype;
 const descriptors=Object.fromEntries(['fetchPage','normalizeOffer','fetchImages'].map(key=>[key,Object.getOwnPropertyDescriptor(proto,key)]));
 const year=new Date().getUTCFullYear();let detailCalls=0;
 try {
  proto.fetchPage=async()=>({items:[{id:'old',year:year-7},{id:'eligible',year:year-6}],count:250000,nextCursor:'next',finished:false});
  proto.normalizeOffer=(raw:any)=>({...raw,images:[]}) as any;
  proto.fetchImages=async()=>{detailCalls++;return Array.from({length:5},()=>({url:'https://example.com/car.jpg'})) as any;};
  const result=await GET(new Request('https://avtocena.com/api/internal/encar-egress-71b8e4?page=1'));
  const data=await result.json();
  assert.equal(detailCalls,1);assert.equal(data.outsideAge,1);assert.equal(data.sourceReportedCount,250000);assert.equal(data.offers.length,1);assert.equal(data.finished,false);
  proto.fetchImages=async()=>{throw Error('http_403');};
  const refused=await GET(new Request('https://avtocena.com/api/internal/encar-egress-71b8e4?page=1'));
  assert.equal(refused.status,502);assert.equal((await refused.json()).blocked,true);
 } finally {
  for(const [key,descriptor] of Object.entries(descriptors)) {
   if(descriptor)Object.defineProperty(proto,key,descriptor);else delete (proto as any)[key];
  }
 }
});
