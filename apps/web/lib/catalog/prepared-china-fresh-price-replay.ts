import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {applyActiveBusinessPriceBatch} from './live-business-pricing';
import {calculateOfferWithVerifiedSpecifications} from './customs-pricing';
import {readCatalogEditorialFresh} from './editorial';
import {chinaPreparedEditorialOffer,preparedChinaEditorialEvidence} from './china-prepared-editorial.mjs';
import {specificationEvidenceComplete} from './modification-matching';
import {enrichOfferWithSourceTableDisplacement} from './source-table-displacement';
import {withCatalogFxBatch,type CatalogFxBatch} from './rates';
import {budgetPricingFingerprint,calculationCacheVersion} from './shared-budget-prices';
import type {VehicleOffer} from './types';
import {CATALOG_CHUNK_SIZE} from './runtime-config';
import type {PreparedPriceExpectedBlock} from './prepared-price-coverage';
import type {prepareIndependentChinaCanonicalChunks} from './independent-china-prepared-fixture';
import {projectionCanRenderCard,searchProjectionFromOffer} from './storage';
import {preparedChinaCalculationIncomplete} from './prepared-price-card-block';

const fail=(reason:string):never=>{throw Error('china_fresh_price_replay:'+reason);};
const sha=/^[a-f0-9]{64}$/,id=/^[A-Za-z0-9_:-]{1,150}$/;
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const authority=Symbol('fresh-China-price-process');
export type FreshChinaPriceReplay=Readonly<{[authority]:true}>;
type Reader=(rows:readonly VehicleOffer[],fx:CatalogFxBatch,pricingFingerprint:string,calculationVersion:string)=>Promise<VehicleOffer[]>;
const readers=new WeakMap<FreshChinaPriceReplay,Reader>();
type CleanDecision={id:string;inputSha256:string;state:'eligible_unpriced'}|{
 id:string;inputSha256:string;state:'excluded'|'withdrawn';reason?:string;withdrawal?:unknown;
};
type PricedDecision=CleanDecision|{id:string;inputSha256:string;state:'admitted';canonicalSha256:string};
export type CleanChinaPriceSourceBinding={continuitySha256:string;sourceReportSha256:string;nativeAdmissionSha256:string;
 sourceReplicaSha256:string;sourceCursor:number;sourceExpiresAt:number;sourceBinding?:string};
export type CleanChinaPriceSourceProof=CleanChinaPriceSourceBinding&{
 version:1;kind:'china-full-fresh-source-admission-only';coverage:'materialized_complete_replica_after_committed_delta';
 oldRowsMerged:false;sourceRows:number;eligibleUnpricedRows:number;excludedRows:number;explicitlyWithdrawnRows:number;
 orderedInputSha256:string;priced:false;publicationAuthorized:false;cursorAdvanceAuthorized:false;
};
const CHE168='autohome_used_china_open';
/** Clean admission authenticated the exact collector archive and each row.
 * Re-check the native Che168 data shape and current snapshot binding here so
 * unrelated rows cannot enter the source-only branch. */
