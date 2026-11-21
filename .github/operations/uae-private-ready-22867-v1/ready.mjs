import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EXPECTED,exactPriorRow} from './qualify.mjs';
export const Q=Object.freeze({root:'catalog/operations/uae-buyer-qualification/v1/44868777867/attempt-1/',
 sha:'56eee42711b1ef2fd672668955bdc3492865918ba6de0dd456efda45ab4d1290',editorial:'a0b3f45e32d0a1be244f8a8d28946d15523d83aaa2792f1a8fbf9b59f8895275',
 fx:'185493007b2ec920778ccba9f8ed4bce41a3191761ae77cb3024ca7ed9e56063', rows:31553,
 seller:22050,onRequest:4474,currentSeller:20097,currentRequest:4277,retainedSeller:1953,retainedRequest:197,held:238});
export const sha=b=>createHash('sha256').update(b).digest('hex'), wire=x=>Buffer.from(JSON.stringify(x)), hash=x=>sha(wire(x));
const req=(f,e)=>assert.ok(f,e), nativeId=/^[a-f0-9]{24}$/, hex=/^[a-f0-9]{64}$/;
const pKinds=['seller','onRequest'];
export function galleryEvidence(row){
 const imgs=row?.images??[],admitted=[];let editorial=0,held=0;
 for(const img of imgs){
  const url=typeof img?.url==='string'?img.url:'';
  if(/^\/api\/site-media\/[a-f0-9]{64}$/.test(url)){admitted.push(url);editorial++;continue;}
  try{
   const parsed=new URL(url);
   if(parsed.origin==='https://www.dubicars.com'&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash
    &&parsed.pathname.startsWith('/images/')&&/\.(?:jpe?g|png|webp|avif)$/i.test(parsed.pathname)
    &&row.operational?.photoIdentityVerified===true){admitted.push(url);continue;}
  }catch{}
  held++;
 }
 return {links:admitted,digest:hash(admitted),paidSourceLinks:admitted.length-editorial,editorialRefs:editorial,held};
}
export async function readQualification(read){
 const w=await read(Q.root+'sealed-private-qualification.json',1024*1024);
 req(Buffer.isBuffer(w)&&sha(w)===Q.sha,'uae_ready_exact_qualification_sha');
 const q=JSON.parse(w.toString());
 req(q.kind==='uae-private-buyer-qualification-v1'&&q.market==='uae'&&q.version===1&&q.sourceReceiptSha256===EXPECTED.sha256
  &&q.fxWireSha256===Q.fx&&q.editorialWireSha256===Q.editorial&&q.nativeRelease===EXPECTED.release&&q.calculator===EXPECTED.calc
  &&q.sourceRows===EXPECTED.sourceCount&&q.predecessorRows===EXPECTED.oldCount&&q.cursor===EXPECTED.cursor&&q.heldCount===Q.held
  &&q.deliveredQuoteAuthority===false&&q.publicPointerWrites===0&&q.cursorWrites===0&&q.supplierRequests===0&&q.servable===false&&q.publicationAllowed===false
  &&Array.isArray(q.fields)&&q.fields.length===124,'uae_ready_exact_qualification_receipt');
 const all=new Map(), chosen=new Map(), counts={seller:0,onRequest:0,prior_seller:0,prior_onRequest:0};
 for(const [i,part] of q.fields.entries()){
  const key='decisions/part-'+String(i).padStart(4,'0')+'.ndjson';
  req(part.name===key&&hex.test(part.sha256)&&part.bytes>0&&part.bytes<=1024*1024&&part.rows>0&&part.rows<=256,'uae_ready_decision_descriptor');
  const b=await read(Q.root+key,part.bytes);
  req(b.length===part.bytes&&sha(b)===part.sha256&&b.at(-1)===10,'uae_ready_decision_wire');
  const a=b.toString().slice(0,-1).split('\n').map(JSON.parse);req(a.length===part.rows,'uae_ready_decision_rows');
  for(const d of a){
   req(nativeId.test(d.id)&&!all.has(d.id),'uae_ready_decision_identity');all.set(d.id,d);
   if(d.priceKind===undefined)continue;
   req(pKinds.includes(d.priceKind)&&d.outcome===d.priceKind&&['verified_source_state','legacy_retention_not_fresh'].includes(d.state)
    &&d.photoURLsExported===false&&hex.test(d.galleryEvidence?.digest)&&Number.isFinite(Date.parse(d.observedAt)),'uae_ready_decision_class');
   req(d.priceKind==='seller'?Number.isSafeInteger(d.privateSellerRub)&&d.privateSellerRub>0&&typeof d.sourcePrice==='number'&&d.sourcePrice>0:
    d.privateSellerRub===null&&d.sourcePrice===null,'uae_ready_decision_price');
   counts[(d.state==='legacy_retention_not_fresh'?'prior_':'')+d.priceKind]++;
   chosen.set(d.id,d);
  }
 }
 req(all.size===Q.rows&&chosen.size===Q.seller+Q.onRequest&&counts.seller===Q.currentSeller&&counts.onRequest===Q.currentRequest
  &&counts.prior_seller===Q.retainedSeller&&counts.prior_onRequest===Q.retainedRequest,'uae_ready_qualification_exact_membership');
 return {all,chosen,counts};
}
const publicFields=['id','sourceId','sourceOfferId','market','offerType','status','catalogKind','make','model','generation','trim','year',
 'productionDate','inventorySourceDate','mileageKm','engineCc','engineType','fuel','powertrainKind','transmission','drive','bodyType','vehicleCategory','grossVehicleWeightKg',
 'powerHp','powerKw','icePowerKw','power30MinKw','power30MinKwByMotor','utilizationPowerKw','powerDataConfidence','powerDataSource','color','motorPeakKw','batteryKwh',
 'sourcePrice','sourceCurrency','priceMode','catalogPricingMode','sellerPriceRub','calculationStatus','firstSeenAt','updatedAt','editorialTitle','editorialSpecifications','editorialPriceKey'];
