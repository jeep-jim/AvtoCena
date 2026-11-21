import {createHash} from 'node:crypto';
export const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=x=>Buffer.from(JSON.stringify(x));
const HASH=/^[0-9a-f]{64}$/;
const req=(x,c)=>{if(!x)throw Error('uae_ready_repair:'+c);};
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const parse=b=>{try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(b));}catch{throw Error('uae_ready_repair:json_schema');}};
const issued=new WeakSet();
export const REAL=Object.freeze({
 runId:'44870078327',generationId:'gen_1795238215995_uae44870078327',ready:'ceba3aab83516e1947562e8a3dbe7600fe0f7f13cacd5c19cc8d70b0dc717ee2',
 source:'e715e75702b515764cd39eb67fadfbeaf072eba2286b39e19ae3c179aaa0701c',
 price:'56eee42711b1ef2fd672668955bdc3492865918ba6de0dd456efda45ab4d1290',
 editorial:'a0b3f45e32d0a1be244f8a8d28946d15523d83aaa2792f1a8fbf9b59f8895275',
 fx:'185493007b2ec920778ccba9f8ed4bce41a3191761ae77cb3024ca7ed9e56063',
 sourceKey:'catalog/operations/uae-source-prepared/v1/44864273301/attempt-1/source-prepared.json',
 priceKey:'catalog/operations/uae-buyer-qualification/v1/44868777867/attempt-1/sealed-private-qualification.json',
 admitted:Object.freeze({seller:22050,onRequest:4474,retainedDelivered:0}),blocks:104,shards:256,retained:2150,held:238,
 legalValidUntil:Date.parse('2026-11-22T00:00:00.000Z'), sourceCursor:327359,
});
export const prefix=runId=>'catalog/private-market-stage-v1/uae/'+runId+'/';
async function checked(read,key,expected,maximum){
 let b;
 try{b=await read(key,maximum);}catch(e){
  const category=key.endsWith('/source-prepared.json')?'source_receipt':
   key.endsWith('/sealed-private-qualification.json')?'price_receipt':
   key.endsWith('/READY.json')?'old_ready':
   key.endsWith('/public-directory.json')?'old_directory':
   key.endsWith('/retained-evidence.json')?'old_retention':
   key.endsWith('/input-evidence.json')?'old_input':'old_data';
  const code=String(e?.message??'').match(/^(?:s3_read|object_storage_binary_read)_(403|404|409|412|429|5[0-9]{2})\b/)?.[1]??'unverified_io';
  throw Error('uae_ready_repair:'+category+'_'+code);
 }
 req(Buffer.isBuffer(b)&&b.length>0&&b.length<=maximum,'wire_bound');
 if(expected)req(sha(b)===expected,'wire_digest');
 return b;
}
function sameAdmitted(a,p){return exact(a,['seller','onRequest','retainedDelivered'])&&Object.keys(p.admitted).every(k=>a[k]===p.admitted[k]);}
// Inspection only; no application switch or S3 writes exist in this module.
export async function inspectMissingSourceSeal({read,pins=REAL,now=Date.now}){
 const p=pins,root=prefix(p.runId),get=(name,expected,maximum=4*1024*1024)=>checked(read,root+name,expected,maximum);
 const oldReady=parse(await get('READY.json',p.ready,32768));
 req(exact(oldReady,['version','kind','market','runId','generationId','priceReceiptSha256','retainedDetailReceiptSha256','publicDirectorySha256','editorialReceiptSha256','admitted','legalValidUntil'])&&
  oldReady.version===1&&oldReady.kind==='uae-private-runtime-ready-v1'&&oldReady.market==='uae'&&oldReady.runId===p.runId&&
  oldReady.generationId===p.generationId&&oldReady.priceReceiptSha256===p.price&&oldReady.editorialReceiptSha256===p.editorial&&
  oldReady.legalValidUntil===p.legalValidUntil&&sameAdmitted(oldReady.admitted,p)&&
  HASH.test(oldReady.publicDirectorySha256)&&HASH.test(oldReady.retainedDetailReceiptSha256),'old_ready_scope_not_sole_source_omission');
 const [directory,retained,input,source,price]=await Promise.all([
  get('public-directory.json',oldReady.publicDirectorySha256).then(parse),
  get('retained-evidence.json',oldReady.retainedDetailReceiptSha256).then(parse),
  get('input-evidence.json',null,32768).then(parse),
  checked(read,p.sourceKey,p.source,1024*1024).then(parse),
  checked(read,p.priceKey,p.price,1024*1024).then(parse)
 ]);
 // input-evidence wasn't reachable by hash in v1; treat only the exact field
 // equality as informative here, and reconstruct it from these verified pins.
 req(exact(input,['version','market','priceReceiptSha256','priorEditorialWireSha256','priorOfficialCbrWireSha256','qualifiedHeldRows','deliveredRubAdmitted','publicPointerWrites','supplierRequests'])&&
  input.version===1&&input.market==='uae'&&input.priceReceiptSha256===p.price&&input.priorEditorialWireSha256===p.editorial&&
  input.priorOfficialCbrWireSha256===p.fx&&input.qualifiedHeldRows===p.held&&input.deliveredRubAdmitted===0&&input.publicPointerWrites===0&&input.supplierRequests===0,'input_scope');
 req(source?.version===1&&source.kind==='uae-source-prepared-v2'&&source.market==='uae'&&source.cursor===p.sourceCursor&&
  source.inputOnly===true&&source.servable===false&&source.publicationAllowed===false&&source.publicPointerWrites===0&&source.supplierRequests===0,'source_scope');
 req(price?.version===1&&price.kind==='uae-private-buyer-qualification-v1'&&price.market==='uae'&&
  price.sourceReceiptSha256===p.source&&price.cursor===p.sourceCursor&&price.editorialWireSha256===p.editorial&&price.fxWireSha256===p.fx&&
  price.heldCount===p.held&&price.preparedPrivateOnly===true&&price.publicationAllowed===false&&price.servable===false&&price.deliveredQuoteAuthority===false&&
  price.publicPointerWrites===0&&price.cursorWrites===0&&price.supplierRequests===0,'price_scope');
 req(exact(directory,['version','kind','market','generationId','priceReceiptSha256','admitted','blocks','detailShards'])&&directory.version===1&&
  directory.kind==='uae-public-directory-v1'&&directory.market==='uae'&&directory.generationId===p.generationId&&
  directory.priceReceiptSha256===p.price&&sameAdmitted(directory.admitted,p)&&Array.isArray(directory.blocks)&&directory.blocks.length===p.blocks&&
  directory.detailShards&&typeof directory.detailShards==='object'&&!Array.isArray(directory.detailShards)&&
  Object.keys(directory.detailShards).length===p.shards,'directory_scope');
 req(exact(retained,['version','market','rows','originalObservationDatesPreserved','byIdSha256','pricingQualificationSha256'])&&
  retained.version===1&&retained.market==='uae'&&retained.rows===p.retained&&retained.originalObservationDatesPreserved===true&&
  HASH.test(retained.byIdSha256)&&retained.pricingQualificationSha256===p.price,'retention_scope');
 const total=Object.values(p.admitted).reduce((a,b)=>a+b,0),valid=x=>exact(x,['rows','sha256'])&&Number.isSafeInteger(x.rows)&&x.rows>0&&x.rows<=512&&HASH.test(x.sha256);
 req(directory.blocks.every(valid)&&directory.blocks.reduce((a,d)=>a+d.rows,0)===total,'projection_directory_bounds');
 req(Object.entries(directory.detailShards).every(([s,d])=>/^[a-f0-9]{2}$/.test(s)&&valid(d))&&
  Object.values(directory.detailShards).reduce((a,d)=>a+d.rows,0)===total,'detail_directory_bounds');
 return {oldReady,directory,retained,unexpired:now()<p.legalValidUntil,get};
}
// Plan only: caller must independently authenticate NEW private writer, and
// perform the copy with fail-closed conditional creation and final verification.
export async function planReboundUaeReady({read,newRunId,pins=REAL,now=Date.now}){
 const p=pins;
 req(/^[1-9]\d{8,14}$/.test(newRunId)&&newRunId!==p.runId&&now()+300000<p.legalValidUntil,'new_run_or_time');
 const {oldReady,directory,retained,get}=await inspectMissingSourceSeal({read,pins,now});
 const retainedBytes=bytes({...retained,sourceReceiptSha256:p.source});
 const directoryBytes=bytes({...directory,sourceReceiptSha256:p.source});
 const inputBytes=bytes({version:1,market:'uae',sourceReceiptSha256:p.source,priceReceiptSha256:p.price,
  priorEditorialWireSha256:p.editorial,priorOfficialCbrWireSha256:p.fx,qualifiedHeldRows:p.held,deliveredRubAdmitted:0,publicPointerWrites:0,supplierRequests:0});
 const readyBytes=bytes({...oldReady,runId:newRunId,sourceReceiptSha256:p.source,retainedDetailReceiptSha256:sha(retainedBytes),publicDirectorySha256:sha(directoryBytes)});
 const descriptors=[...directory.blocks.map((d,i)=>['projection/'+i+'.json',d]),...
  Object.entries(directory.detailShards).map(([s,d])=>['details/'+s+'.json',d])];
 const tails=[['retained-evidence.json',retainedBytes],['input-evidence.json',inputBytes],['public-directory.json',directoryBytes]];
 const mustCurrent=()=>req(now()+30000<p.legalValidUntil,'legal_expired');
 const readObject=async ([key,descriptor])=>{
  mustCurrent();
  const b=await get(key,descriptor.sha256);
  const [type,label]=key.split('/'),name=label.slice(0,-5),v=parse(b);
  req(v?.version===1&&v.market==='uae'&&v.generationId===p.generationId&&
   (type==='projection'?v.ordinal===Number(name):v.shard===name)&&Array.isArray(v.items)&&v.items.length===descriptor.rows,'immutable_scope');
  return b;
 };
 const plan=Object.freeze({generationId:p.generationId,sourcePrefix:prefix(p.runId),destinationPrefix:prefix(newRunId),descriptors,tails,readyBytes,
  readySha256:sha(readyBytes),mustCurrent,readObject});
 issued.add(plan);return plan;
}

