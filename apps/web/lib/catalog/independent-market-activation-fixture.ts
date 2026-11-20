import {createHash,randomUUID} from 'node:crypto';
import {ObjectJsonStorage,StorageConflictError,jsonReadByteLength,type JsonReadResult} from '../data';
import type {CatalogMarket} from './types';
import {assertStageChinaFiles,type StageChinaFiles} from './china-stage-runtime-files';
import {assertChinaStageObjectFiles,type ChinaStageObjectFiles} from './china-regcloud-object-reader';

const MARKETS=['china','korea','uae','europe','georgia'] as const satisfies readonly CatalogMarket[];
export type IndependentMarket=(typeof MARKETS)[number];
const ROLES=['inventory','prices','search'] as const;
type Role=(typeof ROLES)[number];
const SHA=/^[a-f0-9]{64}$/,GEN=/^gen_\d{13}_[a-z0-9]{1,64}$/,STREAM=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const MAX_PAPER=4*1024*1024,MAX_ROOT=32*1024,MAX_LEASE=8*60*60_000;
const fail=(why:string):never=>{throw Error('market_activation_fixture:'+why);};
const bytes=(v:unknown)=>Buffer.from(JSON.stringify(v));
const hash=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
const fingerprint=(v:unknown)=>hash(bytes(v));
const clockInt=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const validSha=(v:unknown):v is string=>typeof v==='string'&&SHA.test(v);
type Cursor={stream:string;sequence:number;anchorSha256:string};
type Ref={generationId:string;manifestSha256:string;activateRevision:number;cursor:Cursor};
type Intent={action:'publish'|'rollback';generationId:string;expectedBaseSha256:string};
export type IndependentMarketLease=Intent & {token:string;startedAt:number;expiresAt:number};
type Lease=IndependentMarketLease;
type State={version:1;market:IndependentMarket;revision:number;active:Ref|null;previous:Ref|null;lease:Lease|null};
export type IndependentCut={
 version:1;market:IndependentMarket;generationId:string;expectedBaseSha256:string;previousCursorSha256:string;
 source:{complete:true;receiptSha256:string;observedAt:number;validUntil:number;cursor:Cursor};
 pricing:{receiptSha256:string;inputFingerprint:string;calculationVersion:string;pricedAt:number;validUntil:number};
 admitted:{count:number;orderedIdsSha256:string};
 papers:Record<Role,string>;
 preparedChina?:true;
};
export type IndependentMarketPaper={version:1;role:Role;market:IndependentMarket;generationId:string;
 sourceReceiptSha256:string;pricingReceiptSha256:string;orderedIdsSha256:string;count:number;payload:unknown};
type Phase='acquire'|'stage'|'activate'|'rollback'|'release';
type Permit={
 origin:string;bucket:string;prefix:string;fixtureFetch:typeof fetch;
 assertAuthorized:(market:IndependentMarket,phase:Phase)=>Promise<void>;
};
export const independentMarketDigest=fingerprint;
const validCursor=(v:Cursor)=>!!v&&typeof v.stream==='string'&&STREAM.test(v.stream)&&clockInt(v.sequence)&&validSha(v.anchorSha256);
const validRef=(v:Ref)=>!!v&&GEN.test(v.generationId)&&validSha(v.manifestSha256)&&clockInt(v.activateRevision)&&validCursor(v.cursor);
const base=(ref:Ref|null)=>fingerprint(ref);
const same=(a:unknown,b:unknown)=>fingerprint(a)===fingerprint(b);

