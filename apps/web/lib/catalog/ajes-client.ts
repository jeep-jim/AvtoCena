import {ajesFailureSlot,type AjesRequestDiagnostic} from './ajes-request-diagnostic';
import type {CalculationIndex} from '../encyclopedia/calculation-index';
import type {JapanPowerQueryContext} from './japan-power-query';
import {japanVehicleExcluded} from './japan-vehicle-policy';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {gunzipSync} from 'node:zlib';
import {DetailReadCache} from './detail-read-cache';
import {ajesQuery,ajesLot,ajesSourceCacheSql,AjesInputError,type AjesTable,type AjesQuery} from './ajes-query';
import {AjesUnavailable,assertAjesJapanTable} from './ajes-access-policy';
import {beginAjesReadEvidence,finishAjesReadEvidence,ajesReadQueryIdentity,ajesReadReason,ajesCooldownOrigin,copyAjesResponseEvidence,AJES_RESPONSE_COLUMNS,AJES_RESPONSE_FUNCTIONS,type AjesReadEvidence,type AjesCooldownOrigin,type AjesResponseEvidence} from './ajes-read-evidence';

export {AjesUnavailable} from './ajes-access-policy';
// Release supplier admission before consulting historical
// storage. Shared callers recover once; stale results never enter the fresh cache.
class AjesSavedRecovery {
  private pending?:Promise<any>;
  constructor(private readonly load:()=>Promise<any>){}
  read(){return this.pending??=(this.load());}
}
// COUNT verification must start after the list releases supplier admission.
// It also stays outside visitor recovery admission: two empty lists must not
// block each other's count-failure recovery while occupying both queues.
class AjesEmptyValidation extends AjesSavedRecovery {}

