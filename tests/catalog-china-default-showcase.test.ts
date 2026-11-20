import test from 'node:test';
import assert from 'node:assert/strict';
import {chinaExactListHref,isChinaDefaultShowcaseQuery} from '../apps/web/lib/catalog/china-default-showcase';
import {readMixedMarketCounts} from '../apps/web/lib/catalog/mixed-market-count';
test('only initial default China receives a labeled showcase; exact link preserves city and explicit page',()=>{
 assert.ok(isChinaDefaultShowcaseQuery({market:'china'}));
 assert.ok(isChinaDefaultShowcaseQuery({market:'china',city:'Новокузнецк'}));
 for(const control of [{page:'1'},{sort:'updatedAt'},{model:'X3'},{powerTo:'160'},{hasPrice:'yes'},{unexpected:'1'},{city:['Омск']}])
  assert.ok(!isChinaDefaultShowcaseQuery({market:'china',...control}));
 assert.ok(!isChinaDefaultShowcaseQuery({market:'korea'}));
 const url=new URL(chinaExactListHref('Новокузнецк'),'https://avtocena.com');
 assert.equal(url.pathname,'/cars/china');assert.equal(url.searchParams.get('page'),'1');assert.equal(url.searchParams.get('city'),'Новокузнецк');
});
test('count batch preserves other markets on 503, exception, indefinite timeout and estimate',async()=>{
 let signal:AbortSignal|undefined;
 const result=await readMixedMarketCounts(['china','korea','europe','uae','japan','georgia'],async(m,s)=>{
  if(m==='china')return new Response(null,{status:503});
  if(m==='europe')throw Error('backend');
  if(m==='japan'){signal=s;return new Promise(()=>{});}
  if(m==='uae')return Response.json({ok:true,total:999,countIncomplete:true});
  return Response.json({ok:true,total:m==='korea'?81:0});
 },{timeoutMs:30});
 assert.ok(signal?.aborted);
 assert.deepEqual(result,{total:81,countIncomplete:true,marketCounts:{korea:81,georgia:0},missingMarkets:['china','europe','uae','japan']});
 const no=await readMixedMarketCounts(['china','korea'],async()=>Response.json({error:'no'},{status:404}));
 assert.equal(no.total,null);assert.deepEqual(no.marketCounts,{});
 const yes=await readMixedMarketCounts(['china','korea'],async()=>Response.json({ok:true,total:2}));
 assert.deepEqual(yes,{total:4,countIncomplete:false,marketCounts:{china:2,korea:2},missingMarkets:[]});
});