function exactChe168Identity(row:VehicleOffer,source:CleanChinaPriceSourceBinding){
 const o=row.operational,v=(o as any)?.che168ActiveVerification;
 return row.sourceId===CHE168&&/^\d{1,150}$/.test(row.sourceOfferId??'')&&row.id===hash(CHE168+':'+row.sourceOfferId).slice(0,24)&&
  o?.provider==='auto-api.com'&&o.detailIdentityVerified===true&&o.fieldIdentityVerified===true&&
  new RegExp('^https://www\\.che168\\.com/dealer/\\d+/'+row.sourceOfferId+'\\.html$').test(o.sourceUrl??'')&&
  v?.method==='snapshot_and_complete_change_stream'&&v.snapshotBinding===source.sourceBinding&&v.cursor===source.sourceCursor;
}
function exactChe168SourceParameters(row:VehicleOffer):VehicleOffer|null {
 // The actual mapper carries ICE PS/kW but does NOT grant authenticated
 // 30-minute power from peak data; electrified rows still require the existing
 // exact encyclopedia/certificate route. No representative/seller fallback.
 if(row.powertrainKind!=='combustion'||!row.powerHp||row.powerDataConfidence!=='source_exact'||
    row.powerDataSource!=='auto_api_che168_source')return null;
 const o=row.operational!,e=o.semanticEvidence as any,s=o.sourceSpecifications;
 if(!s||s.sourceId!==row.sourceId||s.sourceOfferId!==row.sourceOfferId||s.sourceUrl!==o.sourceUrl||
    !/^\d+$/.test(s.specificationId)||e?.powerHp?.status!=='exact'||e.powerHp.source!=='auto_api_che168:power_ps'||
    e.powerHp.value!==row.powerHp||e?.fuel?.status!=='exact'||e.fuel.source!=='auto_api_che168:engine_type'||
    e.fuel.value!==row.fuel||e?.engineCc?.status!=='exact'||e.engineCc.value!==row.engineCc||
    e.engineCc.source!=='source_table:'+row.sourceId+':'+row.sourceOfferId+':'+s.specificationId||
    enrichOfferWithSourceTableDisplacement({...row,engineCc:undefined}).engineCc!==row.engineCc||
    !specificationEvidenceComplete(row))return null;
 if(row.powerKw===undefined&&row.icePowerKw===undefined)return row;
 if(!Number.isFinite(row.powerKw)||row.powerKw!<=0||row.powerKw!==row.icePowerKw||
    Math.abs(row.powerHp-row.powerKw!*1.3596216173)>2||
    (e?.powerKw!==undefined&&(e.powerKw.status!=='exact'||e.powerKw.value!==row.powerKw)))return null;
 // normalizeAutoApiChe168 writes these equal numeric kW fields from explicit
 // ice_power_kw, but its semantic map names only PS. Attest the validated
 // native kW in the pricing copy so normal consistency logic cannot convert PS
 // back into a different kW. Canonical input and its SHA remain unchanged.
 return {...row,operational:{...o,semanticEvidence:{...e,
  powerKw:{status:'exact',source:'auto_api_che168:ice_power_kw',value:row.powerKw}}}};
}
/** Retain only a process-local capability; there is no trust in a serialized
 * 'already priced' flag. Exact block validation still runs before publishing. */
export async function readFreshChinaPreparedPrices(replay:FreshChinaPriceReplay,rows:readonly VehicleOffer[],
 fx:CatalogFxBatch,pricingFingerprint:string,calculationVersion:string){
 const get=readers.get(replay);
 if(!get)return fail('untrusted_replay');
 return get(rows,fx,pricingFingerprint,calculationVersion);
}

/** Private per-job clean eligibility → unchanged engine boundary. Feed the
 * result of the independently bound native admission; exclusions are retained
 * explicitly, not promoted to withdrawal because a price is missing. */
