import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedJapanPaginationCursor,japanPaginationPageApi,verifyJapanPaginationPair,japanPetrolPowerPageApi}
  from '../scripts/catalog-next/japan-browser-acceptance.mjs';

const q='a'.repeat(64),m='b'.repeat(64),now=Date.parse('2026-11-27T02:00:00.000Z');
const token=(source=2,skip=4,page=2)=>'j1.'+source+'.'+skip+'.'+page+'.'+q+'.'+(skip?m:'-');
const url=(after=token(),kind='petrol_power')=>{
 const query=new URLSearchParams({city:'Новокузнецк',page:'2',after});
 if(kind!=='plain')query.set('powerTo','160');if(kind==='petrol_power')query.set('fuel','petrol');
 return 'https://avtocena.com/cars/japan?'+query;
};
function payload(page,{count=24,more=true}={}){
 const items=Array.from({length:count},(_,i)=>({id:'ajes-stats-v'+((page-1)*24+i),market:'japan',fuel:'petrol',powerHp:100}));
 return {ok:true,page,pageSize:24,items,received:24,stale:false,partial:false,interrupted:false,scanLimited:false,
  observedAt:new Date(now-1000).toISOString(),hasMore:more,nextCursor:more?token(page+1,4,page+1):null,
  total:null,countSummary:null,powerFilterSummary:{shown:count,localPower:count,supplierPower:0,unknownPower:0}};
}
const options=(extra={})=>({observedUrl:url(),kind:'petrol_power',firstStatus:200,nextStatus:200,now,...extra});

test('new j1 grammar is bounded and binds the visible page and membership presence',()=>{
 const value=checkedJapanPaginationCursor(token(),2);
 assert.equal(value.sourcePage,2);assert.equal(value.acceptedSkip,4);assert.equal(value.visiblePage,2);
 assert.match(value.cursorSha256,/^[a-f0-9]{64}$/);assert(!JSON.stringify(value).includes(token()));
 assert.equal(checkedJapanPaginationCursor(token(3,0),2).acceptedSkip,0);
 for(const bad of ['2.4','jp1.'+'a'.repeat(32)+'.2.'+'b'.repeat(16),
  token(1_000_001),token(2,24),token(2,4,3),token(2,0).replace(/\.-$/,'.'+m),token().replace(m,'-'),
  token()+'.extra',token().replace(q,'A'.repeat(64))])
  assert.throws(()=>checkedJapanPaginationCursor(bad,2));
});

test('page2 application API is constructed only from the actual bounded ordinary UI query and token',()=>{
 const result=japanPaginationPageApi(url(),{kind:'petrol_power',expectedCursor:token()});
 const parsed=new URL(result,'https://avtocena.com');
 assert.equal(parsed.pathname,'/api/catalog/search');
 assert.deepEqual(Object.fromEntries(parsed.searchParams),{market:'japan',page:'2',pageSize:'24',city:'Новокузнецк',powerTo:'160',fuel:'petrol',after:token()});
 assert(japanPaginationPageApi(url(token(),'plain'),{kind:'plain'}).includes('after='));
 assert(japanPaginationPageApi(url(token(),'power'),{kind:'power'}).includes('powerTo=160'));
 assert.equal(japanPaginationPageApi(url().replace('/cars/japan?','/cars?market=japan&'),{kind:'petrol_power'}),result);
 for(const bad of [url().replace('https://avtocena.com','https://other.invalid'),
  url()+'&city=Москва',url()+'&refresh=1',url()+'&pageSize=48',url()+'#fragment',
  url().replace('powerTo=160','powerTo=170'),url().replace('fuel=petrol','fuel=diesel')])
  assert.throws(()=>japanPaginationPageApi(bad,{kind:'petrol_power'}));
 assert.throws(()=>japanPaginationPageApi(url(),{kind:'petrol_power',expectedCursor:token(3,4)}));
 // A new helper cannot silently weaken the old rejected-runtime cursor contract.
 assert.throws(()=>japanPetrolPowerPageApi(url()));
});

test('fresh full page1 and its observed page2 prove bounded continuity without claiming a global total',()=>{
 const result=verifyJapanPaginationPair(payload(1),payload(2),options());
 assert.equal(result.followedEmittedCursor,true);assert.equal(result.distinctRows,true);
 assert.equal(result.first.shown,24);assert.equal(result.next.shown,24);
 assert.equal(result.first.total,null);assert.equal(result.next.total,null);
 assert(!JSON.stringify(result).includes('ajes-stats-v'));
 const final=verifyJapanPaginationPair(payload(1),payload(2,{count:7,more:false}),options());
 assert.equal(final.next.shown,7);assert.equal(final.next.hasMore,false);
});

test('new page-fill proof retains stale, partial, expiry and short-page rejection',()=>{
 for(const patch of [{stale:true},{partial:true},{interrupted:true},{scanLimited:true},
  {observedAt:new Date(now-30*60_000-1).toISOString()}])
  assert.throws(()=>verifyJapanPaginationPair(payload(1),{...payload(2),...patch},options()));
 assert.throws(()=>verifyJapanPaginationPair(payload(1),payload(2,{count:23}),options()));
 assert.throws(()=>verifyJapanPaginationPair(payload(1,{count:23}),payload(2),options()));
 assert.throws(()=>verifyJapanPaginationPair(payload(1),payload(2),options({nextStatus:500})));
});

test('changed tokens, duplicate rows, wrong visible page, false exact total and lost city fail closed',()=>{
 const next=payload(2);next.items[0]={...payload(1).items[0]};
 assert.throws(()=>verifyJapanPaginationPair(payload(1),next,options()));
 assert.throws(()=>verifyJapanPaginationPair(payload(1),payload(2),options({observedUrl:url(token(3,4))})));
 assert.throws(()=>verifyJapanPaginationPair(payload(1),{...payload(2),page:3},options()));
 assert.throws(()=>verifyJapanPaginationPair({...payload(1),total:600000},payload(2),options()));
 assert.throws(()=>verifyJapanPaginationPair({...payload(1),total:600000},payload(2),options({kind:'plain',observedUrl:url(token(),'plain')})));
 assert.throws(()=>verifyJapanPaginationPair(payload(1),payload(2),options({observedUrl:url()+'&city=Москва'})));
 assert.throws(()=>verifyJapanPaginationPair(payload(1),{...payload(2),nextCursor:token(3,4,2)},options()));
});
