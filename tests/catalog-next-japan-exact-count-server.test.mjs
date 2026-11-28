import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {inflateSync} from 'node:zlib';
import * as exactCountFixture from './browser/japan-exact-count.mjs';
import {japanExactCountApi} from '../scripts/catalog-next/japan-exact-count-browser.mjs';
import {japanPriceSortApi} from '../scripts/catalog-next/japan-price-sort-browser.mjs';

const city='Новокузнецк';
const {createExactCountFixtureHandler}=exactCountFixture;
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
      response.once('end',()=>{
        const bytes=Buffer.concat(parts);
        resolve({status:response.statusCode,headers:response.headers,bytes,body:bytes.toString('utf8')});
      });
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

test('allowed local brand-logo requests return a decodable PNG instead of an empty image error',async t=>{
  const f=await fixtureServer(t);
  for(const theme of ['light','dark']){
    const response=await f.request('/brand-logos/local/'+theme+'/audi.png');
    assert.equal(response.status,200,'an empty HTTP204 forces the actual BrandLogoVisual error fallback');
    assert.equal(response.headers['content-type'],'image/png');
    const bytes=response.bytes;
    assert.deepEqual(bytes.subarray(0,8),Buffer.from('89504e470d0a1a0a','hex'));
    const chunks=[];let offset=8;
    while(offset<bytes.length){
      const size=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);
      assert(offset+12+size<=bytes.length,'PNG chunk must be complete');
      let crc=0xffffffff;
      for(const byte of bytes.subarray(offset+4,offset+8+size)){
        crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
      }
      assert.equal((crc^0xffffffff)>>>0,bytes.readUInt32BE(offset+8+size),'PNG '+type+' CRC');
      chunks.push({type,data:bytes.subarray(offset+8,offset+8+size)});offset+=12+size;
    }
    assert.equal(offset,bytes.length);assert.deepEqual(chunks.map(chunk=>chunk.type),['IHDR','IDAT','IEND']);
    const header=chunks[0].data;
    assert.equal(header.length,13);assert.equal(header.readUInt32BE(0),1);assert.equal(header.readUInt32BE(4),1);
    assert.deepEqual([...header.subarray(8)],[8,6,0,0,0],'one 8-bit RGBA pixel without interlacing');
    const scanline=inflateSync(chunks[1].data);
    assert.equal(scanline.length,5);assert.equal(scanline[0],0,'unfiltered RGBA scanline');
  }
  assert.deepEqual(f.rejections,[]);assert.equal(f.active.serverError,undefined);
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

test('blocked transport diagnostics retain bounded public call sites without credentials, query or payload',()=>{
  assert.equal(typeof exactCountFixture.recordForbiddenFixtureRequest,'function');
  const report={passed:false,forbiddenTransportAttempts:0};
  const record=values=>exactCountFixture.recordForbiddenFixtureRequest(report,
    {caseName:'preserved_controls',stage:'fixture_count_expiry',method:'GET',resourceType:'image',...values});
  record({url:'https://URL_USER:URL_PASSWORD@cdn.example.test/fonts/public.woff2?token=QUERY_SECRET#FRAGMENT_SECRET',resourceType:'font'});
  record({url:'https://avtocena.com/api/catalog/brand-logo/audi?theme=light&token=QUERY_SECRET'});
  record({url:'data:image/svg+xml,PAYLOAD_SECRET'});
  record({url:'not a URL with INVALID_SECRET'});
  record({url:'https://cdn.example.test/'+ 'a'.repeat(2000)+'?token=QUERY_SECRET',stage:'x'.repeat(1000),
    method:'y'.repeat(1000),resourceType:'z'.repeat(1000)});
  for(let index=0;index<30;index++)record({url:'https://cdn.example.test/image-'+index+'.png?token=QUERY_SECRET'});
  assert.equal(report.forbiddenTransportAttempts,35,'diagnostic cap must not cap the denying counter');
  assert.equal(report.passed,false,'recording a blocked call cannot accept a browser fixture');
  assert.equal(report.forbiddenRequests.length,16);
  assert.equal(report.forbiddenRequestDiagnosticsOmitted,19);
  assert.deepEqual(report.forbiddenRequests[0],{case:'preserved_controls',stage:'fixture_count_expiry',method:'GET',
    originCategory:'external_http',hostname:'cdn.example.test',pathname:'/fonts/public.woff2',resourceType:'font'});
  assert.equal(report.forbiddenRequests[1].originCategory,'fixture_origin');
  assert.equal(report.forbiddenRequests[1].pathname,'/api/catalog/brand-logo/audi');
  assert.equal(report.forbiddenRequests[2].originCategory,'non_http');
  assert.equal(report.forbiddenRequests[2].pathname,'');
  assert.equal(report.forbiddenRequests[3].originCategory,'invalid');
  for(const entry of report.forbiddenRequests){
    assert(entry.case.length<=40&&entry.stage.length<=120&&entry.method.length<=16
      &&entry.hostname.length<=253&&entry.pathname.length<=320&&entry.resourceType.length<=32);
    assert.deepEqual(Object.keys(entry).sort(),['case','stage','method','originCategory','hostname','pathname','resourceType'].sort());
  }
  const persisted=JSON.stringify(report);
  for(const secret of ['URL_USER','URL_PASSWORD','QUERY_SECRET','FRAGMENT_SECRET','PAYLOAD_SECRET','INVALID_SECRET'])
    assert(!persisted.includes(secret),'diagnostic leaked '+secret);
  assert(persisted.length<10000,'diagnostic report must remain bounded');
});