function assertCut(cut:IndependentCut,market:IndependentMarket,g:string,now:number){
 const {source,pricing,admitted,papers}=cut||{};
 if(cut?.version!==1||cut.market!==market||(cut.preparedChina!==undefined&&(market!=='china'||cut.preparedChina!==true))||!GEN.test(g)||cut.generationId!==g||!validSha(cut.expectedBaseSha256)||
    !validSha(cut.previousCursorSha256)||source?.complete!==true||!validSha(source.receiptSha256)||
    !clockInt(source.observedAt)||!clockInt(source.validUntil)||source.observedAt>now||source.validUntil<=now||!validCursor(source.cursor)||
    !pricing||!validSha(pricing.receiptSha256)||!validSha(pricing.inputFingerprint)||!validSha(pricing.calculationVersion)||
    !clockInt(pricing.pricedAt)||!clockInt(pricing.validUntil)||pricing.pricedAt>now||pricing.validUntil<=now||
    !admitted||!clockInt(admitted.count)||!validSha(admitted.orderedIdsSha256)||!papers||
    Object.keys(papers).length!==ROLES.length||ROLES.some(role=>!validSha(papers[role])))return fail('cut_not_ready');
}
function assertPaper(paper:IndependentMarketPaper,cut:IndependentCut,role:Role){
 if(paper?.version!==1||paper.role!==role||paper.market!==cut.market||paper.generationId!==cut.generationId||
    paper.sourceReceiptSha256!==cut.source.receiptSha256||paper.pricingReceiptSha256!==cut.pricing.receiptSha256||
    paper.orderedIdsSha256!==cut.admitted.orderedIdsSha256||paper.count!==cut.admitted.count||!Object.hasOwn(paper,'payload'))return fail('paper_scope');
}
function revision(v:number){if(!Number.isSafeInteger(v+1))return fail('revision');return v+1;}

/** No production caller or ENV flag. All state/immutable write paths derive from
 * the market fixed when opening the capability; the real S3 client is mocked. */
export function openIndependentMarketFixture(storage:ObjectJsonStorage,market:IndependentMarket,permit:Permit){
 if(!MARKETS.includes(market)||!(storage instanceof ObjectJsonStorage)||!permit||
    typeof permit.fixtureFetch!=='function'||typeof permit.assertAuthorized!=='function')return fail('authority_required');
 const auth=Object.freeze({...permit});
 const assertBackend=()=>{
  if(storage.driver!=='object'||globalThis.fetch!==auth.fixtureFetch||!/^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(auth.origin)||
     !/^fixture-[a-z0-9-]{1,32}$/.test(auth.bucket)||!/^fixture-[a-z0-9-]{1,32}$/.test(auth.prefix)||
     process.env.YC_OBJECT_STORAGE_ENDPOINT!==auth.origin||process.env.YC_OBJECT_STORAGE_BUCKET!==auth.bucket||
     process.env.YC_OBJECT_STORAGE_PREFIX!==auth.prefix||process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID!=='fixture'||
     process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY!=='fixture')return fail('mock_only');
 };
 assertBackend();
 return openIndependentMarketBackend(storage,market,assertBackend,phase=>auth.assertAuthorized(market,phase));
}

/** Writer authority remains mock-only; the native stage adapter only receives
 * the read side of the same decoder and fences. */