function responsePrefixClass(prefix:Uint8Array,mime:AjesResponseEvidence['mime']):Pick<AjesResponseEvidence,'bodyClass'|'identifier'> {
 if(!prefix.length)return {bodyClass:'empty'};
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(prefix);}catch{return {bodyClass:'binary_unclassified'};}
 if(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text))return {bodyClass:'binary_unclassified'};
 const refusal=text.match(/^\s*(bot|ban)\d*(?:\s|$)/i);
 if(refusal)return {bodyClass:refusal[1].toLowerCase()==='bot'?'bot_refusal':'ban_refusal'};
 const columnMatches=[...text.matchAll(/\bUnknown column\s+(['"`])([^'"`\r\n]{1,128})\1(?=\s|$)/gi)].map(match=>match[2].toLowerCase());
 if(columnMatches.length||/\bSQLSTATE\[42S22\]/i.test(text)){
  const names=[...new Set(columnMatches)],identifier=names.length===1&&(AJES_RESPONSE_COLUMNS as readonly string[]).includes(names[0])?names[0] as typeof AJES_RESPONSE_COLUMNS[number]:undefined;
  return {bodyClass:'sql_unknown_column',...(identifier?{identifier}:{})};
 }
 const functionPatterns=[/\bFUNCTION\s+(['"`]?)([^\s'"`]{1,128})\1\s+does not exist\b/gi,
  /\b(?:unknown|unsupported) function\s+(['"`])([^'"`\r\n]{1,128})\1(?=\s|$)/gi,
  /\bno such function:\s*(['"`]?)([^\s'"`]{1,128})\1(?=\s|$)/gi];
 const functionMatches=functionPatterns.flatMap(pattern=>[...text.matchAll(pattern)].map(match=>match[2].toLowerCase()));
 if(functionMatches.length){
  const names=[...new Set(functionMatches)],identifier=names.length===1&&(AJES_RESPONSE_FUNCTIONS as readonly string[]).includes(names[0])?names[0] as typeof AJES_RESPONSE_FUNCTIONS[number]:undefined;
  return {bodyClass:'sql_unsupported_function',...(identifier?{identifier}:{})};
 }
 if(/\byou have an error in your SQL syntax\b|\bSQLSTATE\[42000\]:\s*Syntax error or access violation:\s*1064\b|\bsyntax error at or near\s+['"]/i.test(text))return {bodyClass:'sql_syntax'};
 return {bodyClass:mime==='json'||/^\s*[\[{]/.test(text)?'json_unclassified':mime==='html'||/^\s*(?:<!doctype\s+html|<html\b)/i.test(text)?'html_unclassified':'text_unclassified'};
}

/** Observe only the failed response already obtained by this request. The
 * retained prefix, read count and elapsed time are independently bounded.
 * Cancellation is best-effort and never awaited: even a broken stream cleanup
 * cannot replace or delay the original HTTP failure indefinitely. */
export async function readAjesNon2xxResponseEvidence(response:Response,signal:AbortSignal,sourceDeadline=Infinity):Promise<AjesResponseEvidence|undefined> {
 const observationDeadline=performance.now()+250,deadline=Math.min(observationDeadline,sourceDeadline),prefix=new Uint8Array(4096);
 // Check the original clock budget directly too: a hot microtask stream can
 // otherwise delay delivery of the existing source abort timer.
 const deadlineStatus=sourceDeadline<=observationDeadline?'aborted':'timeout';
 let bytesRead=0,reads=0,mime:AjesResponseEvidence['mime']='missing',encoding:AjesResponseEvidence['encoding']='missing';
 let readStatus:AjesResponseEvidence['readStatus']='read_error',truncated=true,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
 let timer:ReturnType<typeof setTimeout>|undefined,stopped:'timeout'|'aborted'|undefined,resolveStop!:(value:{stop:'timeout'|'aborted'})=>void;
 const stoppedRead=new Promise<{stop:'timeout'|'aborted'}>(resolve=>{resolveStop=resolve;});
 const stop=(value:'timeout'|'aborted')=>{if(!stopped){stopped=value;resolveStop({stop:value});}};
 const abort=()=>stop('aborted');
 try{
  const type=response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase();
  mime=!type?'missing':type==='application/json'||/^application\/[a-z0-9.+-]+\+json$/.test(type)?'json':type==='text/html'?'html':type.startsWith('text/')?'text':'other';
  const declaredEncoding=response.headers.get('content-encoding')?.trim().toLowerCase();
  encoding=!declaredEncoding?'missing':declaredEncoding==='identity'?'identity':declaredEncoding==='gzip'?'gzip':'other';
  signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted)abort();
  timer=setTimeout(()=>stop(deadlineStatus),Math.max(0,deadline-performance.now()));
  reader=response.body?.getReader();
  if(stopped)readStatus=stopped;
  else if(!reader){readStatus='no_body';truncated=false;}
  else while(true){
   if(stopped||performance.now()>=deadline){readStatus=stopped||deadlineStatus;break;}
   if(reads++>=4096){readStatus='chunk_limit';break;}
   const next=await Promise.race([reader.read().then(value=>({value}),()=>({error:true as const})),stoppedRead]);
   if('stop' in next){readStatus=next.stop;break;}
   if(stopped||performance.now()>=deadline){readStatus=stopped||deadlineStatus;break;}
   if('error' in next){readStatus=signal.aborted?'aborted':'read_error';break;}
   if(next.value.done){readStatus='complete';truncated=false;break;}
   const chunk=next.value.value;if(!(chunk instanceof Uint8Array)){readStatus='read_error';break;}
   const length=Math.min(prefix.length-bytesRead,chunk.byteLength);
   prefix.set(chunk.subarray(0,length),bytesRead);bytesRead+=length;
   if(bytesRead===prefix.length){readStatus='limit';break;}
  }
 }catch{readStatus=signal.aborted?'aborted':'read_error';}
 finally{
  if(timer!==undefined)clearTimeout(timer);
  signal.removeEventListener('abort',abort);
  if(reader){
   if(readStatus!=='complete')try{void reader.cancel().catch(()=>{});}catch{}
   try{reader.releaseLock();}catch{}
  }else try{void response.body?.cancel().catch(()=>{});}catch{}
 }
 try{
  const observed=responsePrefixClass(prefix.subarray(0,bytesRead),mime);
  // A prefix cannot prove that an identifier ends beyond its retained boundary.
  if(truncated)delete observed.identifier;
  return copyAjesResponseEvidence({version:1,mime,encoding,...observed,bytesRead,truncated,readStatus});
 }catch{return undefined;}
}
const sourceTtlMs=30*60*1000;
const sqlHash=(sql:string)=>createHash('sha256').update(sql).digest('hex');
const needsEmptyProof=(value:any)=>value?.page===1&&Array.isArray(value.makes)&&value.makes.length===0
  ||value?.schemaVersion===2&&Array.isArray(value.items)&&value.items.length===0&&!(Number.isSafeInteger(value.received)&&value.received>0);
function verifiedEmptyPage(value:any,sourceSql?:string,countSql?:string,fresh=true){
  const proof=value?.emptyPageEvidence,now=Date.now();
  const sourceTime=Date.parse(value?.observedAt||''),countTime=Date.parse(proof?.countObservedAt||'');
  const sourceAge=now-sourceTime,countAge=now-countTime;
  return value?.received===0&&value?.rejected===0&&Array.isArray(value.items)&&value.items.length===0
    &&(value.makes===undefined||Array.isArray(value.makes)&&value.makes.length===0&&value.page===1)
    &&proof?.version===1&&proof.sourceObservedAt===value.observedAt&&proof.page===value.page&&proof.pageSize===value.pageSize
    &&Number.isSafeInteger(value.page)&&value.page>=1&&Number.isSafeInteger(value.pageSize)&&value.pageSize>=1
    &&Number.isSafeInteger(proof.countTotal)&&proof.countTotal>=0&&proof.countTotal<=(value.page-1)*value.pageSize
    &&/^[a-f0-9]{64}$/.test(proof.sourceQueryHash||'')&&/^[a-f0-9]{64}$/.test(proof.countQueryHash||'')
    &&(!sourceSql||proof.sourceQueryHash===sqlHash(sourceSql))&&(!countSql||proof.countQueryHash===sqlHash(countSql))
    &&Number.isFinite(sourceTime)&&Number.isFinite(countTime)&&Math.abs(sourceTime-countTime)<sourceTtlMs
    &&sourceAge>=0&&countAge>=0&&(!fresh||sourceAge<sourceTtlMs&&countAge<sourceTtlMs);
}
type Dependencies={saveRequestFailure?:(value:AjesRequestDiagnostic)=>Promise<unknown>;calculationIndex?:()=>CalculationIndex|null;password:()=>string|undefined|Promise<string|undefined>; assertEnabled:(table?:AjesTable)=>Promise<void>; reserve:(table:AjesTable,kind?:string)=>Promise<void>; fetcher?:typeof fetch; endpoint?:(ip:string)=>string|Promise<string>; saveEvidence?:(table:AjesTable,value:any)=>Promise<void>; saveAggregateEvidence?:(kind:string,value:any)=>Promise<void>; readQuery?:(sql:string)=>Promise<any|null>; readLegacyQuery?:(sql:string)=>Promise<any|null>; saveQuery?:(sql:string,value:any)=>Promise<void>; readDetail?:(table:AjesTable,id:string)=>Promise<any|null>; readSavedSearch?:(input:AjesQuery)=>Promise<any|null>; readListedDetail?:(table:AjesTable,id:string)=>Promise<any|null>; saveDetail?:(table:AjesTable,id:string,value:any)=>Promise<void>};
export function createAjesClient(deps:Dependencies) {
  // Only fresh successful results can be reused across visitor addresses.
  // A slow detail may use one slot; lists and filter directories retain the other.
  // Keep the total supplier concurrency at two, including all request kinds.
  // A queued detail may wait for the preceding 45-second read instead of failing
  // at the ordinary five-second queue deadline solely due to serialization.
  const sourceExpiry=(value:any)=>Math.min(Date.parse(value?.observedAt||'')+sourceTtlMs,value?.emptyPageEvidence?Date.parse(value.emptyPageEvidence.countObservedAt||'')+sourceTtlMs:Infinity);
  const cache=new DetailReadCache<any>({maxEntries:300,maxBytes:8*1024*1024,ttlMs:30*60*1000,expiresAt:sourceExpiry,concurrency:2,groupConcurrency:{detail:1},groupQueueTimeoutMs:{detail:50_000},shouldCache:value=>!value.stale&&!value.partial});
  // Stored recovery has its own bounded queue. It must neither occupy supplier
  // admission nor promote a visitor's stale result into the shared fresh cache.
  // Inspect exact already requested lists and metadata, never detail responses.
  // Separate bounded storage admission: a ready saved list must not wait
  // for two unrelated supplier requests. Names/counts have the same existing
  // observation deadline. No new shared TTL, source admission or feed crawl.
  const preparedReads=new DetailReadCache<any>({maxEntries:300,maxBytes:8*1024*1024,ttlMs:30*60*1000,expiresAt:sourceExpiry,concurrency:2,maxQueued:32,queueTimeoutMs:5000,shouldCache:value=>{
    const age=Date.now()-Date.parse(value?.observedAt||'');
    const supported=value?.schemaVersion===2||Array.isArray(value?.makes)||Array.isArray(value?.models)||Array.isArray(value?.colors)||Number.isSafeInteger(value?.total);
    return supported&&!value.stale&&!value.partial&&age>=0&&age<sourceTtlMs&&(!needsEmptyProof(value)||verifiedEmptyPage(value));
  }});
  // Memoization avoids repeated object-store reads. Every reuse below
  // still checks observedAt; memory residence never extends freshness.
  const visitorCache=new DetailReadCache<any>({maxEntries:300,maxBytes:8*1024*1024,ttlMs:30*1000,concurrency:2});
  // Persistence is a best-effort cache of requested responses, not the supplier
  // transaction. A slow storage write must not delay ready cars or hold the two
  // supplier slots. Bound both concurrent writes and retained waiting payloads.
  const persistence=new DetailReadCache<null>({maxEntries:1,maxBytes:1,ttlMs:0,concurrency:2,maxQueued:16,queueTimeoutMs:5000,shouldCache:()=>false});
  let persistenceSequence=0,persistenceWarningAt=0;
  const lastFailureSaved=new Map<string,number>();
  const persist=(save:()=>Promise<unknown>)=>{void persistence.get(String(++persistenceSequence),async()=>{await save();return null;}).catch(()=>{
    if(Date.now()-persistenceWarningAt>=60000){persistenceWarningAt=Date.now();console.warn('AJES_PERSISTENCE_UNAVAILABLE');}
  });};
  // Bounded snapshots of rows the visitor already saw, not fabricated full details.
  const listed=new Map<string,{value:any;bytes:number}>();let listedBytes=0;
  const failures=new Map<string,{reason:string;until:number;origin?:AjesCooldownOrigin}>();
  // Only exact-query proof metadata, with the same 300-entry bound as source
  // caches. A newer real page lifts the empty barrier, while older visitor or
  // in-flight recovery snapshots cannot resurrect rows already disproved.
  const emptyBarriers=new Map<string,{proof:any;supersededAt?:number}>();
  const remember=(value:any)=>{
    for(const lot of value.items||[]){
      const key=lot.table+':'+lot.id,snapshot={schemaVersion:value.schemaVersion,items:[lot],page:1,pageSize:1,observedAt:value.observedAt,partial:true,stale:Boolean(value.stale)};
      const bytes=Buffer.byteLength(JSON.stringify(snapshot));if(bytes>64*1024)continue;
      listedBytes-=listed.get(key)?.bytes||0;listed.delete(key);listed.set(key,{value:snapshot,bytes});listedBytes+=bytes;
      while(listed.size>600||listedBytes>4*1024*1024){const oldest=listed.keys().next().value!;listedBytes-=listed.get(oldest)!.bytes;listed.delete(oldest);}
    }
    return value;
  };
  const coolingRecord=(key:string)=>{const value=failures.get(key);if(value&&value.until>Date.now())return value;failures.delete(key);return null;};
  const cooling=(key:string)=>coolingRecord(key)?.reason??null;
    async function read(input:unknown,clientIp:string,compiledQuery?:ReturnType<typeof ajesQuery>,powerContext?:JapanPowerQueryContext,evidence?:AjesReadEvidence):Promise<any> {
      // Retired tables cannot read caches, credentials, quota or the supplier,
      // even when an old link or saved owner setting still requests them.
      assertAjesJapanTable(input&&typeof input==='object'?(input as AjesQuery).table:undefined);
      const calculationIndex=powerContext?powerContext.snapshot.index:compiledQuery?null:deps.calculationIndex?.()||null;
      const query=compiledQuery??ajesQuery(input,calculationIndex,powerContext);
      const cacheSql=ajesSourceCacheSql(query.sql);
      if(evidence)evidence.query=ajesReadQueryIdentity(query,cacheSql);
      // An empty first make page also requires inventory COUNT0. Later make
      // offsets count groups, so offer COUNT must never validate those offsets.
      const verifyEmpty=query.kind==='list'||query.kind==='makes'&&query.page===1;
      const sourceKey=verifyEmpty?sqlHash(cacheSql):'';
      // Capture the same local query facts now; a later index refresh must not
      // change the WHERE used to verify this exact source selection.
      const countInput=verifyEmpty?{...(input as AjesQuery),aggregate:'count' as const}:null;
      const countQuery=countInput?ajesQuery(countInput,calculationIndex,powerContext):null;
      const countSql=countQuery?ajesSourceCacheSql(countQuery.sql):'';
      if(!isIP(clientIp)) throw new AjesUnavailable('client_ip_missing');
      await deps.assertEnabled(query.table); // Also applies to cache hits after an owner disables the source.
      const password=await deps.password();
      if(!password)throw new AjesUnavailable('not_configured');
      // A valid year interval outside admission policy is known empty, not a failure.
      // Retain visitor and owner-switch checks even when no supplier request is needed.
      if(query.kind!=='detail'&&query.empty){if(evidence)evidence.disposition='policy_empty';return {schemaVersion:2,items:[],total:0,colors:query.kind==='colors'?[]:undefined,models:query.kind==='models'?[]:undefined,makes:query.kind==='makes'?[]:undefined,page:query.page,pageSize:query.pageSize,received:0,rejected:0,stale:false,observedAt:new Date().toISOString()};}
      const visitorKey=clientIp+"\0"+cacheSql;
      const quotaKey='quota:'+query.table+((query.kind==='count'||query.kind==='makes')?':count':'');
      const isUsable=(saved:any)=>{const age=Date.now()-Date.parse(saved?.observedAt||'');return age>=0&&age<7*24*60*60*1000&&Array.isArray(saved?.items)&&saved.items.length<=query.pageSize
          &&saved.page===query.page&&saved.pageSize===query.pageSize
          &&(query.kind==='count'?Number.isSafeInteger(saved.total)&&saved.total>=0:query.kind==='colors'?Array.isArray(saved.colors):query.kind==='makes'?Array.isArray(saved.makes):query.kind==='models'?Array.isArray(saved.models):saved.items.every((lot:any)=>lot?.table===query.table&&typeof lot.id==='string'))
          &&(query.kind!=='detail'||(saved.items.length===1&&saved.items[0].id===query.id));};
      const proofTime=(proof:any)=>Math.max(Date.parse(proof.sourceObservedAt),Date.parse(proof.countObservedAt));
      const barrier=()=>{const value=emptyBarriers.get(sourceKey);if(value&&Date.now()-Date.parse(value.proof.sourceObservedAt)>=7*86400000){emptyBarriers.delete(sourceKey);return undefined;}return value;};
      const beforeBarrier=(value:any)=>{
        const known=barrier();if(!known)return false;
        if(verifiedEmptyPage(value,cacheSql,countSql,false))return Boolean(known.supersededAt)||proofTime(value.emptyPageEvidence)<proofTime(known.proof);
        return !(Date.parse(value?.observedAt||'')>proofTime(known.proof));
      };
      const rememberEmpty=(value:any)=>{
        if(!verifyEmpty||!isUsable(value)||value.stale||value.partial||!verifiedEmptyPage(value,cacheSql,countSql,false))return;
        const proof=value.emptyPageEvidence,known=barrier(),at=proofTime(proof);
        if(known&&(proofTime(known.proof)>=at||(known.supersededAt??0)>=at))return;
        const current=cache.peekFresh(cacheSql);
        if(current?.received>0&&!current.stale&&!current.partial&&Date.parse(current.observedAt)>at)return;
        emptyBarriers.delete(sourceKey);emptyBarriers.set(sourceKey,{proof});
        while(emptyBarriers.size>300)emptyBarriers.delete(emptyBarriers.keys().next().value!);
        cache.invalidate(cacheSql);preparedReads.invalidate(cacheSql);visitorCache.invalidate(visitorKey);
      };
      const observeRows=(value:any)=>{
        const known=barrier(),observedAt=Date.parse(value?.observedAt||'');
        if(known&&isUsable(value)&&value.received>0&&!value.stale&&!value.partial&&observedAt>proofTime(known.proof)&&(known.supersededAt??0)<observedAt){
          known.supersededAt=observedAt;preparedReads.invalidate(cacheSql);visitorCache.invalidate(visitorKey);
          const current=cache.peekFresh(cacheSql);if(current&&beforeBarrier(current))cache.invalidate(cacheSql);
        }
      };
      const latestFresh=()=>{
        const current=cache.peekFresh(cacheSql);
        if(current!==undefined){if(!beforeBarrier(current)){observeRows(current);return current;}cache.invalidate(cacheSql);}
        const known=barrier();if(!known||known.supersededAt)return undefined;
        const value={...(query.kind==='makes'?{makes:[]}:{schemaVersion:2}),items:[],page:query.page,pageSize:query.pageSize,received:0,rejected:0,stale:false,observedAt:known.proof.sourceObservedAt,emptyPageEvidence:known.proof};
        return verifiedEmptyPage(value,cacheSql,countSql)?value:undefined;
      };
      const recoveredList=async(value:any)=>{
        await deps.assertEnabled(query.table);
        const latest=latestFresh();if(latest!==undefined)return remember(latest);
        if(isUsable(value)&&(query.kind==='makes'?value.makes.length:value.items.length)&&!beforeBarrier(value))return remember({...value,stale:true});
        return null;
      };
      const listFallback=async(saved:any)=>{
        const current=await recoveredList(saved);if(current)return current;
        // A proven empty remains a barrier after its freshness expires. A
        // refusal cannot resurrect pre-zero exact, legacy or partial rows.
        const known=barrier();if(known&&!known.supersededAt)return null;
        const usable=isUsable(saved);
        if((!usable||!saved.items.length)&&deps.readLegacyQuery){
          let fallback:any=null;try{fallback=await deps.readLegacyQuery(query.sql);}catch{}
          const recovered=await recoveredList(fallback);if(recovered)return recovered;
        }
        if(query.page===1&&deps.readSavedSearch){
          let fallback:any=null;try{fallback=await deps.readSavedSearch(input as AjesQuery);}catch{}
          if(fallback?.partial){const recovered=await recoveredList(fallback);if(recovered)return recovered;}
        }
        return null;
      };
      // Detail responses keep their separate identity-bound cache path.
      const inspectPrepared=query.kind!=='detail';
      const inMemory=inspectPrepared?latestFresh():undefined;
      if(inMemory!==undefined){if(evidence)evidence.disposition='memory_cache';return inMemory;}
      // Reuse only this visitor's already recovered result while the original
      // refusal cooldown is active. Looking it up after queue/storage work made
      // the 30-second recovery cache ineffective at protecting repeat visits.
      // peekFresh never renews its deadline; a new shared success above wins.
      const recovered=inspectPrepared?visitorCache.peekFresh(visitorKey):undefined;
      const recoveredRefusal=recovered?.stale&&isUsable(recovered)&&!beforeBarrier(recovered)?coolingRecord(quotaKey)||coolingRecord('visitor:'+clientIp)||coolingRecord(visitorKey):null;
      if(recoveredRefusal){
        await deps.assertEnabled(query.table);
        if(evidence){evidence.disposition='cooldown_recovery';evidence.reason=ajesReadReason(recoveredRefusal.reason);evidence.cooldownOrigin=recoveredRefusal.origin;}
        return recovered;
      }
      const freshPrepared=(value:any)=>{
        const age=Date.now()-Date.parse(value?.observedAt||'');
        const schema=['count','models','makes','colors'].includes(query.kind)||value?.schemaVersion===2;
        return isUsable(value)&&schema&&!value.stale&&!value.partial&&age<sourceTtlMs&&!beforeBarrier(value)
          &&(!verifyEmpty||!needsEmptyProof(value)||verifiedEmptyPage(value,cacheSql,countSql));
      };
      let prepared:any=null;
      if(inspectPrepared&&deps.readQuery){
        prepared=await preparedReads.get(cacheSql,async()=>{
          const canonical=await deps.readQuery!(cacheSql);
          if(cacheSql===query.sql||freshPrepared(canonical))return canonical;
          // Read the previous compact-key cache only when the shared key has no
          // fresh result. Both keys denote exactly the same unfiltered raw rows.
          const original=await deps.readQuery!(query.sql);
          if(freshPrepared(original))return original;
          return isUsable(original)&&(!isUsable(canonical)||Date.parse(original.observedAt)>Date.parse(canonical.observedAt))?original:canonical;
        },cacheSql,'prepared').catch(()=>null);
      }
      rememberEmpty(prepared);observeRows(prepared);
      if(inspectPrepared&&freshPrepared(prepared)){
        await deps.assertEnabled(query.table);
        const latest=latestFresh();if(latest!==undefined){if(evidence)evidence.disposition='memory_cache';return latest;}
        if(freshPrepared(prepared)){if(evidence)evidence.disposition='saved_cache';return query.kind==='list'?remember({...prepared,stale:false}):{...prepared,stale:false};}
      }
      if(evidence)evidence.enteredSourceCache=true;
      return cache.get(cacheSql,async()=>{
        if(evidence)evidence.loaderStarted=true;
        await deps.assertEnabled(query.table); // Recheck after waiting for concurrency slot.
        // Only successful, user-requested responses are retained; never crawl the database.
        let saved:any=prepared;
        if(!inspectPrepared)try {saved=await deps.readDetail?.(query.table,query.id!);}catch{}
        const usable=isUsable(saved);
        if(freshPrepared(saved)){if(evidence)evidence.disposition='saved_cache';return query.kind==='list'?remember({...saved,stale:false}):{...saved,stale:false};}
        const url=new URL(await deps.endpoint?.(clientIp)||'http://87.242.72.57/api/');
        url.search=new URLSearchParams({ip:clientIp,json:'',code:password,sql:query.sql}).toString();
        let requestStarted=false,httpStatus:number|null=null,providerCode:string|null=null;
        let attemptStartedAt:string|null=null,attemptFinishedAt:string|null=null;
        const finishAttempt=()=>{if(attemptStartedAt&&!attemptFinishedAt)attemptFinishedAt=new Date().toISOString();if(evidence?.attempt)evidence.attempt.finishedAt=attemptFinishedAt;};
        const startedAt=new Date().toISOString();
        const controller=new AbortController();
        const recordFailure=(failure:AjesUnavailable)=>{
          // Throttle fixed page/kind slots independently; never retain a body.
          const failureSlot=ajesFailureSlot(query);
          if(requestStarted&&deps.saveRequestFailure&&Date.now()-(lastFailureSaved.get(failureSlot)??0)>=60000){
            lastFailureSaved.set(failureSlot,Date.now());
            const diagnostic:AjesRequestDiagnostic={table:query.table,kind:query.kind,page:query.page,pageSize:query.pageSize,startedAt,finishedAt:new Date().toISOString(),clientIp,sql:query.sql,endpoint:url.origin+url.pathname,httpStatus,providerCode,outcome:failure.reason};
            if(Buffer.byteLength(JSON.stringify(diagnostic))<=64*1024)persist(()=>deps.saveRequestFailure!(diagnostic));
          }
        };
        const deferEmpty=(result:any)=>new AjesEmptyValidation(async()=>{
          if(evidence)evidence.emptyValidation=true;
          let failure:AjesUnavailable;
          try{
            const count=await read(countInput!,clientIp,countQuery!,powerContext);
            const countAge=Date.now()-Date.parse(count?.observedAt||'');
            if(count.stale||count.partial||count.upperBound||!Number.isSafeInteger(count.total)||count.total<0
              ||countAge<0||countAge>=sourceTtlMs||count.total>(query.page-1)*query.pageSize)throw new AjesUnavailable('empty_response');
            const verified={...result,emptyPageEvidence:{version:1,sourceQueryHash:sqlHash(cacheSql),countQueryHash:sqlHash(countSql),page:query.page,pageSize:query.pageSize,sourceObservedAt:result.observedAt,countObservedAt:count.observedAt,countTotal:count.total}};
            if(!verifiedEmptyPage(verified,cacheSql,countSql))throw new AjesUnavailable('empty_response');
            await deps.assertEnabled(query.table);
            rememberEmpty(verified);
            // No supplier request here. Its bounded cache stores only the
            // verified result and expires at the older source observation.
            return await cache.get(cacheSql,async()=>{
              await deps.assertEnabled(query.table);
              if(!verifiedEmptyPage(verified,cacheSql,countSql))throw new AjesUnavailable('empty_response');
              if(deps.saveQuery)persist(()=>deps.saveQuery!(cacheSql,verified));
              return verified;
            },visitorKey);
          }catch(error){failure=error instanceof AjesUnavailable?error:new AjesUnavailable('empty_response');}
          if(evidence){evidence.recovery=true;evidence.reason=ajesReadReason(failure.reason);}
          await deps.assertEnabled(query.table);
          const key=failure.reason==='visitor_restricted'?'visitor:'+clientIp:visitorKey;
          if(!cooling(key))failures.set(key,{reason:failure.reason,until:Date.now()+(failure.reason==='visitor_restricted'?300000:30000)});
          while(failures.size>500)failures.delete(failures.keys().next().value!);
          recordFailure(failure);
          // A failed COUNT preserves the previous useful exact response,
          // explicitly stale. It cannot replace it with zero cars or makes.
          return visitorCache.get(visitorKey,async()=>{const fallback=query.kind==='list'?await listFallback(saved):await recoveredList(saved);if(fallback)return fallback;throw failure;});
        });
        // Power is a local selection over the same requested raw page. It uses
        // the ordinary source deadline, not a shorter deadline that discards
        // otherwise valid responses and unnecessarily falls back to old rows.
        const sourceDeadline=performance.now()+20000;
        const timer=setTimeout(()=>controller.abort(),20000);
        try {
          const cooldown=coolingRecord(quotaKey)||coolingRecord('visitor:'+clientIp)||coolingRecord(visitorKey);
          if(cooldown){if(evidence){evidence.disposition='cooldown_recovery';evidence.reason=ajesReadReason(cooldown.reason);evidence.cooldownOrigin=cooldown.origin;}throw new AjesUnavailable(cooldown.reason);}
          await deps.reserve(query.table,query.kind);
          requestStarted=true;
          attemptStartedAt=new Date().toISOString();if(evidence)evidence.attempt={startedAt:attemptStartedAt,finishedAt:null,httpStatus:null};
          const response=await (deps.fetcher??fetch)(url,{signal:controller.signal,redirect:'error',cache:'no-store'});
          httpStatus=response.status;
          if(evidence?.attempt)evidence.attempt.httpStatus=httpStatus;
          if(!response.ok){
            // Keep HTTP status, recovery and cooldown semantics unchanged.
            // A diagnostic failure must never replace the original refusal.
            try{const observed=await readAjesNon2xxResponseEvidence(response,controller.signal,sourceDeadline);if(observed&&evidence?.attempt)evidence.attempt.responseEvidence=observed;}catch{}
            throw new AjesUnavailable(response.status===414?'query_too_large':`http_${response.status}`);
          }
          if(Number(response.headers.get('content-length'))>2*1024*1024)throw new AjesUnavailable('response_too_large');
          const reader=response.body?.getReader();
          if(!reader)throw new AjesUnavailable('empty_response');
          const chunks:Uint8Array[]=[];let bytes=0;
          while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024){await reader.cancel();throw new AjesUnavailable('response_too_large');}chunks.push(value);}
          let rows:unknown;
          try{
            const body=Buffer.concat(chunks);
            // Node fetch usually decompresses Content-Encoding automatically. The
            // provider can also return a gzip body without that header: inspect magic.
            const decoded=body[0]===0x1f&&body[1]===0x8b?gunzipSync(body,{maxOutputLength:2*1024*1024}):body;
            // The provider returns a short plaintext bot refusal containing the
            // API password for some visitor addresses. Classify it without ever
            // retaining/logging its contents or replacing the visitor address.
            const refusal=decoded.length<=256?decoded.toString('utf8').match(/^\s*((?:bot|ban)\d*)(?:\s|$)/i):null;
            if(refusal){providerCode=refusal[1].length<=16?refusal[1].toLowerCase():null;throw new AjesUnavailable('visitor_restricted');}
            rows=JSON.parse(decoded.toString('utf8'));
          }catch(error){if(error instanceof AjesUnavailable)throw error;throw new AjesUnavailable('invalid_response');}
          if(query.kind==='count'||query.kind==='models'||query.kind==='makes'||query.kind==='colors'){
            const first=Array.isArray(rows)?rows[0]:rows;
            const aggregateEvidence={observedAt:new Date().toISOString(),array:Array.isArray(rows),length:Array.isArray(rows)?rows.length:null,fields:first&&typeof first==='object'?Object.keys(first).slice(0,30):[],numeric:first&&typeof first==='object'?Object.fromEntries(Object.entries(first).filter(([k,v])=>/^(?:total|count(?:\(\*\))?|tag[012])$/i.test(k)&&/^\d+$/.test(String(v)))):{}};
            if(deps.saveAggregateEvidence)persist(()=>deps.saveAggregateEvidence!(query.kind,aggregateEvidence));
          }
          if(!Array.isArray(rows)||rows.length>query.pageSize||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw new AjesUnavailable('invalid_response');
          if(query.kind==='detail'&&rows.some(r=>r.ID!==query.id))throw new AjesUnavailable('identity_mismatch');
          if(query.kind==='count'||query.kind==='models'||query.kind==='makes'||query.kind==='colors'){
            const totalOf=(r:any)=>{const match=Object.entries(r).find(([key])=>['total','count(*)','count',query.kind==='count'?'tag0':(query.kind==='makes'||query.kind==='colors')?'tag1':'tag2'].includes(key.toLowerCase().replace(/\s/g,'')));const value=match?.[1];if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw new AjesUnavailable('invalid_response');return Number(value);};
            if(query.kind==='count'&&rows.length!==1)throw new AjesUnavailable('invalid_response');
            const models=query.kind==='models'?rows.map(r=>({make:String(r.MARKA_NAME??r.marka_name??'').trim(),model:String(r.MODEL_NAME??r.model_name??'').trim(),total:totalOf(r)})).filter(r=>r.make&&r.model):undefined;
            const makes=query.kind==='makes'?rows.map(r=>({make:String(r.MARKA_NAME??r.marka_name??'').trim(),total:totalOf(r)})):undefined;
            if(makes?.some(m=>!m.make))throw new AjesUnavailable('invalid_response');
            const colors=query.kind==='colors'?rows.map(r=>({color:String(r.COLOR??r.color??'').trim(),total:totalOf(r)})).filter(r=>r.color):undefined;
            const result={items:[],models,makes,colors,total:query.kind==='count'?totalOf(rows[0]):undefined,page:query.page,pageSize:query.pageSize,received:rows.length,rejected:0,stale:false,observedAt:new Date().toISOString()};
            if(query.kind==='makes'&&query.page===1&&rows.length===0)throw deferEmpty(result);
            if(query.kind==='makes')observeRows(result);
            if(deps.saveQuery)persist(()=>deps.saveQuery!(cacheSql,result));
            return result;
          }
          const items=rows.map(r=>ajesLot(r,query.table,query.kind==='detail')).filter(Boolean);
          const result={schemaVersion:2,stale:false,items,page:query.page,pageSize:query.pageSize,received:rows.length,rejected:rows.length-items.length,observedAt:new Date().toISOString(),
            quota:{counter:quotaNumber(response.headers.get('api-counter')),limit:quotaNumber(response.headers.get('api-limit')),remaining:quotaNumber(response.headers.get('api-rest'))}};
          if(query.kind==='list'&&rows.length===0){
            // An empty wire array is not proof of inventory exhaustion. Do not
            // overwrite useful saved rows or share this as a fresh success.
            throw deferEmpty(result);
          }
          if(query.kind==='detail'&&items.length===1){
            const row=rows[0];
            const evidence={id:query.id,observedAt:result.observedAt,fields:Object.keys(row),values:Object.fromEntries(['ENG_V','PW','TIME','FUEL','PRIV','KPP','INFO'].map(key=>[key,row[key]??null]))};
            // Retain a bounded, identity-bound diagnostic alongside this exact detail.
            // No visitor IP, request URL, password, INFO or frame number is copied.
            const sourceEvidence={id:query.id,observedAt:result.observedAt,fields:['ENG_V','PW','TIME','FUEL'].filter(key=>Object.prototype.hasOwnProperty.call(row,key)),values:Object.fromEntries(['ENG_V','PW','TIME','FUEL'].map(key=>[key,row[key]??null]))};
            if(Buffer.byteLength(JSON.stringify(sourceEvidence))<=4096)(result as any).sourceEvidence=sourceEvidence;
            if(deps.saveEvidence&&Buffer.byteLength(JSON.stringify(evidence))<=64*1024)persist(()=>deps.saveEvidence!(query.table,evidence));
          }
          if(query.kind==='list'){
            observeRows(result);
            const accepted=new Set(items.map((lot:any)=>lot.id));
            const sourceEvidenceById=Object.fromEntries(rows.filter(row=>accepted.has(row.ID)).map(row=>[row.ID,{id:row.ID,observedAt:result.observedAt,fields:['ENG_V','PW','TIME','FUEL'].filter(key=>Object.prototype.hasOwnProperty.call(row,key)),values:Object.fromEntries(['ENG_V','PW','TIME','FUEL'].map(key=>[key,row[key]??null]))}]));
            if(Buffer.byteLength(JSON.stringify(sourceEvidenceById))<=32*1024)(result as any).sourceEvidenceById=sourceEvidenceById;
          }
          // A cache storage outage must not discard a successful provider response.
          if(query.kind==='detail'&&items.length===1&&deps.saveDetail)persist(()=>deps.saveDetail!(query.table,query.id!,result));
          if(query.kind==='list'&&deps.saveQuery)persist(()=>deps.saveQuery!(cacheSql,result));

          return query.kind==='list'?remember(result):result;
        }catch(error){
          if(error instanceof AjesEmptyValidation)throw error;
          // Never propagate URLs, provider bodies, credentials or nested fetch causes to logs.
          const code=(error as any)?.cause?.code;
          const failure=error instanceof AjesUnavailable?error:new AjesUnavailable(controller.signal.aborted?'request_timeout':code==='UND_ERR_CONNECT_TIMEOUT'?'connect_timeout':'request_failed');
          const recoverable=!(error instanceof AjesUnavailable)||['visitor_restricted','request_failed','request_timeout','connect_timeout','quota_exhausted','quota_busy','invalid_response','empty_response','query_too_large'].includes(error.reason)||/^http_(429|5\d\d)$/.test(error.reason);
          finishAttempt();
          if(evidence){evidence.reason=ajesReadReason(failure.reason);evidence.recovery=recoverable;}
          if(recoverable){
            const key=failure.reason==='quota_exhausted'?quotaKey:failure.reason==='visitor_restricted'?'visitor:'+clientIp:visitorKey;
            // Native network/abort errors need the same visitor-local cooldown;
            // otherwise every power toggle repeats the failed source request.
            // Do not extend an existing cooldown when merely reading the cached failure.
            if(!cooling(key)){
              const origin=attemptStartedAt&&attemptFinishedAt?ajesCooldownOrigin(query,cacheSql,{startedAt:attemptStartedAt,finishedAt:attemptFinishedAt,httpStatus},failure.reason):undefined;
              failures.set(key,{reason:failure.reason,until:Date.now()+(failure.reason==='visitor_restricted'?300000:30000),...(origin?{origin}:{})});
            }
            while(failures.size>500)failures.delete(failures.keys().next().value!);
          }
          recordFailure(failure);
          if(!recoverable)throw failure;
          // Recovery can scan bounded saved pages or read a stored detail. None
          // of that work uses the supplier; holding its two slots here would
          // reject unrelated visitors while the source itself is idle.
          throw new AjesSavedRecovery(async()=>{
            if(query.kind==='detail'&&!usable){
              let fallback=listed.get(query.table+':'+query.id)?.value;
              if(!fallback)try{fallback=await deps.readListedDetail?.(query.table,query.id!);}catch{}
              const fallbackAge=Date.now()-Date.parse(fallback?.observedAt||'');
              if(fallbackAge>=0&&fallbackAge<7*86400000&&fallback?.items?.length===1&&fallback.items[0].id===query.id&&fallback.items[0].table===query.table){await deps.assertEnabled(query.table);return {...fallback,partial:true,stale:true};}
            }
            if(query.kind==='list'){const fallback=await listFallback(saved);if(fallback)return fallback;}
            if(query.kind==='makes'&&query.page===1){const fallback=await recoveredList(saved);if(fallback)return fallback;throw failure;}
            if(query.kind!=='list'&&usable&&(saved.items.length>0||query.kind==='count'||query.kind==='models'||query.kind==='makes'||query.kind==='colors')){await deps.assertEnabled(query.table);return {...saved,stale:true};}
            throw failure;
          });
        }finally{finishAttempt();clearTimeout(timer);}
      },visitorKey,query.kind==='detail'?'detail':'').catch(async error=>{
        if(error instanceof AjesEmptyValidation)return error.read();
        if(error instanceof AjesSavedRecovery)return visitorCache.get(visitorKey,()=>error.read()).catch(recoveryError=>{
          if(recoveryError instanceof Error&&/^detail_cache_queue_(?:timeout|full)$/.test(recoveryError.message))throw new AjesUnavailable('local_busy');
          throw recoveryError;
        });
        // Admission queue rejection happens outside the provider try/catch.
        // Treat only these bounded local failures as recoverable unavailability;
        // never turn programming/data errors into an empty successful response.
        if(error instanceof Error&&/^detail_cache_queue_(?:timeout|full)$/.test(error.message)){
          if(evidence){evidence.disposition='local_recovery';evidence.reason='local_busy';evidence.recovery=true;}
          // Queue admission failed before persisted rows were read. Stored
          // detail recovery uses its own bounded queue, never a supplier bypass.
          if(query.kind==='detail'){
            return visitorCache.get(visitorKey,async()=>{
              await deps.assertEnabled(query.table);
              let saved:any=null;try{saved=await deps.readDetail?.(query.table,query.id!);}catch{}
              if(isUsable(saved)){await deps.assertEnabled(query.table);return {...saved,stale:true};}
              const memory=listed.get(query.table+':'+query.id)?.value;
              if(isUsable(memory)){await deps.assertEnabled(query.table);return {...memory,partial:true,stale:true};}
              let fallback:any=null;try{fallback=await deps.readListedDetail?.(query.table,query.id!);}catch{}
              if(isUsable(fallback)){await deps.assertEnabled(query.table);return {...fallback,partial:true,stale:true};}
              throw new AjesUnavailable('local_busy');
            }).catch(recoveryError=>{
              if(recoveryError instanceof Error&&/^detail_cache_queue_(?:timeout|full)$/.test(recoveryError.message))throw new AjesUnavailable('local_busy');
              throw recoveryError;
            });
          }
          if(query.kind==='list'){
            await deps.assertEnabled(query.table);
            const saved=prepared;
            const fallback=await listFallback(saved);if(fallback)return fallback;
          }else if(query.kind==='models'||query.kind==='makes'){
            // Retained directory pages are names, not a fresh inventory count.
            await deps.assertEnabled(query.table);
            const saved=prepared;
            if(query.kind==='makes'&&query.page===1){const fallback=await recoveredList(saved);if(fallback)return fallback;}
            else if(isUsable(saved)){await deps.assertEnabled(query.table);return {...saved,stale:true};}
          }
          throw new AjesUnavailable('local_busy');
        }
        throw error;
      }).then(value=>{
        if(verifyEmpty){
          observeRows(value);
          if(beforeBarrier(value)){
            const latest=latestFresh();if(latest!==undefined)return latest;
            throw new AjesUnavailable(cooling(quotaKey)||cooling('visitor:'+clientIp)||cooling(visitorKey)||'empty_response');
          }
        }
        return value;
      });
    }
  return {read:async(input:unknown,clientIp:string,powerContext?:JapanPowerQueryContext)=>{
    const evidence=beginAjesReadEvidence();
    try{
      const result=await read(input,clientIp,undefined,powerContext,evidence);
      const items=result.items.filter((lot:any)=>!japanVehicleExcluded(lot));
      const {sourceReadReceipt:_retainedReceipt,...values}=result;
      const output={...values,items:items.length===result.items.length?result.items:items};
      const receipt=finishAjesReadEvidence(evidence);
      if(receipt)Object.defineProperty(output,'sourceReadReceipt',{value:receipt,enumerable:false});
      return output;
    }catch(error){
      // Do not annotate a shared exception in place. Preserve unrelated owner
      // and programming Error identity; their absence of evidence stays explicit.
      const outgoing=error instanceof AjesUnavailable?new AjesUnavailable(error.reason):error instanceof AjesInputError?new AjesInputError():error;
      if(outgoing!==error){const receipt=finishAjesReadEvidence(evidence,true,error instanceof AjesUnavailable?error.reason:'invalid_query');if(receipt)Object.defineProperty(outgoing,'sourceReadReceipt',{value:receipt,enumerable:false});}
      throw outgoing;
    }
  }};
}
function quotaNumber(value:string|null){return value!==null&&/^\d+$/.test(value)?Number(value):null;}

/** Supplier responses are capped at 500 rows. Never treat a full page as a complete directory. */
export async function readAjesModelDirectory(client:ReturnType<typeof createAjesClient>,input:Record<string,unknown>,ip:string){
 const models:Array<{make:string;model:string;total:number}>=[];
 let observedAt='',stale=false;
 const identities=new Set<string>();
 for(let page=1;page<=10;page++){
  const result=await client.read({...input,aggregate:'models',page},ip);
  observedAt=observedAt||result.observedAt;stale=stale||Boolean(result.stale);
  for(const model of result.models||[]){
   const key=JSON.stringify([model.make,model.model]);
   if(identities.has(key))throw new AjesUnavailable('directory_page_repeated');
   identities.add(key);models.push(model);
  }
  if(result.received<500)return {models,observedAt,stale};
 }
 throw new AjesUnavailable('directory_too_large');
}

/** A brand directory is independent of the visible list and model pagination. */
export async function readAjesMakeDirectory(client:ReturnType<typeof createAjesClient>,input:Record<string,unknown>,ip:string){
 const makes:Array<{make:string;total:number}>=[],seen=new Set<string>();let observedAt='',stale=false;
 for(let page=1;page<=10;page++){
  const result=await client.read({...input,aggregate:'makes',page},ip);
  if(result.partial||!Array.isArray(result.makes)||!Number.isSafeInteger(result.received)||result.received<0||result.received>500||result.makes.length!==result.received)throw new AjesUnavailable('directory_incomplete');
  observedAt=!observedAt||result.observedAt<observedAt?result.observedAt:observedAt;stale=stale||Boolean(result.stale);
  for(const row of result.makes||[]){const key=row.make.toUpperCase();if(seen.has(key))throw new AjesUnavailable('directory_page_repeated');seen.add(key);makes.push(row);}
  if(result.received<500)return {makes,observedAt,stale,complete:true as const};
 }
 throw new AjesUnavailable('directory_too_large');
}

export async function readAjesColorDirectory(client:ReturnType<typeof createAjesClient>,input:Record<string,unknown>,ip:string){
 const colors:string[]=[];let stale=false;const seen=new Set<string>();
 for(let page=1;page<=10;page++){
  const result=await client.read({...input,aggregate:'colors',page},ip);stale ||= Boolean(result.stale);
  for(const row of result.colors||[]){if(seen.has(row.color))throw new AjesUnavailable('directory_page_repeated');seen.add(row.color);colors.push(row.color);}
  if(result.received<500)return {colors,stale};
 }
 throw new AjesUnavailable('directory_too_large');
}
