import assert from 'node:assert/strict';
import test from 'node:test';
import {KOREA_PUBLIC_ACCEPTANCE as PIN, inspectKoreaPublicDetail, publicFlightObjects,
  verifyKoreaPublicCharacteristics} from '../scripts/verify-korea-public-characteristics.mjs';

const nextGeneration='gen_1795350000000_test';
const encode=value=>String(value).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
function detail(sample,{missing=false,sourceOfferId=sample.sourceOfferId,mainId=sample.id,htmlPower=sample.powerHp,
  offerSourceId=undefined,editorSourceId='encar_direct'}:{missing?:boolean;sourceOfferId?:string;mainId?:string;htmlPower?:number;
    offerSourceId?:string;editorSourceId?:string}={}) {
  const values=missing?{}:{powerHp:sample.powerHp,engineCc:sample.engineCc,fuel:'petrol'};
  const offer={id:sample.id,sourceOfferId,sourceId:offerSourceId,market:'korea',...values};
  const initial={powerHp:missing?'':String(sample.powerHp),engineCc:missing?'':String(sample.engineCc),fuel:missing?'':'petrol'};
  const component=['$','$L1',null,{offerId:sample.id,priceIdentity:{id:sample.id,sourceId:editorSourceId,market:'korea'},
    initial,price:['$','$L2',null,{offer}]}];
  // Text can contain a complete counterfeit JSON record; it is never evidence.
  const text='Русский текст\nff:{"id":"noise","sourceOfferId":"unrelated"}\n';
  const wire='1:I["component"]\n:HL["/_next/static/style.css","style"]\n2:T'+Buffer.byteLength(text).toString(16)+','+text+'3:'+JSON.stringify(component)+'\n';
  const chunks=[wire.slice(0,17),wire.slice(17,Math.floor(wire.length/2)),wire.slice(Math.floor(wire.length/2))];
  return '<main aria-busy="true">Loading</main><main data-offer-id="'+mainId+'" data-offer-share-engine-cc="'+encode(initial.engineCc)
    +'" data-offer-share-fuel="'+initial.fuel+'"><h1>Fixture</h1>'
    +'<input aria-label="Мощность, л.с." value="'+(missing?'':htmlPower)+'">'
    +'<input aria-label="Объём, см³" value="'+encode(initial.engineCc)+'">'
    +'<button aria-pressed="'+!missing+'">Бензин</button></main>'
    +chunks.map(chunk=>'<script>self.__next_f.push([1,'+JSON.stringify(chunk).replace(/</g,'\\u003c')+'])</script>').join('');
}

function network({generation=()=>nextGeneration,missing=()=>false,redirect=false,wrongHealth=false}={}) {
  const calls=[];
  let reads=0;
  const fetchImpl=async (input,options)=>{
    const url=new URL(input);calls.push(url.href);
    assert.equal(url.origin,PIN.origin);assert.equal(options.method,'GET');
    assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');
    assert.equal(options.headers.authorization,undefined);assert.equal(options.headers.cookie,undefined);
    if(url.pathname==='/api/health')return Response.json({ok:true,releaseSha:wrongHealth?'wrong':PIN.release,calculationVersion:PIN.calculationVersion});
    if(url.pathname==='/api/catalog/search') {
      assert.equal(url.search,'?market=korea&source=existing&page=1&pageSize=1');
      return Response.json({ok:true,generationId:generation(reads++),total:1,items:[{id:PIN.samples[0].id,market:'korea'}]});
    }
    const sample=PIN.samples.find(row=>url.pathname===`/cars/offer/${row.id}`||url.pathname===`/cars/offer/${row.id}/new-import-slug`);
    assert.ok(sample,'no other page or supplier request');
    if(redirect&&!url.pathname.endsWith('/new-import-slug'))return new Response(null,{status:308,
      headers:{location:`/cars/offer/${sample.id}/new-import-slug?market=korea`}});
    return new Response(detail(sample,{missing:missing()}),{headers:{'content-type':'text/html; charset=utf-8'}});
  };
  return {fetchImpl,calls};
}

test('split Flight chunks and byte-counted text retain only listing-bound JSON; both HTML fields agree',()=>{
  for(const sample of PIN.samples) {
    const html=detail(sample);
    assert.ok(!publicFlightObjects(html).some(row=>row.id==='noise'));
    assert.deepEqual(inspectKoreaPublicDetail(html,sample),{...sample,fuel:'petrol',missing:[]});
  }
});

test('missing live fields are explicit, independently of the generation gate',()=>{
  const result=inspectKoreaPublicDetail(detail(PIN.samples[0],{missing:true}),PIN.samples[0]);
  assert.deepEqual(result.missing,['powerHp','engineCc','fuel']);
  assert.equal(result.powerHp,null);assert.equal(result.engineCc,null);assert.equal(result.fuel,null);
});

