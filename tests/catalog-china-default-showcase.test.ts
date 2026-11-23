import test from 'node:test';
import assert from 'node:assert/strict';
import {readMixedMarketCounts} from '../apps/web/lib/catalog/mixed-market-count';
import {confirmedMarketMinimum} from '../apps/web/lib/catalog/count-format';
import {countRequestMarkets, marketSelectionUrl} from '../apps/web/lib/catalog/market-selection';
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

test('home power count keeps verified markets when the independent or auction count is missing', async () => {
 const url = new URL('https://avtocena.com/api/catalog/search?countOnly=1&powerTo=160');
 const markets = countRequestMarkets(url.searchParams, true);
 const counts: Record<string, number> = {korea: 8130, europe: 2765, uae: 3, georgia: 33, green: 503};
 const result = await readMixedMarketCounts(markets, async market => {
  const params = marketSelectionUrl(url, market).searchParams;
  assert.equal(params.get('powerTo'), '160');
  if (market === 'china') return new Response(null, {status:503});
  if (market === 'japan') return Response.json({ok:true, total:null, countIncomplete:true});
  if (market === 'green') assert.equal(params.get('stock'), 'green');
  return Response.json({ok:true, total:counts[market]});
 });
 assert.deepEqual(result.marketCounts, counts);
 assert.deepEqual(result.missingMarkets, ['china','japan']);
 assert.equal(confirmedMarketMinimum({ok:true,...result}), 'Нашли не менее 11\u00a0434 🚗');
 for(const partial of [
  {total:0,marketCounts:{korea:0}},
  {total:11435},
  {marketCounts:{china:11434}},
  {marketCounts:{korea:-1,europe:11435}},
  {missingMarkets:[]},
 ]) assert.equal(confirmedMarketMinimum({ok:true,...result,...partial}), undefined);
});

test('single markets, source-specific searches, legacy storage and other filters keep their original count scope', () => {
 const scope = (query:string, independent = true) => countRequestMarkets(new URLSearchParams(query), independent);
 assert.deepEqual(scope('powerTo=160&market=korea'), ['korea']);
 assert.deepEqual(scope('powerTo=160&market=japan&stock=green'), ['japan']);
 assert.deepEqual(scope('powerTo=160&stock=green'), []);
 assert.deepEqual(scope('powerTo=160&source=ajes'), []);
 assert.deepEqual(scope('powerTo=160', false), []);
 assert.deepEqual(scope('make=Toyota'), []);
 assert.deepEqual(scope('powerTo=invalid'), []);
 assert.deepEqual(scope('market=china%7Ckorea'), ['china','korea']);
 assert.deepEqual(scope('powerFrom=80&market=any'), scope('powerTo=160'));
});