export function safeTypedOffer(row,d,ports){
 req(row?.id===d.id&&row.market==='uae'&&row.sourceId==='dubicars_uae_exact'&&row.status==='active'&&ports.deliveredRub(row)===0,'uae_ready_native_card_scope');
 const {links,...gallery}=galleryEvidence(row);
 req(hash(gallery)===hash(d.galleryEvidence),'uae_ready_ordered_gallery_changed');
 req((row.operational?.lastSeenAt??row.updatedAt)===d.observedAt&&(row.sourcePrice??null)===d.sourcePrice,'uae_ready_native_observation_changed');
 const src=new URL(row.operational?.sourceUrl);
 req(src.origin==='https://www.dubicars.com'&&!src.username&&!src.password&&!src.query&&!src.search&&!src.hash
  &&src.pathname.endsWith('-'+String(row.sourceOfferId)+'.html'),'uae_ready_original_listing_identity');
 const ret=Object.fromEntries(publicFields.filter(k=>Object.hasOwn(row,k)).map(k=>[k,row[k]]));ret.sourcePrice=row.sourcePrice??null;ret.totalRub=null;
 ret.images=[...new Set(links)].map(url=>({url,id:'',objectKey:'',checksum:'',size:0,mimeType:'image/jpeg'}));
 if(ret.images.length)ret.cardImageUrl=ret.images[0].url;
 ret.operational={sourceUrl:src.toString(),provider:'auto-api.com',sourceVenueName:'DubiCars',lastSeenAt:d.observedAt};
 if(d.priceKind==='seller'){
  req(ports.isSeller(row)&&row.sellerPriceRub===d.privateSellerRub&&row.sourceCurrency==='AED','uae_ready_exact_native_seller_changed');
  const rate=row.calculationSnapshot?.currencyRate;
  req(['cbr','cbr_live'].includes(rate?.rateSource)&&typeof rate.rateDate==='string'&&Number.isFinite(rate.effectiveRate)&&Number.isFinite(rate.sourcePriceRub)
     &&rate.sourcePriceRub===d.privateSellerRub,'uae_ready_seller_native_rate_changed');
  const rateKeys=['currency','cbrRate','nominal','effectiveRate','rateDate','fetchedAt','rateSource','sourcePrice','sourcePriceRub'];
  const compact=Object.fromEntries(rateKeys.filter(k=>Object.hasOwn(rate,k)).map(k=>[k,rate[k]]));
  ret.calculationSnapshot={currencyRate:compact,sourcePriceRub:rate.sourcePriceRub,pricingConfidence:'unavailable'};
 }else req(ports.isRequest(row)&&d.privateSellerRub===null,'uae_ready_native_request_changed');
 req(ports.siteEligible(ret)&&ports.deliveredRub(ret)===0&&ports[d.priceKind==='seller'?'isSeller':'isRequest'](ret),'uae_ready_sanitized_native_card_scope');
 return ret;
}
export async function materializeRows({read,source,qualification,ports,editorial,fx}){
 const staged=new Map(),older=new Map(); let count=0;
 for await(const x of source.group('source-input')){
  const row=x.row, d=qualification.chosen.get(row?.id);count++;
  if(!d||d.state!=='verified_source_state')continue;
  req(!x.hold&&!staged.has(row.id)&&!ports.editorialHidden(row,editorial.index)&&ports.inScope(row),'uae_ready_current_native_scope');
  const native=await ports.prepareSeller(ports.applyEditorial(row,editorial.index),fx);
  staged.set(row.id,safeTypedOffer(native,d,ports));
 }
 req(count===EXPECTED.sourceCount&&staged.size===Q.currentSeller+Q.currentRequest,'uae_ready_current_materialized_membership');
 for await(const e of source.group('predecessor-evidence')){
  const d=qualification.chosen.get(e.id);
  if(d?.state==='legacy_retention_not_fresh'){
   req(!older.has(e.id)&&!staged.has(e.id),'uae_ready_retained_identity');older.set(e.id,e);
  }
 }
 req(older.size===Q.retainedSeller+Q.retainedRequest,'uae_ready_retained_membership');
 const refs=new Map(source.sealed.protectedPredecessorRefs.map(x=>[x.key,x]));
 let last=null;
 for(const e of [...older.values()].sort((a,b)=>a.immutableKey.localeCompare(b.immutableKey)||a.ordinal-b.ordinal)){
  const ref=refs.get(e.immutableKey);req(ref,'uae_ready_retained_ref_missing');
  if(last?.key!==ref.key){
   const b=await read(ref.key,ref.bytes);req(b.length===ref.bytes&&sha(b)===ref.sha256,'uae_ready_retained_wire_changed');
   last={key:ref.key,rows:JSON.parse(b.toString())};req(last.rows.length===ref.rows,'uae_ready_retained_wire_count');
  }
  const raw=last.rows[e.ordinal],d=qualification.chosen.get(e.id);
  req(raw?.id===e.id&&hash(raw)===e.rowSha256&&!ports.editorialHidden(raw,editorial.index)
   &&ports.withinRetention(raw),'uae_ready_retained_exact_document');
  staged.set(e.id,safeTypedOffer(ports.applyEditorial(raw,editorial.index),d,ports));
 }
 req(staged.size===qualification.chosen.size&&[...qualification.chosen.keys()].every(id=>staged.has(id)),'uae_ready_no_silent_drop');
 return staged;
}
export async function makeReadyFiles({rows,qualification,ports,runId,generationId,legalValidUntil,now=Date.now,maxTotal=192*1024*1024}){
 req(/^[1-9]\d{8,14}$/.test(runId)&&/^gen_\d{13}_[a-z0-9]{1,64}$/.test(generationId)&&typeof legalValidUntil==='number'&&legalValidUntil>now(),
  'uae_ready_generation_or_time');
 req(rows.size===Q.seller+Q.onRequest&&rows.size===qualification.chosen.size,'uae_ready_output_count');
 const admitted={seller:0,onRequest:0,retainedDelivered:0}, paths=new Map(), shards=new Map(), blocks=[], dirMap={},projection=[],retained=[],samples={};
 let bytes=0;
 function planned(k,v,cap=4*1024*1024){
  req(!paths.has(k),'uae_ready_object_collision');
  const b=wire(v);req(b.length>0&&b.length<=cap&&(bytes+=b.length)<=maxTotal,'uae_ready_staged_object_size');
  const record={name:k,body:b,sha256:sha(b)};paths.set(k,record);return record.sha256;
 }
 for(const id of [...rows.keys()].sort()){
  const d=qualification.chosen.get(id), offer=rows.get(id), p=ports.nativeProjection(offer), kind=d.priceKind, kept=d.state==='legacy_retention_not_fresh';
  req(p?.id===id&&p.market==='uae'&&p.sourceGroup==='dubicars_uae_exact'&&p.totalRub==null
     &&(kind==='seller'?p.sellerPriceRub===d.privateSellerRub:p.sellerPriceRub==null)
     &&(!p.cardImageUrl||offer.images.some(x=>x.url===p.cardImageUrl)),'uae_ready_projection_detail_not_equal');
  if(p.cardImageUrl)offer.cardImageUrl=p.cardImageUrl;else delete offer.cardImageUrl;
  const shard=sha(id).slice(0,2);
  if(!shards.has(shard))shards.set(shard,[]);
  shards.get(shard).push(offer);
  if(kept)retained.push([id,d.observedAt,d.priceKind,d.privateSellerRub,d.galleryEvidence.digest]);
  if(!samples[kind])samples[kind]={id,kind,sellerPriceRub:d.privateSellerRub,shard,nativePhotoLinks:offer.images.length};
  if(kept&&!samples.retained)samples.retained={id,kind,sellerPriceRub:d.privateSellerRub,shard,nativePhotoLinks:offer.images.length};
  projection.push(p);admitted[kind]++;
 }
 req(admitted.seller===Q.seller&&admitted.onRequest===Q.onRequest&&admitted.retainedDelivered===0&&retained.length===Q.retainedSeller+Q.retainedRequest,
  'uae_ready_admitted_category_count');
 for(let i=0;i<projection.length;i+=256){
  const items=projection.slice(i,i+256),ordinal=blocks.length;
  blocks.push({rows:items.length,sha256:planned('projection/'+ordinal+'.json',{version:1,market:'uae',generationId,ordinal,items})});
 }
 for(const [shard,items] of shards){
  req(items.length<=512,'uae_ready_bounded_detail_shard');
  dirMap[shard]={rows:items.length,sha256:planned('details/'+shard+'.json',{version:1,market:'uae',generationId,shard,items})};
 }
 const retainedDetailReceiptSha256=planned('retained-evidence.json',{version:1,market:'uae',rows:retained.length,
  originalObservationDatesPreserved:true,byIdSha256:hash(retained),sourceReceiptSha256:EXPECTED.sha,pricingQualificationSha256:Q.sha});
 planned('input-evidence.json',{version:1,market:'uae',sourceReceiptSha256:EXPECTED.sha,priceReceiptSha256:Q.sha,
  priorEditorialWireSha256:Q.editorial,priorOfficialCbrWireSha256:Q.fx,qualifiedHeldRows:Q.held,deliveredRubAdmitted:0,publicPointerWrites:0,supplierRequests:0});
 const directory={version:1,kind:'uae-public-directory-v1',market:'uae',generationId,sourceReceiptSha256:EXPECTED.sha,
  priceReceiptSha256:Q.sha,admitted,blocks,detailShards:dirMap};
 const publicDirectorySha256=planned('public-directory.json',directory);
 req(blocks.length<=512&&shards.size<=256&&paths.size<500,'uae_ready_total_object_bound');
 const ready={version:1,kind:'uae-private-runtime-ready-v1',market:'uae',runId,generationId,sourceReceiptSha256:EXPECTED.sha,
  priceReceiptSha256:Q.sha,retainedDetailReceiptSha256,publicDirectorySha256,editorialReceiptSha256:Q.editorial,admitted,legalValidUntil};
 const readySha256=planned('READY.json',ready,32*1024);
 return {paths,ready,readySha256,bytes,blocks:blocks.length,detailShards:shards.size,samples,
  photoCards:[...rows.values()].filter(r=>r.images.length>0).length};
}
