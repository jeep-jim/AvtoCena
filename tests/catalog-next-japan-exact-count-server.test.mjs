import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createExactCountFixtureHandler} from './browser/japan-exact-count.mjs';
import {japanExactCountApi} from '../scripts/catalog-next/japan-exact-count-browser.mjs';
import {japanPriceSortApi} from '../scripts/catalog-next/japan-price-sort-browser.mjs';

const city='Новокузнецк';
const api=query=>'/api/catalog/search?'+new URLSearchParams({market:'japan',city,page:'1',pageSize:'24',...query});
const state=()=>({now:new Date().toISOString(),requests:[],remount:false});

async function fixtureServer(t,{renderMarkup=()=>'<main>actual handler SSR response</main>'}={}){
  const active=state(),rejections=[];
  const handler=createExactCountFixtureHandler({fixture:{renderMarkup,css:'body{}',javascript:Buffer.from('void 0;')},getActive:()=>active});
  // Catch the handler's rejected promise only in this regression harness: a
  // second writeHead must be observable as a failed assertion, not kill Node.
  const server=http.createServer((request,response)=>{
    handler(request,response).catch(error=>{rejections.push({code:error.code,message:error.message});response.destroy();});
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  const request=pathname=>new Promise(resolve=>{
    const req=http.get({host:'127.0.0.1',port:server.address().port,path:pathname},response=>{
      const parts=[];response.on('data',part=>parts.push(part));
      response.once('end',()=>resolve({status:response.statusCode,body:Buffer.concat(parts).toString('utf8')}));
      response.once('error',error=>resolve({clientError:error.code}));
    });
    req.once('error',error=>resolve({clientError:error.code}));
    req.setTimeout(3000,()=>req.destroy(Error('local_fixture_request_timeout')));
  });
  return {active,rejections,request};
}

test('the shared handler serves initial SSR and every bounded helper API, including models and hidden budget continuation',async t=>{
  const f=await fixtureServer(t,{renderMarkup:({initial,result})=>{
    assert.deepEqual(initial,{city,market:'japan'});assert.equal(result.total,147);
    return '<main>verified SSR input</main>';
  }});
  const document=await f.request('/cars/japan?'+new URLSearchParams({city}));
  assert.equal(document.status,200);assert.match(document.body,/<main>verified SSR input<\/main>/);
  const scenarios=[...['','totalRubDesc','totalRub'].map(sort=>({url:japanPriceSortApi(sort),total:73})),
    ...[['plain',147],['make',147],['model',83],['combined',73]].map(([kind,total])=>({url:japanExactCountApi(kind),total})),
    {url:japanExactCountApi('budget',{budgetTo:'1303000'}),total:38}];
  let budget;
  for(const scenario of scenarios){
    const response=await f.request(scenario.url);
    assert.equal(response.status,200);
    const result=JSON.parse(response.body);
    assert.equal(result.total,scenario.total);assert.equal(result.items.length,24);assert.equal(result.hasMore,true);
    assert.equal(result.countSummary.countProof.predicateVersion,'japan-admitted-census-v1');
    if(scenario.total===38)budget=result;
  }
  const directory=await f.request(japanExactCountApi('models'));
  assert.equal(directory.status,200);assert.equal(JSON.parse(directory.body).models.length,94);
  const brands=await f.request('/api/catalog/brand-counts?market=japan');
  assert.equal(brands.status,200);assert.equal(JSON.parse(brands.body).counts.AUDI,147);
  const next=await f.request(api({make:'AUDI',model:'A4',powerTo:'160',budget:'1303000',page:'2',
    marketPage:'1',after:budget.nextCursor}));
  assert.equal(next.status,200);assert.equal(JSON.parse(next.body).total,38);assert.equal(JSON.parse(next.body).items.length,14);
  assert.equal(f.active.requests.length,9);assert.deepEqual(f.rejections,[]);assert.equal(f.active.serverError,undefined);
});

test('an invalid API query preserves its original assertion as HTTP400 without a headers-sent rejection',async t=>{
  const f=await fixtureServer(t);
  const response=await f.request(api({market:'china',powerTo:'160'}));
  assert.deepEqual(f.rejections,[],'the original query guard must not be replaced by ERR_HTTP_HEADERS_SENT');
  assert.equal(response.status,400);assert.equal(f.active.serverError,'japan_exact_count_fixture_data_query');
  assert.deepEqual(f.active.serverFailure,{stage:'search_payload',path:'/api/catalog/search',
    code:'japan_exact_count_fixture_data_query',query:{market:'china',city,page:'1',pageSize:'24',powerTo:'160'}});
  assert.equal(JSON.parse(response.body).error,'japan_exact_count_fixture_data_query');
  const later=await f.request(api({budget:'invalid'}));
  assert.equal(later.status,400);assert.equal(JSON.parse(later.body).error,'japan_exact_count_fixture_data_budget');
  assert.equal(f.active.serverError,'japan_exact_count_fixture_data_query','later errors cannot replace the first failure');
  assert.equal(f.active.serverFailure.query.market,'china');assert.deepEqual(f.rejections,[]);
});

test('an SSR throw happens before status200 and remains available for the persisted browser failure report',async t=>{
  const f=await fixtureServer(t,{renderMarkup:()=>{throw Error('controlled_renderer_failure');}});
  const response=await f.request('/cars/japan?'+new URLSearchParams({city}));
  assert.deepEqual(f.rejections,[],'render failure must not kill the fixture process');
  assert.equal(response.status,400);assert.equal(f.active.serverError,'controlled_renderer_failure');
  assert.equal(f.active.serverFailure.stage,'document_render');assert.equal(f.active.serverFailure.path,'/cars/japan');
  assert.equal(JSON.parse(response.body).error,'controlled_renderer_failure');
});

test('the error response never writes headers a second time and diagnostics exclude arbitrary URL values',async()=>{
  const active=state(),writes=[];
  const handler=createExactCountFixtureHandler({fixture:{},getActive:()=>active});
  const response={headersSent:true,writableEnded:false,destroyed:false,
    writeHead(){assert.fail('headers already sent');},end(body){writes.push(body);this.writableEnded=true;}};
  await handler({url:api({market:'foreign',private:'PRIVATE_VALUE',after:'private-cursor'})},response);
  assert.equal(writes.length,1);assert.equal(active.serverFailure.code,'japan_exact_count_fixture_data_query');
  assert(!JSON.stringify(active.serverFailure).includes('PRIVATE_VALUE'));
  assert(!JSON.stringify(active.serverFailure).includes('private-cursor'));
  assert.equal(active.serverFailure.afterSha256.length,64);
});