function openIndependentMarketBackend<T extends ObjectJsonStorage|StageChinaFiles|ChinaStageObjectFiles>(storage:T,market:IndependentMarket,
 assertBackend:()=>void,authorizePhase:(phase:Phase)=>Promise<void>){
 const authorize=async(phase:Phase)=>{assertBackend();await authorizePhase(phase);assertBackend();};
 const writable=()=>{if(!(storage instanceof ObjectJsonStorage))return fail('readonly_backend');return storage;};
 const root=`catalog/market-activation-fixture-v1/${market}/`,controlKey=root+'control.json';
 const path=(g:string,name:string)=>root+`generations/${g}/`+name;
 const empty:State={version:1,market,revision:0,active:null,previous:null,lease:null};
 const readState=async():Promise<JsonReadResult<State>>=>{
  assertBackend();
  const r=await storage.readJsonWithMeta<State|null>(controlKey,null);
  if(!r.found)return {found:false,value:empty};
  const v=r.value;
  if(!r.etag||(jsonReadByteLength(v)??(storage instanceof ObjectJsonStorage?MAX_ROOT+1:bytes(v).length))>MAX_ROOT||v?.version!==1||v.market!==market||!clockInt(v.revision)||
     (v.active!==null&&(!validRef(v.active)||v.active.activateRevision>v.revision))||
     (v.previous!==null&&(!validRef(v.previous)||!v.active||v.previous.activateRevision>=v.active.activateRevision))||
     (v.lease!==null&&(!v.lease||!['publish','rollback'].includes(v.lease.action)||!GEN.test(v.lease.generationId)||
      !validSha(v.lease.expectedBaseSha256)||v.lease.expectedBaseSha256!==base(v.active)||!v.lease.token||
      !clockInt(v.lease.startedAt)||!clockInt(v.lease.expiresAt)||v.lease.expiresAt<=v.lease.startedAt||v.lease.expiresAt-v.lease.startedAt>MAX_LEASE)))
   return fail('state_integrity');
  return {found:true,etag:r.etag,value:v};
 };
 const cas=async(current:JsonReadResult<State>,v:Omit<State,'revision'>,deadline?:number)=>{
  assertBackend();
  if(deadline!==undefined&&Date.now()>=deadline)return fail('lease_lost');
  // Revision + exact prior ETag prevents pointer/lease ABA, including rollback.
  await writable().writeJson(controlKey,{...v,revision:revision(current.value.revision)},current.found?{ifMatch:current.etag!}:{ifNoneMatch:'*'});
 };
 const get=async(key:string,expected:string,limit:number)=>{
  assertBackend();
  const {data}=await storage.getBinary(key);
  if(!data.length||data.length>limit||hash(data)!==expected)return fail('immutable_readback');
  return data;
 };
 const chinaObjectKey=(g:string,key:string)=>{
  const begin=`catalog/generations/${g}/`;
  if(market!=='china'||!GEN.test(g)||!key.startsWith(begin))return fail('china_scope');
  const relative=key.slice(begin.length);
  if(!relative.split('/').every(part=>part!=='.'&&part!=='..'&&/^[a-z0-9_.-]+$/.test(part))||
     !/^(?:offers\/china\/|indexes\/(?:prepared-price-cards-v1\/china\/|prepared-china-read-v1\/))/.test(relative))return fail('china_scope');
  return path(g,'prepared/'+relative);
 };
 const readChinaPrepared=async(g:string,key:string,expected?:string)=>{
  assertBackend();const mapped=chinaObjectKey(g,key);
  if(expected!==undefined){
   if(!validSha(expected))return fail('china_digest');
   return get(mapped,expected,MAX_PAPER);
  }
  const {data}=await storage.getBinary(mapped);
  if(!data.length||data.length>MAX_PAPER)return fail('immutable_size');
  return data;
 };
 const put=async(key:string,data:Buffer,limit:number)=>{
  assertBackend();
  if(!data.length||data.length>limit)return fail('immutable_size');
  try{await writable().putBinary(key,data,'application/json',{ifNoneMatch:'*'});}
  catch(error){if(!(error instanceof StorageConflictError))throw error;}
  if(!(await get(key,hash(data),limit)).equals(data))return fail('immutable_readback');
 };
 const generationBinding=(ref:{generationId:string;manifestSha256:string})=>
  bytes({version:1,market,generationId:ref.generationId,manifestSha256:ref.manifestSha256});
 const readCut=async(ref:{generationId:string;manifestSha256:string})=>{
  if(!GEN.test(ref.generationId)||!validSha(ref.manifestSha256))return fail('cut_reference');
  await get(path(ref.generationId,'binding.json'),hash(generationBinding(ref)),MAX_ROOT);
  const body=await get(path(ref.generationId,`ready-${ref.manifestSha256}.json`),ref.manifestSha256,MAX_ROOT);
  const cut=JSON.parse(body.toString('utf8')) as IndependentCut;
  assertCut(cut,market,ref.generationId,Date.now());
  return cut;
 };
 const readPaper=async(cut:IndependentCut,role:Role)=>{
  const digest=cut.papers[role];
  const body=await get(path(cut.generationId,`${role}-${digest}.json`),digest,MAX_PAPER);
  const paper=JSON.parse(body.toString('utf8')) as IndependentMarketPaper;
  assertPaper(paper,cut,role);
  return paper;
 };
 const checkLease=(v:State,lease:Lease)=>{
  const now=Date.now();
  if(!v.lease||!lease||!same(v.lease,lease)||v.lease.startedAt>now||v.lease.expiresAt<=now||
     v.lease.expectedBaseSha256!==base(v.active))return fail('lease_lost');
 };
 const acquire=async(intent:Intent,ttlMs:number)=>{
  const proposed=structuredClone(intent);
  await authorize('acquire');
  const current=await readState(),v=current.value,now=Date.now();
  if(!['publish','rollback'].includes(proposed.action)||!GEN.test(proposed.generationId)||
     !clockInt(ttlMs)||ttlMs>MAX_LEASE||!validSha(proposed.expectedBaseSha256))return fail('intent');
  if(proposed.expectedBaseSha256!==base(v.active))return fail('base_changed');
  if(v.lease&&v.lease.expiresAt>now)return fail('locked');
  if(proposed.action==='publish'&&[v.active?.generationId,v.previous?.generationId].includes(proposed.generationId))return fail('generation_reused');
  if(proposed.action==='rollback'&&v.previous?.generationId!==proposed.generationId)return fail('rollback_target');
  const lease:Lease={...proposed,token:randomUUID(),startedAt:now,expiresAt:now+ttlMs};
  await cas(current,{...v,lease});
  return Object.freeze(lease);
 };
 const prepare=async(lease:Lease,cut:IndependentCut,expectedCutSha256:string,
                     produce:(role:Role)=>Promise<IndependentMarketPaper>)=>{
  const c=structuredClone(cut);
  await authorize('stage');
  const initial=(await readState()).value;checkLease(initial,lease);
  if(initial.lease!.action!=='publish'||c?.expectedBaseSha256!==lease.expectedBaseSha256||
     c.previousCursorSha256!==fingerprint(initial.active?.cursor??null)||fingerprint(c)!==expectedCutSha256)
   return fail('candidate_binding');
  assertCut(c,market,lease.generationId,Date.now());
  if(initial.active&&(c.source.cursor.stream!==initial.active.cursor.stream||c.source.cursor.sequence<initial.active.cursor.sequence||
    (c.source.cursor.sequence===initial.active.cursor.sequence&&!same(c.source.cursor,initial.active.cursor))))return fail('cursor_regression');
  const reference={generationId:c.generationId,manifestSha256:expectedCutSha256};
  await put(path(c.generationId,'binding.json'),generationBinding(reference),MAX_ROOT);
  for(const role of ROLES){
   const paper=await produce(role);assertPaper(paper,c,role);
   const data=bytes(paper),digest=hash(data);
   if(digest!==c.papers[role])return fail('paper_digest');
   await authorize('stage');
   checkLease((await readState()).value,lease);
   await put(path(c.generationId,`${role}-${digest}.json`),data,MAX_PAPER);
  }
  await authorize('stage');
  checkLease((await readState()).value,lease);
  assertCut(c,market,lease.generationId,Date.now());
  await put(path(c.generationId,`ready-${expectedCutSha256}.json`),bytes(c),MAX_ROOT);
  return reference;
 };
 const chinaPreparation=async(lease:Lease)=>{
  if(market!=='china'||lease.action!=='publish')return fail('china_scope');
  const assertCurrent=async()=>{await authorize('stage');const state=(await readState()).value;checkLease(state,lease);return state;};
  const initial=await assertCurrent();
  return {
   storage,
   baseGenerationId:initial.active?.generationId??'gen_0000000000000_empty',
   baseCursor:structuredClone(initial.active?.cursor??null),baseSha256:base(initial.active),
   assertAuthorized:async()=>{await assertCurrent();},
   put:async(key:string,body:Buffer,validUntil:number)=>{
    await assertCurrent();
    if(Date.now()>=validUntil)return fail('lease_lost');
    await put(chinaObjectKey(lease.generationId,key),body,MAX_PAPER);
   },
   read:(key:string,sha?:string)=>readChinaPrepared(lease.generationId,key,sha),
  };
 };
 const verifyPapers=async(cut:IndependentCut)=>{
  const papers={} as Record<Role,IndependentMarketPaper>;
  for(const role of ROLES)papers[role]=await readPaper(cut,role);
  if(cut.preparedChina){
   const {verifyIndependentChinaPreparedArtifacts}=await import('./independent-china-prepared-fixture');
   await verifyIndependentChinaPreparedArtifacts(cut,papers,(key,sha)=>readChinaPrepared(cut.generationId,key,sha));
  }
  return papers;
 };
 const activate=async(lease:Lease,ready:{generationId:string;manifestSha256:string})=>{
  const reference=structuredClone(ready);
  await authorize('activate');
  checkLease((await readState()).value,lease);
  if(lease.action!=='publish'||reference.generationId!==lease.generationId)return fail('candidate_binding');
  const cut=await readCut(reference);
  await verifyPapers(cut);
  await authorize('activate');
  const current=await readState(),v=current.value;checkLease(v,lease);
  if(cut.expectedBaseSha256!==base(v.active)||cut.previousCursorSha256!==fingerprint(v.active?.cursor??null))return fail('candidate_binding');
  // Re-enforce cursor lineage even on resume from pre-existing immutable bytes.
  if(v.active&&(cut.source.cursor.stream!==v.active.cursor.stream||cut.source.cursor.sequence<v.active.cursor.sequence||
    (cut.source.cursor.sequence===v.active.cursor.sequence&&!same(cut.source.cursor,v.active.cursor))))return fail('cursor_regression');
  const next:Ref={generationId:cut.generationId,manifestSha256:reference.manifestSha256,activateRevision:revision(v.revision),cursor:cut.source.cursor};
  await cas(current,{...v,active:next,previous:v.active,lease:null},Math.min(lease.expiresAt,cut.source.validUntil,cut.pricing.validUntil));
  return {generationId:next.generationId,manifestSha256:next.manifestSha256};
 };
 const rollback=async(lease:Lease)=>{
  await authorize('rollback');
  const first=await readState();checkLease(first.value,lease);
  const target=first.value.previous;
  if(lease.action!=='rollback'||!target||lease.generationId!==target.generationId)return fail('rollback_target');
  const saved=await readCut(target);
  if(!same(saved.source.cursor,target.cursor))return fail('rollback_cursor');
  await verifyPapers(saved);
  await authorize('rollback');
  const current=await readState(),v=current.value;checkLease(v,lease);
  if(!same(target,v.previous)||!v.active)return fail('rollback_target');
  const active:Ref={...target,activateRevision:revision(v.revision)};
  await cas(current,{...v,active,previous:v.active,lease:null},Math.min(lease.expiresAt,saved.source.validUntil,saved.pricing.validUntil));
  return {generationId:active.generationId,manifestSha256:active.manifestSha256};
 };
 const release=async(lease:Lease)=>{
  await authorize('release');
  const current=await readState();checkLease(current.value,lease);
  await cas(current,{...current.value,lease:null},lease.expiresAt);
 };
 const observe=async()=>{
  const {value:v}=await readState();
  return {baseSha256:base(v.active),cursor:structuredClone(v.active?.cursor??null),generationId:v.active?.generationId??null};
 };
 const read=async(role:Role)=>{
  if(!ROLES.includes(role))return fail('role');
  const {value:{active}}=await readState();
  if(!active)return {status:'unpublished' as const,market};
  // No writer lease checks. Read the selected market's active immutable paper.
  const cut=await readCut(active);
  if(!same(cut.source.cursor,active.cursor))return fail('active_cursor');
  const paper=await readPaper(cut,role);
  const {value:v}=await readState();
  if(base(v.active)!==base(active)||Date.now()>=Math.min(cut.source.validUntil,cut.pricing.validUntil))return fail('read_changed');
  return {status:'ready' as const,market,generationId:active.generationId,manifestSha256:active.manifestSha256,role,payload:paper.payload};
 };
 const openChinaPrepared=async()=>{
  if(market!=='china')return fail('china_scope');
  const {value:{active}}=await readState();
  if(!active)return null;
  const cut=await readCut(active);
  if(!cut.preparedChina)return null;
  if(!same(cut.source.cursor,active.cursor))return fail('active_cursor');
  const inventory=await readPaper(cut,'inventory'),prices=await readPaper(cut,'prices');
  const assertCurrent=async():Promise<void>=>{
   const {value:v}=await readState();
   if(base(v.active)!==base(active)||Date.now()>=Math.min(cut.source.validUntil,cut.pricing.validUntil))return fail('read_changed');
  };
  await assertCurrent();
  return {cut,inventory,prices,assertCurrent,read:(key:string,sha?:string)=>readChinaPrepared(cut.generationId,key,sha)};
 };
 return {market,observe,acquire,prepare,activate,rollback,release,read,chinaPreparation,openChinaPrepared};
}