// There is no S3, runtime-config or public actor dependency here. The caller
// must supply a protected, already authorized private-only capability, and
// reverify its market cursor/editorial/local owner/permissions before writes.
export async function rebindWithPrivateCapability({plan,capability,assertMarketFence,beforeReady}){
 req(issued.has(plan)&&capability?.scope==='uae-createonly-rebind-private-v1'&&capability.prefix===plan.destinationPrefix&&
  typeof capability.assertAuthorization==='function'&&typeof capability.createOnly==='function'&&
  typeof capability.readPrivateSameOwner==='function'&&typeof assertMarketFence==='function','missing_private_authority');
 async function fence(){
  plan.mustCurrent();await capability.assertAuthorization();await assertMarketFence();plan.mustCurrent();
 }
 const validate=async (key,b)=>{
  const actual=await capability.readPrivateSameOwner(key,b.length);
  req(Buffer.isBuffer(actual)&&actual.equals(b),'destination_readback');
 };
 const create=async(name,b)=>{
  plan.mustCurrent();const key=plan.destinationPrefix+name;
  req(/^(?:projection\/\d{1,3}\.json|details\/[a-f0-9]{2}\.json|(?:retained-evidence|input-evidence|public-directory|READY)\.json)$/.test(name),'destination_key');
  // Conflict is not a retry-to-overwrite. The operator capability can report
  // "already-exact-check-required", then the independently validated bytes and
  // same-owner private ACL must still match; all other failures stop.
  const status=await capability.createOnly(key,b,{ifNoneMatch:'*'});
  req(status==='created'||status==='already-exact-check-required','destination_create_denied');
  await validate(key,b);
 };
 await fence();
 for(const desc of plan.descriptors)await create(desc[0],await plan.readObject(desc));
 for(const [name,b] of plan.tails)await create(name,b);
 if(beforeReady){req(typeof beforeReady==='function','native_gate_scope');await beforeReady();}
 await fence();
 await create('READY.json',plan.readyBytes);
 return {state:'private_rebound_ready',readySha256:plan.readySha256,publicWrites:0,supplierRequests:0,calculationRuns:0};
}
