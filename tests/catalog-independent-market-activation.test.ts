import test from 'node:test';
import assert from 'node:assert/strict';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {ObjectJsonStorage,StorageConflictError} from '../apps/web/lib/data';
import {independentMarketDigest as digest,independentMarketFixtureSections,openIndependentMarketFixture,
 type IndependentCut,type IndependentMarket,type IndependentMarketPaper} from '../apps/web/lib/catalog/independent-market-activation-fixture';

const asOf=Date.parse('2026-11-20T09:00:00Z');
const gen=(market:IndependentMarket,n:number)=>`gen_${asOf+n}_${market}`;
const root='catalog/market-activation-fixture-v1/';
const roles=['inventory','prices','search'] as const;
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};};

test('Georgia can hold its market lease and fail its writer while China publishes and Korea reads unchanged',async t=>{
 t.mock.timers.enable({apis:['Date'],now:asOf});
 const endpoint='http://127.0.0.1:49140',bucket='fixture-market',prefix='fixture-local';
 const env={YC_OBJECT_STORAGE_ENDPOINT:endpoint,YC_OBJECT_STORAGE_BUCKET:bucket,YC_OBJECT_STORAGE_PREFIX:prefix,YC_OBJECT_STORAGE_REGION:'fixture',
  YC_OBJECT_STORAGE_ACCESS_KEY_ID:'fixture',YC_OBJECT_STORAGE_SECRET_ACCESS_KEY:'fixture'};
 const previousEnv=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
 const oldFetch=globalThis.fetch;
 const untouched=['catalog/manifest.json','catalog/previous-manifest.json','catalog/intake-cursors/v1/china.json','catalog/operations/publication-lock.json'];
 const s3=new Map<string,{body:Buffer;etag:string}>(untouched.map(key=>[key,{body:Buffer.from('legacy-untouched:'+key),etag:'"legacy"'}]));
 const initialLegacy=structuredClone(s3);
 const actor=new AsyncLocalStorage<IndependentMarket>();
 const operations:Array<{market:IndependentMarket;key:string;method:string;status:number}>=[],authorizations:string[]=[];
 let trap:((market:IndependentMarket,key:string,method:string,headers:Headers)=>Promise<number|void>)|undefined;
 const mock:typeof fetch=async(input,init)=>{
  const url=new URL(String(input)),activeActor=actor.getStore(),headers=new Headers(init?.headers);
  assert.equal(url.origin,endpoint);assert.ok(url.pathname.startsWith(`/${bucket}/${prefix}/`));
  assert.match(headers.get('authorization')||'',/^AWS4-HMAC-SHA256 Credential=fixture\//);
  assert.ok(activeActor);
  const key=decodeURIComponent(url.pathname.slice(`/${bucket}/${prefix}/`.length)),method=init?.method||'GET';
  assert.ok(key.startsWith(root+activeActor+'/'),`cross-market/global access: ${activeActor} ${key}`);
  const failure=await trap?.(activeActor,key,method,headers);
  if(failure){operations.push({market:activeActor,key,method,status:failure});return new Response(null,{status:failure});}
  const prior=s3.get(key);
  if(method==='GET'){
   operations.push({market:activeActor,key,method,status:prior?200:404});
   return prior?new Response(new Uint8Array(prior.body),{headers:{etag:prior.etag}}):new Response(null,{status:404});
  }
  assert.equal(method,'PUT');
  const match=headers.get('if-match'),none=headers.get('if-none-match');
  assert.ok((match&&key.endsWith('/control.json')&&!none)||(!match&&none==='*'));
  if((match!==null&&match!==prior?.etag)||(none==='*'&&prior)){
   operations.push({market:activeActor,key,method,status:412});return new Response(null,{status:412});
  }
  const body=Buffer.isBuffer(init?.body)?Buffer.from(init!.body):Buffer.from(String(init?.body));
  s3.set(key,{body,etag:'"'+createHash('sha256').update(body).digest('hex')+'"'});
  operations.push({market:activeActor,key,method,status:200});
  return new Response(null,{status:200});
 };
 Object.assign(process.env,env);globalThis.fetch=mock;
 try{
  const storage=new ObjectJsonStorage(),permit={origin:endpoint,bucket,prefix,fixtureFetch:mock,
   assertAuthorized:async(market:IndependentMarket,phase:string)=>{
    assert.equal(actor.getStore(),market);
    authorizations.push(market+':'+phase);
   }};
  assert.throws(()=>openIndependentMarketFixture(storage,'china',{...permit,origin:'https://not-a-fixture.invalid'}),/mock_only/);
  const china=openIndependentMarketFixture(storage,'china',permit),korea=openIndependentMarketFixture(storage,'korea',permit),georgia=openIndependentMarketFixture(storage,'georgia',permit);
  const own=<R>(market:IndependentMarket,fn:()=>R)=>actor.run(market,fn);
  type Market=typeof china;
  const candidate=async(m:Market,n:number,sequence=n,base?:Awaited<ReturnType<Market['observe']>>,validUntil=asOf+120_000)=>{
   const b=base??await m.observe(),generationId=gen(m.market,n),observedAt=Date.now(),sourceReceiptSha256=digest([m.market,'source',n]),
    pricingReceiptSha256=digest([m.market,'FX',n]),orderedIdsSha256=digest([m.market,'row',n]);
   const papers=Object.fromEntries(roles.map(role=>[role,{version:1,role,market:m.market,generationId,sourceReceiptSha256,pricingReceiptSha256,orderedIdsSha256,
    count:1,payload:{id:`${m.market}-${n}`,totalRub:1_500_000+n,role}} satisfies IndependentMarketPaper])) as Record<typeof roles[number],IndependentMarketPaper>;
   const cut:IndependentCut={version:1,market:m.market,generationId,expectedBaseSha256:b.baseSha256,previousCursorSha256:digest(b.cursor),
    source:{complete:true,receiptSha256:sourceReceiptSha256,observedAt,validUntil,cursor:{stream:m.market+'-local',sequence,anchorSha256:digest([m.market,'cursor',sequence])}},
    pricing:{receiptSha256:pricingReceiptSha256,inputFingerprint:digest([m.market,'input',n]),calculationVersion:digest('existing-unchanged'),
     pricedAt:observedAt,validUntil},admitted:{count:1,orderedIdsSha256},
    papers:{inventory:digest(papers.inventory),prices:digest(papers.prices),search:digest(papers.search)}};
   return {cut,papers,produce:async(role:typeof roles[number])=>papers[role],
    intent:{action:'publish' as const,generationId,expectedBaseSha256:b.baseSha256}};
  };
  const publish=async(m:Market,n:number,sequence=n,validUntil=asOf+120_000)=>{
   const c=await candidate(m,n,sequence,undefined,validUntil);
   const lease=await m.acquire(c.intent,4000),ready=await m.prepare(lease,c.cut,digest(c.cut),c.produce);
   assert.equal((await m.observe()).cursor?.sequence,n===1?undefined:sequence-1,'prepare cannot advance the cursor');
   return m.activate(lease,ready);
  };
  await Promise.all([own('korea',()=>publish(korea,1)),own('georgia',()=>publish(georgia,1)),own('china',()=>publish(china,1))]);
  const korean=await own('korea',()=>Promise.all(roles.map(role=>korea.read(role))));
  const oldGeorgia=await own('georgia',()=>georgia.read('prices'));
  const oldChina=await own('china',()=>china.read('prices'));
  const originalKorean=new Map(Array.from(s3.entries()).filter(([key])=>key.startsWith(root+'korea/')));
  const started=deferred(),finish=deferred();
  trap=async(market,key,method)=>{
   if(market==='georgia'&&key.includes(gen('georgia',2))&&key.includes('/prices-')&&method==='PUT'){
    started.resolve();await finish.promise;return 403;
   }
  };
  const stalled=own('georgia',async()=>{
   const c=await candidate(georgia,2),l=await georgia.acquire(c.intent,30_000);
   return georgia.prepare(l,c.cut,digest(c.cut),c.produce);
  });
  void stalled.catch(()=>{});await started.promise;
  const georgiaLock=s3.get(root+'georgia/control.json')!;
  assert.ok(JSON.parse(georgiaLock.body.toString()).lease);
  assert.equal(await own('china',async()=>(await publish(china,2)).generationId),gen('china',2));
  assert.deepEqual(await own('korea',()=>Promise.all(roles.map(role=>korea.read(role)))),korean);
  assert.deepEqual(await own('georgia',()=>georgia.read('prices')),oldGeorgia);
  assert.deepEqual(s3.get(root+'georgia/control.json'),georgiaLock);
  // An independent aggregate consumer can render China and Korea even if the
  // Georgia read is stalled, and does not read or mutate any global pointer.
  const geoRead=deferred(),geoReadStarted=deferred(),aggregateWriteStart=operations.filter(op=>op.method==='PUT').length;
  const olderTrap=trap;
  trap=async(market,key,method,headers)=>{
   if(market==='georgia'&&method==='GET'&&key.endsWith('/control.json')){
    geoReadStarted.resolve();await geoRead.promise;return 403;
   }
   return olderTrap?.(market,key,method,headers);
  };
  const sections=independentMarketFixtureSections([{
   market:'georgia',read:role=>own('georgia',()=>georgia.read(role)),
  },{market:'china',read:role=>own('china',()=>china.read(role))},{market:'korea',read:role=>own('korea',()=>korea.read(role))}],'prices');
  await geoReadStarted.promise;
  assert.equal((await sections.get('china'))?.status,'ready');
  assert.deepEqual(await sections.get('korea'),korean[1]);
  geoRead.resolve();
  assert.deepEqual(await sections.get('georgia'),{market:'georgia',status:'unavailable'});
  assert.equal(operations.filter(op=>op.method==='PUT').length,aggregateWriteStart);

  // Two China owners contend for the exact same CAS, not a global lock.
  const joined=deferred();let waiting=0;
  trap=async(market,key,method)=>{
   if(market==='china'&&key.endsWith('/control.json')&&method==='PUT'&&waiting<2){
    if(++waiting===2)joined.resolve();await joined.promise;
   }
  };
  const chinaBase=await own('china',()=>china.observe());
  const [a,b]=await own('china',()=>Promise.all([candidate(china,3,3,chinaBase),candidate(china,4,4,chinaBase)]));
  const racers=await own('china',()=>Promise.allSettled([china.acquire(a.intent,1000),china.acquire(b.intent,1000)]));
  const won=racers.find(result=>result.status==='fulfilled');
  const lost=racers.find(result=>result.status==='rejected');
  assert.ok(won?.status==='fulfilled'&&lost?.status==='rejected');
  assert.ok(lost.reason instanceof StorageConflictError);
  trap=undefined;
  const winner=won.value.generationId===a.intent.generationId?a:b;
  const sealed=await own('china',()=>china.prepare(won.value,winner.cut,digest(winner.cut),winner.produce));
  assert.equal((await own('china',()=>china.observe())).cursor?.sequence,2);
  // The expired owner has complete immutable bytes but no longer has authority.
  t.mock.timers.tick(1001);
  const takeover=await own('china',()=>candidate(china,5,5,chinaBase));
  const replacement=await own('china',()=>china.acquire(takeover.intent,3000));
  const newSeal=await own('china',()=>china.prepare(replacement,takeover.cut,digest(takeover.cut),takeover.produce));
  await assert.rejects(own('china',()=>china.activate(won.value,sealed)),/lease_lost/);
  await own('china',()=>china.activate(replacement,newSeal));
  assert.equal((await own('china',()=>china.observe())).cursor?.sequence,5);
  await assert.rejects(own('china',()=>china.acquire(a.intent,500)),/base_changed/);

  const rollbackBase=await own('china',()=>china.observe());
  const roll=await own('china',()=>china.acquire({action:'rollback',generationId:gen('china',2),expectedBaseSha256:rollbackBase.baseSha256},2500));
  await own('china',()=>china.rollback(roll));
  const rolled=await own('china',()=>china.observe());
  assert.equal(rolled.generationId,gen('china',2));
  assert.equal(rolled.cursor?.sequence,2,'cursor restored with the published generation; no feed gap on replay');
  assert.notEqual(rolled.baseSha256,chinaBase.baseSha256,'returning to same generation is not ABA');
  assert.notDeepEqual(await own('china',()=>china.read('prices')),oldChina);
  assert.deepEqual(await own('korea',()=>Promise.all(roles.map(role=>korea.read(role)))),korean);
  // Reject incomplete evidence and stale cursors before writing a new paper.
  const c6=await own('china',()=>candidate(china,6,3,rolled,asOf+1500));
  const l6=await own('china',()=>china.acquire(c6.intent,4500));
  const incomplete={...c6.cut,source:{...c6.cut.source,complete:false}} as unknown as IndependentCut;
  await assert.rejects(own('china',()=>china.prepare(l6,incomplete,digest(incomplete),c6.produce)),/cut_not_ready/);
  const wrongSameSequence={...c6.cut,source:{...c6.cut.source,cursor:{...c6.cut.source.cursor,sequence:2}}};
  await assert.rejects(own('china',()=>china.prepare(l6,wrongSameSequence,digest(wrongSameSequence),c6.produce)),/cursor_regression/);
  const r6=await own('china',()=>china.prepare(l6,c6.cut,digest(c6.cut),c6.produce));
  assert.deepEqual(await own('china',()=>china.observe()),rolled);
  // A conflicting final conditional PUT neither advances cursor nor flips this
  // market's pointer; no unconditional retry or shared rollback writes.
  trap=async(market,key,method)=>{if(market==='china'&&key.endsWith('/control.json')&&method==='PUT')return 412;};
  const putsBefore=operations.filter(op=>op.method==='PUT'&&op.key.endsWith('/control.json')).length;
  await assert.rejects(own('china',()=>china.activate(l6,r6)),StorageConflictError);
  assert.equal(operations.filter(op=>op.method==='PUT'&&op.key.endsWith('/control.json')).length,putsBefore+1);
  trap=undefined;
  assert.deepEqual(await own('china',()=>china.observe()),rolled);
  t.mock.timers.tick(500);
  await assert.rejects(own('china',()=>china.activate(l6,r6)),/cut_not_ready/);
  await own('china',()=>china.release(l6));
  const reused=await own('china',()=>candidate(china,1,3,rolled));
  const refused=await own('china',()=>china.acquire(reused.intent,2500));
  await assert.rejects(own('china',()=>china.prepare(refused,reused.cut,digest(reused.cut),reused.produce)),/immutable_readback/);
  await own('china',()=>china.release(refused));
  assert.deepEqual(await own('china',()=>china.observe()),rolled);
  for(const [key,value] of originalKorean)assert.deepEqual(s3.get(key),value);
  assert.deepEqual(s3.get(root+'georgia/control.json'),georgiaLock);
  finish.resolve();
  await assert.rejects(stalled,/object_storage_PUT_403/);
  assert.equal((await own('georgia',()=>georgia.observe())).cursor?.sequence,1);
  assert.deepEqual(await own('georgia',()=>georgia.read('prices')),oldGeorgia);
  for(const [key,value] of initialLegacy){
   assert.equal(s3.get(key)?.etag,value.etag);
   assert.deepEqual(s3.get(key)?.body,Buffer.from(value.body));
  }
  assert.ok(authorizations.includes('china:activate')&&authorizations.includes('china:rollback'));
 }finally{
  globalThis.fetch=oldFetch;
  for(const [key,value] of Object.entries(previousEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;
 }
});