export function openIndependentChinaStage(files:StageChinaFiles){
 return openIndependentChinaRuntimeRead(files,()=>assertStageChinaFiles(files),async()=>{});
}
export function openIndependentChinaRegcloud(files:ChinaStageObjectFiles){
 return openIndependentChinaRuntimeRead(files,()=>assertChinaStageObjectFiles(files),()=>files.assertPointer());
}
function openIndependentChinaRuntimeRead(files:StageChinaFiles|ChinaStageObjectFiles,assertOwned:()=>void,assertPointer:()=>Promise<void>){
 assertOwned();
 const readSide=openIndependentMarketBackend(files,'china',assertOwned,async()=>fail('readonly_backend'));
 return Object.freeze({
  market:'china' as const,observe:readSide.observe,
  async openChinaPrepared(){
   const scoped=await readSide.openChinaPrepared(),ready=files.ready;
   if(!scoped||scoped.cut.generationId!==ready.generationId||fingerprint(scoped.cut)!==ready.manifestSha256||
      scoped.cut.admitted.count!==ready.admittedRows||scoped.cut.pricing.receiptSha256!==ready.pricingReceiptSha256||
      Math.min(scoped.cut.source.validUntil,scoped.cut.pricing.validUntil)!==ready.validUntil)
    return fail('stage_readiness_binding');
   const search=await readSide.read('search');
   const marker=(scoped.prices.payload as {manifest?:{markets?:{china?:{preparedChinaPriceReadV1?:{directorySha256?:string}}}}})
    ?.manifest?.markets?.china?.preparedChinaPriceReadV1?.directorySha256;
   const paper=search.status==='ready'?search.payload as {directorySha256?:string;streamingSelector?:true}:null;
   if(search.status!=='ready'||search.generationId!==ready.generationId||search.manifestSha256!==ready.manifestSha256||
      !validSha(marker)||paper?.directorySha256!==marker||paper.streamingSelector!==true)return fail('stage_search_readiness');
   const assertCurrent=async()=>{await scoped.assertCurrent();await assertPointer();};
   await assertCurrent();return {...scoped,assertCurrent};
  },
 });
}

type Reader=Pick<ReturnType<typeof openIndependentMarketFixture>,'market'|'read'>;
/** Read-only fan-out. Callers can await/render each section independently; a
 * combined HTTP serializer that chooses Promise.all would be its own barrier. */
export function independentMarketFixtureSections(markets:readonly Reader[],role:Role){
 return new Map(markets.map(reader=>[reader.market,Promise.resolve().then(()=>reader.read(role)).catch(()=>({status:'unavailable' as const,market:reader.market}))]));
}

export type IndependentFixturePublication=ReturnType<typeof openIndependentMarketFixture>;