export async function openFreshChinaPriceReplay(input:{
 directory:string;fx:CatalogFxBatch;pricingFingerprint:string;calculationVersion:string;expectedInputRows:number;
 source:CleanChinaPriceSourceBinding;assertSourceAuthority:()=>Promise<void>;
}){
 const {directory,fx,pricingFingerprint,calculationVersion}=input;
 if(!path.isAbsolute(directory)||path.normalize(directory)!==directory||
    !/^avtocena-china-fresh-prices-[a-z0-9-]{1,45}$/.test(path.basename(directory))||
    await fs.realpath(path.dirname(directory))!==path.dirname(directory)||
    fx.receipt.market!=='china'||!sha.test(fx.receiptSha256)||!sha.test(pricingFingerprint)||!sha.test(calculationVersion)||
    !Number.isSafeInteger(input.expectedInputRows)||input.expectedInputRows<1||input.expectedInputRows>1_000_000||
    ![input.source?.continuitySha256,input.source?.sourceReportSha256,input.source?.nativeAdmissionSha256,
      input.source?.sourceReplicaSha256].every(x=>sha.test(x??''))||!Number.isSafeInteger(input.source?.sourceCursor)||
    input.source.sourceCursor<1||(input.source.sourceBinding!==undefined&&!sha.test(input.source.sourceBinding))||!Number.isSafeInteger(input.source?.sourceExpiresAt)||Date.now()>=input.source.sourceExpiresAt||
    typeof input.assertSourceAuthority!=='function')return fail('scope');
 const sourceBinding=Object.freeze({...input.source});
 await input.assertSourceAuthority();
 const editorial=sourceBinding.sourceBinding?preparedChinaEditorialEvidence(await readCatalogEditorialFresh()):undefined;
 await fs.mkdir(directory,{mode:0o700});
 const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
 const filename=path.join(directory,'priced.sqlite'),db=new DatabaseSync(filename);
 try{await fs.chmod(filename,0o600);db.exec('PRAGMA temp_store=FILE; PRAGMA cache_size=-16384; CREATE TABLE eval(id TEXT PRIMARY KEY,sourceSha TEXT,pricedSha TEXT,price BLOB,native TEXT,ordinal INTEGER UNIQUE); CREATE TABLE plan(ord INTEGER PRIMARY KEY,paper TEXT NOT NULL);');}
 catch(error){db.close();throw error;}
 const record=db.prepare('INSERT INTO eval (id,sourceSha,pricedSha,price) VALUES (?,?,?,?)');
 const get=db.prepare('SELECT sourceSha,pricedSha,price FROM eval WHERE id=?');
 const byId=db.prepare('SELECT sourceSha,pricedSha,native,ordinal FROM eval WHERE id=?');
 const token:FreshChinaPriceReplay=Object.freeze({[authority]:true as const});
 let mode:'writing'|'ready'|'failed'|'closed'='writing',inputRows=0,admitted=0,excluded=0,withdrawn=0,eligibleInput=0,excludedInput=0,busy=false,selectionBound=false;
 const observedIds=createHash('sha256').update('china-full-fresh-source-ordered-input-v1\n');
 const reasons=new Map<string,number>();
 const check=async()=>{
  if(Date.now()>=sourceBinding.sourceExpiresAt)return fail('source_expired');
  await input.assertSourceAuthority();
  await withCatalogFxBatch(fx,async()=>{
   if(await budgetPricingFingerprint('china')!==pricingFingerprint||calculationCacheVersion()!==calculationVersion)return fail('pricing_context_changed');
  });
 };
 const reject=(source:CleanDecision,reason:string):PricedDecision=>{
  excluded++;reasons.set(reason,(reasons.get(reason)??0)+1);
  return {id:source.id,inputSha256:source.inputSha256,state:'excluded',reason};
 };
 return Object.freeze({
  async consume(batch:{rows:readonly VehicleOffer[];dispositions:readonly CleanDecision[]}):Promise<PricedDecision[]>{
   if(mode!=='writing'||busy||!batch.rows.length||batch.rows.length>500||batch.rows.length!==batch.dispositions.length)return fail('batch_scope');
   busy=true;
   try{
    await check();db.exec('BEGIN');
    const outputs:PricedDecision[]=[],ready:{row:VehicleOffer;sourceExact:VehicleOffer|null;d:CleanDecision;i:number}[]=[];
    for(const [i,row]of batch.rows.entries()){
     const d=batch.dispositions[i],serialized=JSON.stringify(row);
     if(!d||d.id!==row.id||d.inputSha256!==hash(serialized)||!id.test(row.id)||row.market!=='china'||
        !['eligible_unpriced','excluded','withdrawn'].includes(d.state)||Buffer.byteLength(serialized)>1024*1024||++inputRows>input.expectedInputRows||
        get.get(row.id))return fail('source_binding');
     record.run(row.id,d.inputSha256,null,null);
     observedIds.update(JSON.stringify({id:row.id,inputSha256:d.inputSha256})+'\n');
     if(d.state==='excluded'){excludedInput++;outputs[i]=reject(d,d.reason||'source_excluded');continue;}
     if(d.state==='withdrawn'){outputs[i]=d;withdrawn++;continue;}
     eligibleInput++;
     if(row.status!=='active'||row.sourceCurrency!=='CNY'||!Number.isFinite(row.sourcePrice)||!(row.sourcePrice>0)){
      outputs[i]=reject(d,'pricing:source_price_unusable');continue;
     }
     if(sourceBinding.sourceBinding&&!exactChe168Identity(row,sourceBinding))return fail('native_source_identity');
     // The fresh collector never calculates prices. Strip any out-of-contract
     // stored price from this pathway rather than importing an earlier ledger.
     const sourceExact=sourceBinding.sourceBinding?exactChe168SourceParameters(row):null;
     const adjusted=editorial?chinaPreparedEditorialOffer(row,editorial):{row};
     if(!adjusted.row){outputs[i]=reject(d,adjusted.reason??'editorial_conflict');continue;}
     const unpriced=sourceBinding.sourceBinding?{...adjusted.row,totalRub:null,calculationSnapshot:undefined}:row;
     const exact=sourceExact&&editorial?chinaPreparedEditorialOffer(sourceExact,editorial).row:sourceExact;
     ready.push({row:unpriced,d,i,sourceExact:exact?{...exact,totalRub:null,calculationSnapshot:undefined}:null});
    }
    const update=db.prepare('UPDATE eval SET pricedSha=?,price=?,native=? WHERE id=?');
    for(let start=0;start<ready.length;start+=64){
     const group=ready.slice(start,start+64);
     const priced=await withCatalogFxBatch(fx,async()=>{
      const fallback=group.filter(x=>!x.sourceExact);
      const unchanged=await applyActiveBusinessPriceBatch(fallback.map(x=>x.row),{readOnly:true,retainFullSnapshot:true});
      let i=0;
      return Promise.all(group.map(async x=>{
       if(!x.sourceExact)return unchanged[i++];
       // The same standard engine used for exact verified rows; no second
       // customs computation in business repricing. Only record the actual
       // frozen pricing clock that the calculator used.
       const result=await calculateOfferWithVerifiedSpecifications(x.sourceExact);
       return result.calculationSnapshot?.customs?.status==='ready'?{...result,
        calculationSnapshot:{...result.calculationSnapshot,businessRepricedAt:fx.receipt.pricingAsOf}}:result;
      }));
     });
     for(const [j,row]of priced.entries()){
      const {row:pricedInput,d,i}=group[j];
      const source=batch.rows[i];
      if(row.id!==source.id||row.sourceCurrency!==source.sourceCurrency||row.sourcePrice!==source.sourcePrice||pricedInput.id!==source.id)return fail('engine_source_identity');
      if(preparedChinaCalculationIncomplete(row,fx.receipt.pricingAsOf)){
       const reason=['needs_data','needs_customs_data','needs_currency_rate','estimated','ready'].includes(row.calculationStatus)?
        row.calculationStatus:'incomplete';
       if(reason==='needs_currency_rate')return fail('official_rate_unavailable');
       outputs[i]=reject(d,'pricing:'+reason);continue;
      }
      const projected=searchProjectionFromOffer(row);
      if(!projectionCanRenderCard(projected)||projected.totalRub!==row.totalRub){outputs[i]=reject(d,'pricing:public_projection');continue;}
      const detail=JSON.stringify(row);
      if(Buffer.byteLength(detail)>1024*1024)return fail('priced_row_budget');
      update.run(hash(detail),detail,JSON.stringify(source),row.id);
      admitted++;outputs[i]={id:d.id,inputSha256:d.inputSha256,state:'admitted',canonicalSha256:d.inputSha256};
     }
    }
    db.exec('COMMIT');await check();return outputs;
   }catch(error){mode='failed';try{db.exec('ROLLBACK');}catch{}throw error;}
   finally{busy=false;}
  },
  async seal({proof,proofSha256}:{proof:CleanChinaPriceSourceProof;proofSha256:string}){
   if(mode!=='writing'||busy||!proof||hash(JSON.stringify(proof))!==proofSha256||
      proof.version!==1||proof.kind!=='china-full-fresh-source-admission-only'||
      proof.coverage!=='materialized_complete_replica_after_committed_delta'||proof.oldRowsMerged!==false||
      proof.priced!==false||proof.publicationAuthorized!==false||proof.cursorAdvanceAuthorized!==false||
      Object.keys(sourceBinding).some(k=>proof[k as keyof CleanChinaPriceSourceBinding]!==sourceBinding[k as keyof CleanChinaPriceSourceBinding])||
      inputRows!==input.expectedInputRows||inputRows!==proof.sourceRows||!admitted||inputRows!==admitted+excluded+withdrawn||
      eligibleInput!==proof.eligibleUnpricedRows||excludedInput!==proof.excludedRows||withdrawn!==proof.explicitlyWithdrawnRows)
    return fail('source_census');
   if(observedIds.copy().digest('hex')!==proof.orderedInputSha256)return fail('source_ordered_digest');
   await check();mode='ready';
   readers.set(token,async(rows,askedFx,askedPricing,askedVersion)=>{
    if(mode!=='ready'||askedFx.receiptSha256!==fx.receiptSha256||askedPricing!==pricingFingerprint||askedVersion!==calculationVersion)
     return fail('replay_binding');
    if(Date.now()>=sourceBinding.sourceExpiresAt)return fail('source_expired');
    await input.assertSourceAuthority();
    return rows.map(row=>{
     const proof=get.get(row.id);
     if(!proof||proof.sourceSha!==hash(JSON.stringify(row))||typeof proof.price!=='string'||proof.pricedSha!==hash(proof.price))
      return fail('replay_row_binding');
     const parsed=JSON.parse(proof.price) as VehicleOffer;
     const customsInput=parsed.calculationSnapshot?.customsInput;
     if(!customsInput||(customsInput.importedAt as unknown)!==fx.receipt.pricingAsOf)return fail('replay_as_of');
     // Preserve the engine's real legal tariff horizon. JSON transport turns
     // this exact Date into an ISO string; no calendar resampling is allowed.
     customsInput.importedAt=new Date(fx.receipt.pricingAsOf);
     return parsed;
    });
   });
   return {replay:token,counts:{inputRows,admitted,excluded,withdrawn,reasons:Object.fromEntries(reasons)}};
  },
  /** Single-job bridge: authenticated final admitted IDs select already
   * checked inputs from the private engine spool. No new raw package on disk
   * and no price computation in the immutable stage writer. */
  async stageCanonical(inputStage:Omit<Parameters<typeof prepareIndependentChinaCanonicalChunks>[0],
    'count'|'chunks'|'expectedAdmittedIdsSha256'|'expectedBlocks'|'fx'|'pricingFingerprint'|'calculationVersion'|'priceReplay'>&{
     selection:{
      admittedRows:number;orderedAdmittedIdsSha256:string;assertCurrent:()=>Promise<void>;
      picks:()=>AsyncIterable<{id:string;canonicalSha256:string}>;
     };
    }){
   const {selection,blockRows,source}=inputStage;
   if(mode!=='ready'||busy||selectionBound||inputStage.publication.market!=='china'||typeof selection?.picks!=='function'||
      typeof selection.assertCurrent!=='function'||!Number.isSafeInteger(selection.admittedRows)||selection.admittedRows<1||
      selection.admittedRows>admitted||!sha.test(selection.orderedAdmittedIdsSha256)||!Number.isSafeInteger(blockRows)||blockRows<1||blockRows>128||
      source?.cursor?.sequence!==sourceBinding.sourceCursor||source?.cursor?.anchorSha256!==sourceBinding.sourceReplicaSha256||
      source.validUntil>sourceBinding.sourceExpiresAt)return fail('stage_selection_scope');
   busy=true;
   const stageFence=async()=>{await check();await selection.assertCurrent();await input.assertSourceAuthority();};
   try{
    await stageFence();
    db.exec('BEGIN');
    const assign=db.prepare('UPDATE eval SET ordinal=? WHERE id=? AND ordinal IS NULL');
    const plan=db.prepare('INSERT INTO plan VALUES (?,?)');
    const ordered=createHash('sha256').update('prepared-ordered-admitted-ids-v1\n');
    const replayBlock:VehicleOffer[]=[];
    let ordinal=0,blockOrdinal=0,first=0;
    const flush=()=>{
     if(!replayBlock.length)return;
     const sourceChunk='chunk-'+String(Math.floor(first/CATALOG_CHUNK_SIZE)+1).padStart(4,'0');
     const part=Math.floor((first%CATALOG_CHUNK_SIZE)/blockRows);
     plan.run(blockOrdinal++,JSON.stringify({sourceChunk,part,rows:replayBlock.length,
      sourceIdsSha256:hash(JSON.stringify(replayBlock.map(x=>x.id))),sourceInputSha256:hash(JSON.stringify(replayBlock))} satisfies PreparedPriceExpectedBlock));
     first+=replayBlock.length;replayBlock.length=0;
    };
    for await(const pick of selection.picks()){
     if(ordinal%500===0)await stageFence();
     if(ordinal>=selection.admittedRows||!id.test(pick?.id??'')||!sha.test(pick?.canonicalSha256??''))return fail('stage_selection_row');
     const row=byId.get(pick.id);
     if(!row||row.ordinal!==null||row.sourceSha!==pick.canonicalSha256||typeof row.native!=='string'||
        hash(row.native)!==row.sourceSha||!row.pricedSha)return fail('stage_selection_binding');
     if(assign.run(ordinal++,pick.id).changes!==1)return fail('stage_selection_duplicate');
     ordered.update(JSON.stringify(pick.id)+'\n');
     replayBlock.push(JSON.parse(row.native));
     if(replayBlock.length===blockRows||ordinal%CATALOG_CHUNK_SIZE===0)flush();
    }
    flush();await stageFence();
    if(ordinal!==selection.admittedRows||ordered.digest('hex')!==selection.orderedAdmittedIdsSha256)return fail('stage_selection_digest');
    db.exec('COMMIT');selectionBound=true;
    const chunks=async function*(){
     let batch:VehicleOffer[]=[],i=0;
     for(const cell of db.prepare('SELECT ordinal,id,sourceSha,native FROM eval WHERE ordinal IS NOT NULL ORDER BY ordinal').iterate()){
      if(cell.ordinal!==i++||typeof cell.native!=='string'||hash(cell.native)!==cell.sourceSha)return fail('stage_input_replay');
      const row=JSON.parse(cell.native) as VehicleOffer;
      if(row.id!==cell.id)return fail('stage_input_replay');
      batch.push(row);
      if(batch.length===CATALOG_CHUNK_SIZE){await stageFence();yield batch;batch=[];}
     }
     if(batch.length){await stageFence();yield batch;}
    };
    const expectedBlocks=async function*(){
     for(const record of db.prepare('SELECT paper FROM plan ORDER BY ord').iterate())yield JSON.parse(record.paper) as PreparedPriceExpectedBlock;
    };
    const {prepareIndependentChinaCanonicalChunks}=await import('./independent-china-prepared-fixture');
    const {selection:_selection,...stage}=inputStage;
    return await prepareIndependentChinaCanonicalChunks({...stage,count:ordinal,chunks,expectedBlocks,fx,pricingFingerprint,calculationVersion,
      expectedAdmittedIdsSha256:selection.orderedAdmittedIdsSha256,priceReplay:token,
      ...(editorial?{chinaEditorialSha256:editorial.sha256}:{})});
   }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
   finally{busy=false;}
  },
  close(){
   if(busy)return fail('busy');
   if(mode!=='closed'){mode='closed';readers.delete(token);db.close();}
  },
 });
}