test('wrong source, main identity, visible value and truncated Flight cannot pass',()=>{
  const sample=PIN.samples[0];
  assert.throws(()=>inspectKoreaPublicDetail(detail(sample,{sourceOfferId:'42760061'}),sample),/public_detail_source_identity/);
  assert.throws(()=>inspectKoreaPublicDetail(detail(sample,{offerSourceId:'other'}),sample),/public_detail_source_identity/);
  assert.throws(()=>inspectKoreaPublicDetail(detail(sample,{editorSourceId:'other'}),sample),/public_detail_source_identity/);
  assert.throws(()=>inspectKoreaPublicDetail(detail(sample,{mainId:PIN.samples[1].id}),sample),/public_detail_identity/);
  assert.throws(()=>inspectKoreaPublicDetail(detail(sample,{htmlPower:77}),sample),/public_detail_powerHp_mismatch/);
  assert.throws(()=>publicFlightObjects('<script>self.__next_f.push([1,"2:Tff,short"])</script>'),/public_flight_invalid/);
});

test('the full public probe accepts a stable new generation, exact health and canonical redirects',async()=>{
  const mock=network({redirect:true});
  const result=await verifyKoreaPublicCharacteristics({...mock,once:true});
  assert.equal(result.verified,true,JSON.stringify(result));assert.equal(result.generationId,nextGeneration);
  assert.equal(result.samples.length,2);assert.equal(result.supplierRequests,0);assert.equal(mock.calls.length,8);
  assert.ok(result.samples.every(sample=>sample.url.endsWith('/new-import-slug?market=korea')));
});

test('one current snapshot reports old generation and both missing samples, never green HTTP 200',async()=>{
  const mock=network({generation:()=>PIN.previousGeneration,missing:()=>true});
  const result=await verifyKoreaPublicCharacteristics({...mock,once:true});
  assert.equal(result.verified,false);assert.deepEqual(result.reasons,['previous_generation','characteristics_missing']);
  assert.ok(result.samples.every(sample=>sample.missing.length===3));assert.equal(mock.calls.length,6);
});

test('only a cache transition retries, with a strict five-minute budget and finite attempts',async()=>{
  let clock=0;
  const mock=network({generation:()=>clock?nextGeneration:PIN.previousGeneration,missing:()=>!clock});
  const result=await verifyKoreaPublicCharacteristics({...mock,now:()=>clock,sleep:async ms=>{clock+=ms;}});
  assert.equal(result.verified,true);assert.equal(result.attempts,2);assert.equal(clock,30_000);
  clock=0;
  const stale=network({missing:()=>true});
  const failed=await verifyKoreaPublicCharacteristics({...stale,now:()=>clock,sleep:async ms=>{clock+=ms;}});
  assert.equal(failed.verified,false);assert.equal(failed.attempts,10);assert.ok(clock<300_000);
  assert.equal(stale.calls.length,60);
  await assert.rejects(verifyKoreaPublicCharacteristics({budgetMs:300_001}),/public_probe_budget_invalid/);
});

test('generation changes during detail reads cannot count as one accepted snapshot',async()=>{
  const mock=network({generation:n=>n===0?nextGeneration:'gen_1795350000001_changed'});
  const result=await verifyKoreaPublicCharacteristics({...mock,once:true});
  assert.equal(result.verified,false);assert.deepEqual(result.reasons,['generation_transition']);
});

test('changed health and cross-origin or wrong-listing redirects fail without retry or outside requests',async()=>{
  const wrong=network({wrongHealth:true});
  const health=await verifyKoreaPublicCharacteristics({...wrong,sleep:async()=>assert.fail('must not retry')});
  assert.equal(health.errorCode,'public_live_identity_changed');assert.equal(wrong.calls.length,2);
  for(const location of ['https://supplier.invalid/private','https://avtocena.com/cars/offer/wrong-id?market=korea']) {
    const mock=network(),calls=[];
    const result=await verifyKoreaPublicCharacteristics({fetchImpl:async(input,options)=>{
      calls.push(input);
      if(input.includes('/cars/offer/'))return new Response(null,{status:308,headers:{location}});
      return mock.fetchImpl(input,options);
    },sleep:async()=>assert.fail('must not retry')});
    assert.equal(result.errorCode,'public_request_destination');
    assert.ok(!calls.includes(location));
  }
});

test('oversized public responses fail before reading their body',async()=>{
  const mock=network();
  const result=await verifyKoreaPublicCharacteristics({fetchImpl:async(input,options)=>{
    if(input.includes('/cars/offer/'))return new Response('x',{headers:{'content-type':'text/html','content-length':String(4*1024*1024+1)}});
    return mock.fetchImpl(input,options);
  },once:true});
  assert.equal(result.verified,false);assert.equal(result.errorCode,'public_response_limit');
});
