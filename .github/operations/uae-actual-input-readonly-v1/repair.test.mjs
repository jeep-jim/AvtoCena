import assert from 'node:assert/strict';
import test from 'node:test';
import {gzipSync} from 'node:zlib';
import {REAL,prefix,sha,inspectMissingSourceSeal,planReboundUaeReady,rebindWithPrivateCapability} from './repair.mjs';
import {inspectExactLegacyUaeFeed} from './static-gzip.mjs';
const blob=x=>Buffer.from(JSON.stringify(x));
function fixture(){
 const p={...REAL,admitted:{seller:1,onRequest:0,retainedDelivered:0},blocks:1,shards:1,retained:1};
 const source=blob({version:1,kind:'uae-source-prepared-v2',market:'uae',cursor:p.sourceCursor,inputOnly:true,
  servable:false,publicationAllowed:false,publicPointerWrites:0,supplierRequests:0});p.source=sha(source);
 const price=blob({version:1,kind:'uae-private-buyer-qualification-v1',market:'uae',cursor:p.sourceCursor,sourceReceiptSha256:p.source,
  editorialWireSha256:p.editorial,fxWireSha256:p.fx,heldCount:p.held,preparedPrivateOnly:true,publicationAllowed:false,
  servable:false,deliveredQuoteAuthority:false,publicPointerWrites:0,cursorWrites:0,supplierRequests:0});p.price=sha(price);
 const gen={version:1,market:'uae',generationId:p.generationId}, projection=blob({...gen,ordinal:0,items:[{id:'x'}]}),
  detail=blob({...gen,shard:'2d',items:[{id:'x'}]});
 const directory=blob({...gen,kind:'uae-public-directory-v1',priceReceiptSha256:p.price,admitted:p.admitted,
  blocks:[{rows:1,sha256:sha(projection)}],detailShards:{'2d':{rows:1,sha256:sha(detail)}}});
 const retained=blob({version:1,market:'uae',rows:p.retained,originalObservationDatesPreserved:true,byIdSha256:'9'.repeat(64),pricingQualificationSha256:p.price});
 const input=blob({version:1,market:'uae',priceReceiptSha256:p.price,priorEditorialWireSha256:p.editorial,
  priorOfficialCbrWireSha256:p.fx,qualifiedHeldRows:p.held,deliveredRubAdmitted:0,publicPointerWrites:0,supplierRequests:0});
 const r=blob({...gen,kind:'uae-private-runtime-ready-v1',runId:p.runId,priceReceiptSha256:p.price,
  retainedDetailReceiptSha256:sha(retained),publicDirectorySha256:sha(directory),editorialReceiptSha256:p.editorial,
  admitted:p.admitted,legalValidUntil:p.legalValidUntil});p.ready=sha(r);
 const r0=prefix(p.runId),store=new Map([[p.sourceKey,source],[p.priceKey,price],
  [r0+'READY.json',r],[r0+'public-directory.json',directory],[r0+'retained-evidence.json',retained],[r0+'input-evidence.json',input],
  [r0+'projection/0.json',projection],[r0+'details/2d.json',detail]]);
 const read=async key=>store.get(key);
 return {newRunId:'44879999123',read,pins:p,now:()=>p.legalValidUntil-3600000,store,projection,detail};
}
test('only sole original omission is recognized and source/pricing bytes are actually digest-bound',async()=>{
 const f=fixture(),view=await inspectMissingSourceSeal(f);
 assert.equal(view.oldReady.sourceReceiptSha256,undefined);
 f.store.set(f.pins.sourceKey,blob({}));
 await assert.rejects(inspectMissingSourceSeal(f),/wire_digest/);
});
test('new private prefix only; no recipe engine, byte identical immutable contents, no extension, READY last',async()=>{
 const f=fixture(),plan=await planReboundUaeReady(f),out=new Map(),seen=[];
 const cap={scope:'uae-createonly-rebind-private-v1',prefix:plan.destinationPrefix,
  assertAuthorization:async()=>{},createOnly:async (key,b,o)=>{assert.equal(o.ifNoneMatch,'*');assert.ok(key.startsWith(plan.destinationPrefix));seen.push(key);out.set(key,b);return 'created';},
  readPrivateSameOwner:async key=>out.get(key)};
 await assert.rejects(rebindWithPrivateCapability({plan,capability:{},assertMarketFence:async()=>{}}),/missing_private_authority/);
 await rebindWithPrivateCapability({plan,capability:cap,assertMarketFence:async()=>{}});
 assert.deepEqual(out.get(plan.destinationPrefix+'projection/0.json'),f.projection);
 assert.deepEqual(out.get(plan.destinationPrefix+'details/2d.json'),f.detail);
 const ready=JSON.parse(out.get(plan.destinationPrefix+'READY.json'));
 assert.equal(ready.sourceReceiptSha256,f.pins.source);
 assert.equal(ready.runId,f.newRunId);assert.equal(ready.generationId,f.pins.generationId);assert.equal(ready.legalValidUntil,f.pins.legalValidUntil);
 assert.equal(seen.at(-1),plan.destinationPrefix+'READY.json');
 assert.equal(sha(out.get(plan.destinationPrefix+'public-directory.json')),ready.publicDirectorySha256);
 assert.equal(sha(f.store.get(prefix(f.pins.runId)+'READY.json')),f.pins.ready);
});
test('expiry, corrupted old deposit and first destination readback error stop before READY',async()=>{
 const f=fixture();
 await assert.rejects(planReboundUaeReady({...f,now:()=>f.pins.legalValidUntil}),/new_run_or_time/);
 const plan=await planReboundUaeReady(f),created=[];
 const cap={scope:'uae-createonly-rebind-private-v1',prefix:plan.destinationPrefix,assertAuthorization:async()=>{},
  createOnly:async key=>{created.push(key);return 'created';},readPrivateSameOwner:async()=>Buffer.from('wrong')};
 await assert.rejects(rebindWithPrivateCapability({plan,capability:cap,assertMarketFence:async()=>{}}),/destination_readback/);
 assert.equal(created.length,1);assert.ok(!created[0].endsWith('READY.json'));
 f.store.set(prefix(f.pins.runId)+'projection/0.json',blob({}));
 await assert.rejects(plan.readObject(plan.descriptors[0]),/wire_digest/);
});
test('static legacy proof is exact ID membership, not description, returns no rewritten bytes',()=>{
 const h='\uFEFFid,title,description,link,image_link,availability,price,brand,identifier_exists,product_type\n';
 const row=(id,d)=>[id,'t',d,'https://example.test/c','https://example.test/a.jpg','in_stock','100 RUB','b','no','Vehicles > Cars']
  .map(x=>'"'+x.replaceAll('"','""')+'"').join(',')+'\n';
 const bytes=gzipSync(h+row('europe','contains "рынок: uae", and\na newline')+row('uae-exact','x'));
 const meta={version:1,publicationPolicy:'2026-10-13',generationId:'gen_1',objectPath:'catalog/public/feeds/openai-products.csv.gz',
  format:'google-compatible-csv-gzip',productCount:2,size:bytes.length,checksum:sha(bytes)};
 const run=set=>inspectExactLegacyUaeFeed({legacyMetadata:meta,gzipBytes:bytes,legacyUaeIds:set});
 assert.equal(run(new Set(['uae-exact'])).legacyUaeProductCount,1);
 assert.equal(run(new Set(['uae-exact'])).staticPublicRouteCanRetainExactAsset,false);
 assert.equal(run(new Set(['not-in-csv'])).staticPublicRouteCanRetainExactAsset,true);
});