/** Private same-process adapter for a verified mixed delta. This does not
 * authenticate an archive itself or create/publish READY. The caller must
 * supply a typed verifier of the exact native terminal/accepted-cut ledger. */
type VerifiedMixedDecision={
  id:string;sourceInputSha256:string;action:'changed';
}|{
  id:string;sourceInputSha256:string;action:'frozen';previousSourceInputSha256:string;previousReceiptSha256:string;
};
type VerifiedMixedFrozen={
  id:string;sourceInputSha256:string;previousReceiptSha256:string;pricedRow:VehicleOffer;
  fxReceiptSha256:string;pricingFingerprint:string;calculationVersion:string;pricingAsOf:string;legalValidUntil:number;
};
export async function openMixedChinaPriceReplay(input:{
  fx:CatalogFxBatch;pricingFingerprint:string;calculationVersion:string;legalValidUntil:number;
  source:CleanChinaPriceSourceBinding;expectedChangedRows:number;
  verifyTerminalAndPrevious:()=>Promise<{
    assertCurrent:()=>Promise<void>;
    decision:(id:string)=>Promise<VerifiedMixedDecision|null>;
    readFrozen:(id:string)=>Promise<VerifiedMixedFrozen|null>;
  }>;
}){
 const {fx,pricingFingerprint,calculationVersion,legalValidUntil}=input;
 const source=Object.freeze({...input.source}),expectedChangedRows=input.expectedChangedRows;
 if(fx.receipt.market!=='china'||![fx.receiptSha256,pricingFingerprint,calculationVersion,source.continuitySha256,
   source.sourceReportSha256,source.nativeAdmissionSha256,source.sourceReplicaSha256,source.sourceBinding].every(x=>sha.test(x??''))||
   !Number.isSafeInteger(source.sourceCursor)||source.sourceCursor<1||!Number.isSafeInteger(source.sourceExpiresAt)||
   !Number.isSafeInteger(legalValidUntil)||!Number.isSafeInteger(expectedChangedRows)||expectedChangedRows<0||expectedChangedRows>50000||
   !Number.isFinite(Date.parse(fx.receipt.pricingAsOf))||Date.parse(fx.receipt.pricingAsOf)>Date.now()||
   Date.now()>=Math.min(legalValidUntil,source.sourceExpiresAt))return fail('mixed_scope');
 const verified=await input.verifyTerminalAndPrevious();
 const check=async()=>{
  if(Date.now()>=Math.min(legalValidUntil,source.sourceExpiresAt))return fail('mixed_expired');
  await verified.assertCurrent();
  await withCatalogFxBatch(fx,async()=>{
   if(await budgetPricingFingerprint('china')!==pricingFingerprint||calculationCacheVersion()!==calculationVersion)return fail('mixed_context');
  });
 };
 await check();
 const editorial=preparedChinaEditorialEvidence(await readCatalogEditorialFresh());
 const changed=new Map<string,{inputSha256:string;priced:Promise<{text:string;sha256:string}>}>();
 const checkOutput=(row:VehicleOffer,result:VehicleOffer)=>{
  if(result.id!==row.id||result.market!=='china'||result.sourcePrice!==row.sourcePrice||
     result.sourceCurrency!==row.sourceCurrency||preparedChinaCalculationIncomplete(result,fx.receipt.pricingAsOf)||
     !projectionCanRenderCard(searchProjectionFromOffer(result)))return fail('mixed_output');
  const asOf=result.calculationSnapshot?.customsInput?.importedAt;
  if((asOf instanceof Date?asOf.toISOString():asOf)!==fx.receipt.pricingAsOf)return fail('mixed_as_of');
  return result;
 };
 let closed=false, encodedChangedBytes=0;
 const token:FreshChinaPriceReplay=Object.freeze({[authority]:true as const});
 readers.set(token,async(rows,askedFx,askedPricing,askedVersion)=>{
  if(closed||!rows.length||rows.length>500||new Set(rows.map(x=>x.id)).size!==rows.length||
    askedFx.receiptSha256!==fx.receiptSha256||askedPricing!==pricingFingerprint||askedVersion!==calculationVersion)return fail('mixed_request');
  await check();
  const result:VehicleOffer[]=[];
  for(const row of rows){
   const content=JSON.stringify(row),inputSha256=hash(content);
   if(Buffer.byteLength(content)>1024*1024||row.market!=='china'||!exactChe168Identity(row,source)||
     row.status!=='active'||row.sourceCurrency!=='CNY'||!(row.sourcePrice>0))return fail('mixed_native_row');
   const d=await verified.decision(row.id);
   if(!d||d.id!==row.id||d.sourceInputSha256!==inputSha256)return fail('mixed_missing_decision');
   if(d.action==='frozen'){
    const v=await verified.readFrozen(row.id);
    if(!v||v.id!==row.id||!sha.test(d.previousSourceInputSha256)||v.sourceInputSha256!==d.previousSourceInputSha256||!sha.test(d.previousReceiptSha256)||
       v.previousReceiptSha256!==d.previousReceiptSha256||v.fxReceiptSha256!==fx.receiptSha256||
       v.pricingFingerprint!==pricingFingerprint||v.calculationVersion!==calculationVersion||
       v.pricingAsOf!==fx.receipt.pricingAsOf||!Number.isSafeInteger(v.legalValidUntil)||Date.now()>=v.legalValidUntil)
      return fail('mixed_frozen_binding');
    result.push(checkOutput(row,structuredClone(v.pricedRow)));continue;
   }
   if(d.action!=='changed')return fail('mixed_decision');
   let saved=changed.get(row.id);
   if(saved&&saved.inputSha256!==inputSha256)return fail('mixed_changed_drift');
   if(!saved){
    if(changed.size>=expectedChangedRows)return fail('mixed_changed_limit');
    const calculate=async()=>{
     const exact=exactChe168SourceParameters(row);
     const adjusted=chinaPreparedEditorialOffer(exact??row,editorial);
     if(!adjusted.row)return fail('mixed_editorial');
     const sourceRow={...adjusted.row,totalRub:null,calculationSnapshot:undefined};
     const priced=await withCatalogFxBatch(fx,async()=>{
      if(!exact)return (await applyActiveBusinessPriceBatch([sourceRow],{readOnly:true,retainFullSnapshot:true}))[0];
      const r=await calculateOfferWithVerifiedSpecifications(sourceRow);
      return r.calculationSnapshot?.customs?.status==='ready'?
       {...r,calculationSnapshot:{...r.calculationSnapshot,businessRepricedAt:fx.receipt.pricingAsOf}}:r;
     });
     const serialized=JSON.stringify(checkOutput(row,priced));
     const bytes=Buffer.byteLength(serialized);
     if(bytes>1024*1024||(encodedChangedBytes+=bytes)>64*1024*1024)return fail('mixed_price_budget');
     return {text:serialized,sha256:hash(serialized)};
    };
    // Set the promise synchronously before awaiting it. Competing reader
    // calls share one result (including a held error), never re-run engine.
    saved={inputSha256,priced:calculate()};changed.set(row.id,saved);
   }
   const q=await saved.priced;
   if(hash(q.text)!==q.sha256)return fail('mixed_quote_integrity');
   const priced=JSON.parse(q.text) as VehicleOffer;
   if(priced.calculationSnapshot?.customsInput)
    priced.calculationSnapshot.customsInput.importedAt=new Date(fx.receipt.pricingAsOf);
   result.push(checkOutput(row,priced));
  }
  await check();return result;
 });
 return Object.freeze({replay:token,
  async finish(){
   if(closed||changed.size!==expectedChangedRows)return fail('mixed_changed_coverage');
   await Promise.all([...changed.values()].map(x=>x.priced));
   await check();return {changedRows:changed.size,publicationAuthorized:false,cursorAdvanceAuthorized:false} as const;
  },
  close(){closed=true;readers.delete(token);changed.clear();}
 });
}
