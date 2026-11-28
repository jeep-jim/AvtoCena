import {ajesFailureSlot,inspectAjesHttpFailureResponse,sanitizeAjesResponseValidation,type AjesRequestDiagnostic,type AjesResponseValidation} from './ajes-request-diagnostic';
import {startAjesReadTrace,finishAjesReadReceipt,ajesPublicFailureReason,type AjesReadTrace} from './ajes-read-receipt';
import type {CalculationIndex} from '../encyclopedia/calculation-index';
import {createHash} from 'node:crypto';
import {isIP} from 'node:net';
import {gunzipSync} from 'node:zlib';
import {DetailReadCache} from './detail-read-cache';
import {ajesQuery,ajesLot,ajesText,ajesSourceCacheSql,AjesInputError,AJES_CENSUS_FIELDS,type AjesTable,type AjesQuery} from './ajes-query';
import {AjesUnavailable,assertAjesJapanTable} from './ajes-access-policy';

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
const sourceTtlMs=30*60*1000;
const savedSourceFieldNames=new Set<string>(['ID',...AJES_CENSUS_FIELDS,'AUCTION_TYPE','FINISH','START','IMAGES','EQUIP','KPP_TYPE','TOWN','SERIAL','MILEAGE','AUCTION','LOT','AUCTION_DATE','RATE','MONTH','INFO']);
const sqlHash=(sql:string)=>createHash('sha256').update(sql).digest('hex');
/** Observe an already rejected LIST, never admit or retain its rows. The same
 * ID text normalization and finite alphabet as ajesLot make adjacent-window
 * hashes comparable; they do not establish that WHERE/OFFSET was honoured.
 */
function rejectedListWindow(rows:unknown[],windowSize:number):AjesResponseValidation['listWindow'] {
 if(!Number.isSafeInteger(windowSize)||windowSize<1||windowSize>48||rows.length>96||rows.length<2*windowSize)return undefined;
 const ids:string[]=[];
 for(const row of rows){
  if(!row||typeof row!=='object'||Array.isArray(row))continue;
  const prototype=Object.getPrototypeOf(row);
  if(prototype!==Object.prototype&&prototype!==null)continue;
  const field=Object.getOwnPropertyDescriptor(row,'ID');
  if(!field||!Object.prototype.hasOwnProperty.call(field,'value'))continue;
  const id=ajesText(field.value);
  if(/^[A-Za-z0-9_-]{1,64}$/.test(id))ids.push(id);
 }
 const counts={windowSize,identityRowCount:ids.length,uniqueIdCount:new Set(ids).size};
 if(counts.identityRowCount!==rows.length||counts.uniqueIdCount!==rows.length)return counts;
 const hash=(values:string[])=>createHash('sha256').update(JSON.stringify(values)).digest('hex');
 return {...counts,fingerprints:{orderedIdsSha256:hash(ids),firstWindowSha256:hash(ids.slice(0,windowSize)),nextWindowSha256:hash(ids.slice(windowSize,2*windowSize))}};
}
const needsEmptyProof=(value:any)=>value?.schemaVersion===2&&Array.isArray(value.items)&&value.items.length===0&&!(Number.isSafeInteger(value.received)&&value.received>0);
function verifiedEmptyPage(value:any,sourceSql?:string,countSql?:string,fresh=true){
  const proof=value?.emptyPageEvidence,now=Date.now();
  const sourceTime=Date.parse(value?.observedAt||''),countTime=Date.parse(proof?.countObservedAt||'');
  const sourceAge=now-sourceTime,countAge=now-countTime;
  return value?.received===0&&value?.rejected===0&&Array.isArray(value.items)&&value.items.length===0
    &&proof?.version===1&&proof.sourceObservedAt===value.observedAt&&proof.page===value.page&&proof.pageSize===value.pageSize
    &&Number.isSafeInteger(value.page)&&value.page>=1&&Number.isSafeInteger(value.pageSize)&&value.pageSize>=1
    &&Number.isSafeInteger(proof.countTotal)&&proof.countTotal>=0&&proof.countTotal<=(value.page-1)*value.pageSize
    &&/^[a-f0-9]{64}$/.test(proof.sourceQueryHash||'')&&/^[a-f0-9]{64}$/.test(proof.countQueryHash||'')
    &&(!sourceSql||proof.sourceQueryHash===sqlHash(sourceSql))&&(!countSql||proof.countQueryHash===sqlHash(countSql))
    &&Number.isFinite(sourceTime)&&Number.isFinite(countTime)&&Math.abs(sourceTime-countTime)<sourceTtlMs
    &&sourceAge>=0&&countAge>=0&&(!fresh||sourceAge<sourceTtlMs&&countAge<sourceTtlMs);
}
const emptyDirectoryKind=(value:any):'makes'|'models'|undefined=>value?.page===1
  ?Array.isArray(value?.makes)&&value.makes.length===0?'makes'
  :Array.isArray(value?.models)&&value.models.length===0?'models':undefined:undefined;
/** An empty first directory page cannot establish zero inventory by itself.
 * Its exact COUNT proof uses the same source deadline as an empty list page. */
function verifiedEmptyDirectory(value:any,sourceSql?:string,countSql?:string,fresh=true){
  const kind=emptyDirectoryKind(value);
  return Boolean(kind)&&value.pageSize===500&&value.emptyPageEvidence?.kind===kind
    &&value.emptyPageEvidence.countTotal===0&&verifiedEmptyPage(value,sourceSql,countSql,fresh);
}
const directoryObservationTime=(value:any)=>Math.max(Date.parse(value?.observedAt||''),
  value?.emptyPageEvidence?.kind?Date.parse(value.emptyPageEvidence.countObservedAt||''):0);
type Dependencies={saveRequestFailure?:(value:AjesRequestDiagnostic)=>Promise<unknown>;calculationIndex?:()=>CalculationIndex|null;password:()=>string|undefined|Promise<string|undefined>; assertEnabled:(table?:AjesTable)=>Promise<void>; reserve:(table:AjesTable,kind?:string)=>Promise<void>; fetcher?:typeof fetch; endpoint?:(ip:string)=>string|Promise<string>; saveEvidence?:(table:AjesTable,value:any)=>Promise<void>; saveAggregateEvidence?:(kind:string,value:any)=>Promise<void>; readQuery?:(sql:string)=>Promise<any|null>; readLegacyQuery?:(sql:string)=>Promise<any|null>; saveQuery?:(sql:string,value:any)=>Promise<void>; readDetail?:(table:AjesTable,id:string)=>Promise<any|null>; readSavedSearch?:(input:AjesQuery)=>Promise<any|null>; readListedDetail?:(table:AjesTable,id:string)=>Promise<any|null>; saveDetail?:(table:AjesTable,id:string,value:any)=>Promise<void>};
export function createAjesClient(deps:Dependencies) {
  // Scalar ordering only; actual payload ownership remains with the bounded
  // caches. A delayed zero must not replace an already observed newer result.
  const directoryOrder=new Map<string,number>(),directoryBindings=new WeakMap<object,{key:string;at:number}>();
  const trackDirectory=(key:string,value:any)=>{
    const at=directoryObservationTime(value);directoryBindings.set(value,{key,at});
    if(at>=(directoryOrder.get(key)??-Infinity)){directoryOrder.delete(key);directoryOrder.set(key,at);}
    while(directoryOrder.size>300)directoryOrder.delete(directoryOrder.keys().next().value!);
    return value;
  };
  const currentDirectory=(value:any)=>{const binding=directoryBindings.get(value);return !binding||(directoryOrder.get(binding.key)??binding.at)<=binding.at;};
  // Only fresh successful results can be reused across visitor addresses.
  // A slow detail may use one slot; lists and filter directories retain the other.
  // Keep the total supplier concurrency at two, including all request kinds.
  // A queued detail may wait for the preceding 45-second read instead of failing
  // at the ordinary five-second queue deadline solely due to serialization.
  const sourceExpiry=(value:any)=>Math.min(Date.parse(value?.observedAt||'')+sourceTtlMs,value?.emptyPageEvidence?Date.parse(value.emptyPageEvidence.countObservedAt||'')+sourceTtlMs:Infinity);
  const cache=new DetailReadCache<any>({maxEntries:300,maxBytes:8*1024*1024,ttlMs:30*60*1000,expiresAt:sourceExpiry,concurrency:2,groupConcurrency:{detail:1},groupQueueTimeoutMs:{detail:50_000},shouldCache:value=>!value.stale&&!value.partial&&currentDirectory(value)&&(!emptyDirectoryKind(value)||verifiedEmptyDirectory(value))});
  // Stored recovery has its own bounded queue. It must neither occupy supplier
  // admission nor promote a visitor's stale result into the shared fresh cache.
  // Inspect exact already requested lists and metadata, never detail responses.
  // Separate bounded storage admission: a ready saved list must not wait
  // for two unrelated supplier requests. Names/counts have the same existing
  // observation deadline. No new shared TTL, source admission or feed crawl.
  const preparedReads=new DetailReadCache<any>({maxEntries:300,maxBytes:8*1024*1024,ttlMs:30*60*1000,expiresAt:sourceExpiry,concurrency:2,maxQueued:32,queueTimeoutMs:5000,shouldCache:value=>{
    const age=Date.now()-Date.parse(value?.observedAt||'');
    const supported=value?.schemaVersion===2||Array.isArray(value?.makes)||Array.isArray(value?.models)||Array.isArray(value?.colors)||Array.isArray(value?.groups)||Number.isSafeInteger(value?.total);
    return supported&&!value.stale&&!value.partial&&age>=0&&age<sourceTtlMs&&(!needsEmptyProof(value)||verifiedEmptyPage(value))
      &&(!emptyDirectoryKind(value)||verifiedEmptyDirectory(value));
  }});
  // Memoization avoids repeated object-store reads. Every reuse below
  // still checks observedAt; memory residence never extends freshness.
  const visitorCache=new DetailReadCache<any>({maxEntries:300,maxBytes:8*1024*1024,ttlMs:30*1000,concurrency:2});
  // Persistence is a best-effort cache of requested responses, not the supplier
  // transaction. A slow storage write must not delay ready cars or hold the two
  // supplier slots. Bound both concurrent writes and retained waiting payloads.
  const persistence=new DetailReadCache<null>({maxEntries:1,maxBytes:1,ttlMs:0,concurrency:2,groupConcurrency:{directory:1},maxQueued:16,queueTimeoutMs:5000,shouldCache:()=>false});
  let persistenceSequence=0,persistenceWarningAt=0;
  const lastFailureSaved=new Map<string,number>();
  const persist=(save:()=>Promise<unknown>,group='')=>{const key=String(++persistenceSequence);void persistence.get(key,async()=>{await save();return null;},key,group).catch(()=>{
    if(Date.now()-persistenceWarningAt>=60000){persistenceWarningAt=Date.now();console.warn('AJES_PERSISTENCE_UNAVAILABLE');}
  });};
  // Bounded snapshots of rows the visitor already saw, not fabricated full details.
  const listed=new Map<string,{value:any;bytes:number}>();let listedBytes=0;
  const failures=new Map<string,{reason:string;until:number}>();
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
  const cooling=(key:string)=>{const value=failures.get(key);if(value&&value.until>Date.now())return value.reason;failures.delete(key);return null;};
    async function read(input:unknown,clientIp:string,compiledQuery?:ReturnType<typeof ajesQuery>,trace?:AjesReadTrace):Promise<any> {
      // Retired tables cannot read caches, credentials, quota or the supplier,
      // even when an old link or saved owner setting still requests them.
      assertAjesJapanTable(input&&typeof input==='object'?(input as AjesQuery).table:undefined);
      const calculationIndex=compiledQuery?null:deps.calculationIndex?.()||null;
      const query=compiledQuery??ajesQuery(input,calculationIndex);
      if(trace){trace.query={queryHash:sqlHash(query.sql),table:query.table,kind:query.kind,page:query.page,pageSize:query.pageSize};trace.stage='access';}
      const cacheSql=ajesSourceCacheSql(query.sql);
      const sourceKey=query.kind==='list'?sqlHash(cacheSql):'';
      // Capture the same local query facts now; a later index refresh must not
      // change the WHERE used to verify this exact source selection.
      const firstDirectory=(query.kind==='makes'||query.kind==='models')&&query.page===1;
      const countInput=query.kind==='list'||firstDirectory?{...(input as AjesQuery),aggregate:'count' as const}:null;
      const countQuery=countInput?ajesQuery(countInput,calculationIndex):null;
      const countSql=countQuery?ajesSourceCacheSql(countQuery.sql):'';
      const unprovedDirectory=(value:any,fresh=true)=>firstDirectory&&emptyDirectoryKind(value)
        &&(value.emptyPageEvidence?.kind!==query.kind||!verifiedEmptyDirectory(value,cacheSql,countSql,fresh));
      const olderDirectory=(value:any)=>firstDirectory&&directoryObservationTime(value)<(directoryOrder.get(cacheSql)??-Infinity);
      if(!isIP(clientIp)) throw new AjesUnavailable('client_ip_missing');
      await deps.assertEnabled(query.table); // Also applies to cache hits after an owner disables the source.
      const password=await deps.password();
      if(!password)throw new AjesUnavailable('not_configured');
      // A valid year interval outside admission policy is known empty, not a failure.
      // Retain visitor and owner-switch checks even when no supplier request is needed.
      if(query.kind!=='detail'&&query.empty)return {schemaVersion:2,items:[],total:0,...(query.kind==='count'&&'identityCount' in query?{distinctTotal:0}:{}),groups:query.kind==='census'?[]:undefined,colors:query.kind==='colors'?[]:undefined,models:query.kind==='models'?[]:undefined,makes:query.kind==='makes'?[]:undefined,page:query.page,pageSize:query.pageSize,received:0,rejected:0,stale:false,observedAt:new Date().toISOString()};
      const visitorKey=clientIp+"\0"+cacheSql;
      const quotaKey='quota:'+query.table+((query.kind==='count'||query.kind==='makes'||query.kind==='census')?':count':'');
      const isUsable=(saved:any)=>{const age=Date.now()-Date.parse(saved?.observedAt||'');return age>=0&&age<7*24*60*60*1000&&Array.isArray(saved?.items)&&saved.items.length<=query.pageSize
          &&saved.page===query.page&&saved.pageSize===query.pageSize
          &&(query.kind==='count'?Number.isSafeInteger(saved.total)&&saved.total>=0:query.kind==='census'?Array.isArray(saved.groups)&&saved.groups.length===saved.received&&saved.groups.length<=500:query.kind==='colors'?Array.isArray(saved.colors):query.kind==='makes'?Array.isArray(saved.makes):query.kind==='models'?Array.isArray(saved.models):saved.items.every((lot:any)=>lot?.table===query.table&&typeof lot.id==='string'))
          &&(query.kind!=='detail'||(saved.items.length===1&&saved.items[0].id===query.id))
          &&!unprovedDirectory(saved,false);};
      const newerDirectory=(value:any)=>firstDirectory?[cache.peekFresh(cacheSql),preparedReads.peekFresh(cacheSql)]
        .filter(current=>isUsable(current)&&!current.stale&&!current.partial&&current[query.kind]?.length>0
          &&directoryObservationTime(current)>directoryObservationTime(value))
        .sort((a,b)=>directoryObservationTime(b)-directoryObservationTime(a))[0]:undefined;
      const persistDirectory=(value:any)=>persist(async()=>{
        // Serial directory writes also cover a PUT that was already in flight
        // when a newer successful source response arrived.
        if(currentDirectory(value)&&!olderDirectory(value))await deps.saveQuery!(cacheSql,value);
      },'directory');
      const proofTime=(proof:any)=>Math.max(Date.parse(proof.sourceObservedAt),Date.parse(proof.countObservedAt));
      const barrier=()=>{const value=emptyBarriers.get(sourceKey);if(value&&Date.now()-Date.parse(value.proof.sourceObservedAt)>=7*86400000){emptyBarriers.delete(sourceKey);return undefined;}return value;};
      const beforeBarrier=(value:any)=>{
        const known=barrier();if(!known)return false;
        if(verifiedEmptyPage(value,cacheSql,countSql,false))return Boolean(known.supersededAt)||proofTime(value.emptyPageEvidence)<proofTime(known.proof);
        return !(Date.parse(value?.observedAt||'')>proofTime(known.proof));
      };
      const rememberEmpty=(value:any)=>{
        if(query.kind!=='list'||!isUsable(value)||value.stale||value.partial||!verifiedEmptyPage(value,cacheSql,countSql,false))return;
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
        if(current!==undefined){if(!beforeBarrier(current)&&!unprovedDirectory(current)&&!olderDirectory(current)){observeRows(current);return current;}cache.invalidate(cacheSql);}
        const known=barrier();if(!known||known.supersededAt)return undefined;
        const value={schemaVersion:2,items:[],page:query.page,pageSize:query.pageSize,received:0,rejected:0,stale:false,observedAt:known.proof.sourceObservedAt,emptyPageEvidence:known.proof};
        return verifiedEmptyPage(value,cacheSql,countSql)?value:undefined;
      };
      const recoveredList=async(value:any)=>{
        await deps.assertEnabled(query.table);
        const latest=latestFresh();if(latest!==undefined)return remember(latest);
        if(isUsable(value)&&value.items.length&&!beforeBarrier(value))return remember({...value,stale:true});
        return null;
      };
      const listFallback=async(saved:any)=>{
        const current=await recoveredList(saved);if(current)return current;
        // A proven empty remains a barrier after its freshness expires. A
        // refusal cannot resurrect pre-zero exact, legacy or partial rows.
        const known=barrier();if(known&&!known.supersededAt)return null;
        const usable=isUsable(saved);
        if((!usable||!saved.items.length)&&deps.readLegacyQuery){
          let fallback:any=null;try{fallback=await deps.readLegacyQuery(cacheSql);}catch{}
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
      if(inMemory!==undefined)return inMemory;
      // Reuse only this visitor's already recovered result while the original
      // refusal cooldown is active. Looking it up after queue/storage work made
      // the 30-second recovery cache ineffective at protecting repeat visits.
      // peekFresh never renews its deadline; a new shared success above wins.
      const recovered=inspectPrepared?visitorCache.peekFresh(visitorKey):undefined;
      if(recovered?.stale&&isUsable(recovered)&&!beforeBarrier(recovered)
        &&(cooling(quotaKey)||cooling('visitor:'+clientIp)||cooling(visitorKey))){
        if(trace){trace.stage='cooldown';trace.reason=cooling(quotaKey)||cooling('visitor:'+clientIp)||cooling(visitorKey)||undefined;}
        await deps.assertEnabled(query.table);
        return recovered;
      }
      const freshPrepared=(value:any)=>{
        const age=Date.now()-Date.parse(value?.observedAt||'');
        const schema=['count','models','makes','colors','census'].includes(query.kind)||value?.schemaVersion===2;
        return isUsable(value)&&schema&&!value.stale&&!value.partial&&age<sourceTtlMs&&!beforeBarrier(value)&&!unprovedDirectory(value)&&!olderDirectory(value)
          &&(query.kind!=='list'||!needsEmptyProof(value)||verifiedEmptyPage(value,cacheSql,countSql));
      };
      let prepared:any=null;
      if(inspectPrepared&&deps.readQuery){
        if(trace)trace.stage='storage';
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
        const latest=latestFresh();if(latest!==undefined)return latest;
        if(freshPrepared(prepared)){const value={...prepared,stale:false};return query.kind==='list'?remember(value):firstDirectory?trackDirectory(cacheSql,value):value;}
      }
      return cache.get(cacheSql,async()=>{
        await deps.assertEnabled(query.table); // Recheck after waiting for concurrency slot.
        // Only successful, user-requested responses are retained; never crawl the database.
        let saved:any=prepared;
        if(!inspectPrepared)try {saved=await deps.readDetail?.(query.table,query.id!);}catch{}
        const usable=isUsable(saved);
        if(freshPrepared(saved)){const value={...saved,stale:false};return query.kind==='list'?remember(value):firstDirectory?trackDirectory(cacheSql,value):value;}
        const url=new URL(await deps.endpoint?.(clientIp)||'http://87.242.72.57/api/');
        url.search=new URLSearchParams({ip:clientIp,json:'',code:password,sql:query.sql}).toString();
        let requestStarted=false,httpStatus:number|null=null,providerCode:string|null=null;
        const startedAt=new Date().toISOString();
        const controller=new AbortController();
        const responseFacts:Pick<AjesResponseValidation,'wireBytes'|'decodedBytes'|'rootKind'|'rowCount'|'listWindow'>={};
        let responseValidation:AjesResponseValidation|undefined;
        const invalidResponse=(phase:AjesResponseValidation['phase'],code:AjesResponseValidation['code'])=>{
          responseValidation=sanitizeAjesResponseValidation({version:1,phase,code,...responseFacts});
          return new AjesUnavailable('invalid_response');
        };
        const recordFailure=(failure:AjesUnavailable)=>{
          // Throttle fixed page/kind slots independently; never retain a body.
          const failureSlot=ajesFailureSlot(query);
          if(requestStarted&&deps.saveRequestFailure&&Date.now()-(lastFailureSaved.get(failureSlot)??0)>=60000){
            lastFailureSaved.set(failureSlot,Date.now());
            const diagnostic:AjesRequestDiagnostic={table:query.table,kind:query.kind,page:query.page,pageSize:query.pageSize,startedAt,finishedAt:new Date().toISOString(),clientIp,sql:query.sql,endpoint:url.origin+url.pathname,httpStatus,providerCode,outcome:failure.reason,...(responseValidation?{responseValidation}:{})};
            if(Buffer.byteLength(JSON.stringify(diagnostic))<=64*1024)persist(()=>deps.saveRequestFailure!(diagnostic));
          }
        };
        // Power is a local selection over the same requested raw page. It uses
        // the ordinary source deadline, not a shorter deadline that discards
        // otherwise valid responses and unnecessarily falls back to old rows.
        const deadlineAt=Date.now()+20000;
        const timer=setTimeout(()=>controller.abort(),20000);
        try {
          const cooldown=cooling(quotaKey)||cooling('visitor:'+clientIp)||cooling(visitorKey);
          if(cooldown)throw new AjesUnavailable(cooldown);
          await deps.reserve(query.table,query.kind);
          requestStarted=true;
          if(trace){trace.stage='supplier';trace.supplierAttempted=true;}
          const response=await (deps.fetcher??fetch)(url,{signal:controller.signal,redirect:'error',cache:'no-store'});
          httpStatus=response.status;
          if(!response.ok){
            // Diagnose this already failed response only. Inspection cannot
            // replace its HTTP failure or change receipt/recovery semantics.
            try{responseValidation=sanitizeAjesResponseValidation(await inspectAjesHttpFailureResponse(response,controller.signal,deadlineAt));}catch{}
            throw new AjesUnavailable(response.status===414?'query_too_large':`http_${response.status}`);
          }
          if(Number(response.headers.get('content-length'))>2*1024*1024)throw new AjesUnavailable('response_too_large');
          const reader=response.body?.getReader();
          if(!reader)throw new AjesUnavailable('empty_response');
          const chunks:Uint8Array[]=[];let bytes=0;
          while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024){await reader.cancel();throw new AjesUnavailable('response_too_large');}chunks.push(value);}
          let rows:unknown;
          let decodeCode:'gzip_invalid'|'json_invalid'='gzip_invalid';
          try{
            const body=Buffer.concat(chunks);
            responseFacts.wireBytes=body.length;
            // Node fetch usually decompresses Content-Encoding automatically. The
            // provider can also return a gzip body without that header: inspect magic.
            const decoded=body[0]===0x1f&&body[1]===0x8b?gunzipSync(body,{maxOutputLength:2*1024*1024}):body;
            responseFacts.decodedBytes=decoded.length;decodeCode='json_invalid';
            // The provider returns a short plaintext bot refusal containing the
            // API password for some visitor addresses. Classify it without ever
            // retaining/logging its contents or replacing the visitor address.
            const refusal=decoded.length<=256?decoded.toString('utf8').match(/^\s*((?:bot|ban)\d*)(?:\s|$)/i):null;
            if(refusal){providerCode=refusal[1].length<=16?refusal[1].toLowerCase():null;throw new AjesUnavailable('visitor_restricted');}
            rows=JSON.parse(decoded.toString('utf8'));
          }catch(error){if(error instanceof AjesUnavailable)throw error;throw invalidResponse('decode',decodeCode);}
          responseFacts.rootKind=rows===null?'null':Array.isArray(rows)?'array':typeof rows as AjesResponseValidation['rootKind'];
          if(Array.isArray(rows))responseFacts.rowCount=rows.length;
          if(query.kind==='count'||query.kind==='models'||query.kind==='makes'||query.kind==='colors'||query.kind==='census'){
            const first=Array.isArray(rows)?rows[0]:rows;
            const aggregateEvidence={observedAt:new Date().toISOString(),array:Array.isArray(rows),length:Array.isArray(rows)?rows.length:null,fields:first&&typeof first==='object'?Object.keys(first).slice(0,30):[],numeric:first&&typeof first==='object'?Object.fromEntries(Object.entries(first).filter(([k,v])=>/^(?:total|count(?:\(\*\))?|tag[012])$/i.test(k)&&/^\d+$/.test(String(v)))):{}};
            if(deps.saveAggregateEvidence)persist(()=>deps.saveAggregateEvidence!(query.kind,aggregateEvidence));
          }
          if(!Array.isArray(rows))throw invalidResponse('page_shape','root_not_array');
          if(rows.length>query.pageSize){
            if(query.kind==='list'){
              const listWindow=rejectedListWindow(rows,query.pageSize);
              if(listWindow)responseFacts.listWindow=listWindow;
            }
            throw invalidResponse('page_shape','row_limit_exceeded');
          }
          if(rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw invalidResponse('page_shape','row_not_object');
          if(query.kind==='detail'&&rows.some(r=>r.ID!==query.id))throw new AjesUnavailable('identity_mismatch');
          if(query.kind==='census'){
            const {parseAjesCensusGroups}=await import('./ajes-census-protocol');
            let groups;try{groups=parseAjesCensusGroups(rows,query.censusFields);}catch{throw invalidResponse('aggregate_shape','total_invalid');}
            const result={items:[],groups,page:query.page,pageSize:query.pageSize,received:rows.length,rejected:0,stale:false,observedAt:new Date().toISOString()};
            // Empty aggregate pages are not a zero proof. The caller must verify
            // all group weights against the independently obtained raw COUNT.
            if(deps.saveQuery)persist(()=>deps.saveQuery!(cacheSql,result));
            return result;
          }
          if(query.kind==='count'||query.kind==='models'||query.kind==='makes'||query.kind==='colors'){
            const totalOf=(r:any)=>{const match=Object.entries(r).find(([key])=>['total','count(*)','count',query.kind==='count'?'tag0':(query.kind==='makes'||query.kind==='colors')?'tag1':'tag2'].includes(key.toLowerCase().replace(/\s/g,'')));const value=match?.[1];if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value)))throw invalidResponse('aggregate_shape','total_invalid');return Number(value);};
            if(query.kind==='count'&&rows.length!==1)throw invalidResponse('aggregate_shape','count_row_count');
            const models=query.kind==='models'?rows.map(r=>({make:String(r.MARKA_NAME??r.marka_name??'').trim(),model:String(r.MODEL_NAME??r.model_name??'').trim(),total:totalOf(r)})):undefined;
            // Dropping a nameless aggregate row would hide incomplete metadata
            // behind a successful cached page. Reject before any persistence.
            if(models?.some(model=>!model.make||!model.model))throw new AjesUnavailable('invalid_response');
            const makes=query.kind==='makes'?rows.map(r=>({make:String(r.MARKA_NAME??r.marka_name??'').trim(),total:totalOf(r)})):undefined;
            if(makes?.some(m=>!m.make))throw invalidResponse('aggregate_shape','make_name_missing');
            const colors=query.kind==='colors'?rows.map(r=>({color:String(r.COLOR??r.color??'').trim(),total:totalOf(r)})).filter(r=>r.color):undefined;
            let distinctTotal:number|undefined;
            if(query.kind==='count'&&'identityCount' in query){
              const value=Object.entries(rows[0]).find(([key])=>['census_distinct_ids','tag1'].includes(key.toLowerCase()))?.[1];
              if(!/^\d+$/.test(String(value))||!Number.isSafeInteger(Number(value))||Number(value)>totalOf(rows[0]))throw invalidResponse('aggregate_shape','total_invalid');
              distinctTotal=Number(value);
            }
            const result={items:[],models,makes,colors,total:query.kind==='count'?totalOf(rows[0]):undefined,...(distinctTotal!==undefined?{distinctTotal}:{}),page:query.page,pageSize:query.pageSize,received:rows.length,rejected:0,stale:false,observedAt:new Date().toISOString()};
            if(firstDirectory&&rows.length===0){
              // Release supplier admission before the independent COUNT. An
              // unconfirmed [] must neither erase useful names nor poison a
              // later explicit UI retry through shared or persisted caches.
              throw new AjesEmptyValidation(async()=>{
                if(trace)trace.stage='empty_verification';
                let failure:AjesUnavailable,countReturned=false;
                try{
                  const count=await read(countInput!,clientIp,countQuery!);countReturned=true;
                  const countAge=Date.now()-Date.parse(count?.observedAt||'');
                  if(count.stale||count.partial||count.upperBound||count.total!==0
                    ||countAge<0||countAge>=sourceTtlMs)throw new AjesUnavailable('empty_response');
                  const verified={...result,emptyPageEvidence:{version:1,kind:query.kind,sourceQueryHash:sqlHash(cacheSql),countQueryHash:sqlHash(countSql),page:query.page,pageSize:query.pageSize,sourceObservedAt:result.observedAt,countObservedAt:count.observedAt,countTotal:0}};
                  if(!verifiedEmptyDirectory(verified,cacheSql,countSql))throw new AjesUnavailable('empty_response');
                  trackDirectory(cacheSql,verified);
                  await deps.assertEnabled(query.table);
                  const newer=newerDirectory(verified);if(newer)return newer;
                  if(!currentDirectory(verified))throw new AjesUnavailable('empty_response');
                  cache.invalidate(cacheSql);preparedReads.invalidate(cacheSql);visitorCache.invalidate(visitorKey);
                  const accepted=await cache.get(cacheSql,async()=>{
                    await deps.assertEnabled(query.table);
                    const newer=newerDirectory(verified);if(newer)return newer;
                    if(!currentDirectory(verified))throw new AjesUnavailable('empty_response');
                    if(!verifiedEmptyDirectory(verified,cacheSql,countSql))throw new AjesUnavailable('empty_response');
                    if(deps.saveQuery)persistDirectory(verified);
                    return verified;
                  },visitorKey);
                  const current=newerDirectory(accepted);if(current)return current;
                  if(!currentDirectory(accepted))throw new AjesUnavailable('empty_response');
                  return accepted;
                }catch(error){
                  failure=error instanceof AjesUnavailable?error:new AjesUnavailable('empty_response');
                  if(trace)trace.reason=failure.reason;
                  responseValidation=sanitizeAjesResponseValidation({version:1,phase:'empty_confirmation',code:countReturned?'count_unverified':'count_unavailable',
                    ...responseFacts,originCode:ajesPublicFailureReason(failure.reason)});
                }
                recordFailure(failure);await deps.assertEnabled(query.table);
                // Actual COUNT/provider refusals retain their existing guards.
                // Metadata contradiction adds no LIST-specific cooldown: one
                // ordinary visitor retry may recover a new positive directory.
                const current=latestFresh();if(current!==undefined)return current;
                if(isUsable(saved)&&saved[query.kind]?.length>0)return {...saved,stale:true};
                throw failure;
              });
            }
            if(firstDirectory)trackDirectory(cacheSql,result);
            if(deps.saveQuery){if(firstDirectory)persistDirectory(result);else persist(()=>deps.saveQuery!(cacheSql,result));}
            return result;
          }
          const items=rows.map(r=>ajesLot(r,query.table,query.kind==='detail')).filter(Boolean);
          const sourceFields=[...new Set(rows.flatMap(row=>Object.keys(row).filter(key=>/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key)).map(key=>key.toUpperCase())))].sort();
          const result={schemaVersion:2,stale:false,items,sourceFields,page:query.page,pageSize:query.pageSize,received:rows.length,rejected:rows.length-items.length,observedAt:new Date().toISOString(),
            quota:{counter:quotaNumber(response.headers.get('api-counter')),limit:quotaNumber(response.headers.get('api-limit')),remaining:quotaNumber(response.headers.get('api-rest'))}};
          if(query.kind==='list'&&rows.length===0){
            // An empty wire array is not proof of inventory exhaustion. Do not
            // overwrite useful saved rows or share this as a fresh success.
            throw new AjesEmptyValidation(async()=>{
              if(trace)trace.stage='empty_verification';
              let failure:AjesUnavailable;
              let countReturned=false;
              try{
                const count=await read(countInput!,clientIp,countQuery!);
                countReturned=true;
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
              }catch(error){failure=error instanceof AjesUnavailable?error:new AjesUnavailable('empty_response');if(trace)trace.reason=failure.reason;
                responseValidation=sanitizeAjesResponseValidation({version:1,phase:'empty_confirmation',code:countReturned?'count_unverified':'count_unavailable',
                  ...responseFacts,originCode:ajesPublicFailureReason(failure.reason)});}
              await deps.assertEnabled(query.table);
              const key=failure.reason==='visitor_restricted'?'visitor:'+clientIp:visitorKey;
              if(!cooling(key))failures.set(key,{reason:failure.reason,until:Date.now()+(failure.reason==='visitor_restricted'?300000:30000)});
              while(failures.size>500)failures.delete(failures.keys().next().value!);
              recordFailure(failure);
              // The older exact page (or bounded partial recovery) remains
              // explicitly stale. A failed COUNT must never become zero cars.
              return visitorCache.get(visitorKey,async()=>{const fallback=await listFallback(saved);if(fallback)return fallback;throw failure;});
            });
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
          if(trace){trace.reason=failure.reason;if(!requestStarted)trace.stage='cooldown';}
          const recoverable=!(error instanceof AjesUnavailable)||['visitor_restricted','request_failed','request_timeout','connect_timeout','quota_exhausted','quota_busy','invalid_response','empty_response','query_too_large'].includes(error.reason)||/^http_(429|5\d\d)$/.test(error.reason);
          if(recoverable){
            const key=failure.reason==='quota_exhausted'?quotaKey:failure.reason==='visitor_restricted'?'visitor:'+clientIp:visitorKey;
            // Native network/abort errors need the same visitor-local cooldown;
            // otherwise every power toggle repeats the failed source request.
            // Do not extend an existing cooldown when merely reading the cached failure.
            if(!cooling(key))failures.set(key,{reason:failure.reason,until:Date.now()+(failure.reason==='visitor_restricted'?300000:30000)});
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
            if(query.kind!=='list'&&usable&&(saved.items.length>0||query.kind==='count'||query.kind==='models'||query.kind==='makes'||query.kind==='colors'||query.kind==='census')){await deps.assertEnabled(query.table);return {...saved,stale:true};}
            throw failure;
          });
        }finally{clearTimeout(timer);}
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
          if(trace){trace.stage='queue';trace.reason='local_busy';}
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
            if(isUsable(saved)){await deps.assertEnabled(query.table);return {...saved,stale:true};}
          }
          throw new AjesUnavailable('local_busy');
        }
        throw error;
      }).then(value=>{
        if(query.kind==='list'){
          observeRows(value);
          if(beforeBarrier(value)){
            const latest=latestFresh();if(latest!==undefined)return latest;
            throw new AjesUnavailable(cooling(quotaKey)||cooling('visitor:'+clientIp)||cooling(visitorKey)||'empty_response');
          }
        }
        return value;
      });
    }
  /** Inspect only an exact already-requested first LIST page. Schema discovery
   * never spends supplier quota, obtains credentials or performs an AJ request.
   * A missing/expired saved page leaves source schema unknown. */
  async function readSavedSourceFields(input:unknown):Promise<string[]|undefined>{
    assertAjesJapanTable(input&&typeof input==='object'?(input as AjesQuery).table:undefined);
    const calculationIndex=deps.calculationIndex?.()||null;
    const requested=ajesQuery(input,calculationIndex);
    if(requested.kind!=='list')throw new AjesInputError();
    // Validate the original input before replacing its page, so this metadata
    // read cannot silently accept an invalid UI query or a retired table.
    const query=requested.page===1?requested:ajesQuery({...input as AjesQuery,page:1},calculationIndex);
    await deps.assertEnabled(query.table);
    if(query.empty)return undefined;
    const cacheSql=ajesSourceCacheSql(query.sql);
    const fields=(value:any):string[]|undefined=>{
      const age=Date.now()-Date.parse(value?.observedAt||'');
      if(value?.schemaVersion!==2||value.page!==query.page||value.pageSize!==query.pageSize
        ||!Number.isFinite(age)||age<0||age>=7*86400000||!Array.isArray(value.sourceFields)
        ||value.sourceFields.some((field:unknown)=>typeof field!=='string'||!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(field)))return undefined;
      return [...new Set<string>(value.sourceFields.map((field:string)=>field.toUpperCase()).filter((field:string)=>savedSourceFieldNames.has(field)))].sort();
    };
    for(const value of [cache.peekFresh(cacheSql),preparedReads.peekFresh(cacheSql)]){
      const observed=fields(value);if(observed!==undefined)return observed;
    }
    if(!deps.readQuery)return undefined;
    let saved:any;
    try{
      saved=await preparedReads.get(cacheSql,async()=>{
        await deps.assertEnabled(query.table);
        const value=await deps.readQuery!(cacheSql);
        return fields(value)===undefined?null:value;
      },cacheSql,'prepared');
    }catch{
      // Keep the switch authoritative even if it changed while storage was
      // queued. Storage errors do not trigger a fallback scan or a source read.
      await deps.assertEnabled(query.table);
      return undefined;
    }
    await deps.assertEnabled(query.table);
    return fields(saved);
  }
  return {readSavedSourceFields,read:async(input:unknown,clientIp:string)=>{
    const trace=startAjesReadTrace();
    try{
      const value=await read(input,clientIp,undefined,trace),sourceReceipt=finishAjesReadReceipt(trace,value);
      return {...value,...(sourceReceipt?{sourceReceipt}:{})};
    }catch(error){
      if(!(error instanceof AjesUnavailable))throw error;
      trace.reason=error.reason;
      const sourceReceipt=finishAjesReadReceipt(trace);
      // A coalesced rejection may belong to another caller. Never mutate it
      // with this request's receipt or turn raw exceptions into public text.
      throw Object.assign(new AjesUnavailable(error.reason),sourceReceipt?{sourceReceipt}:{});
    }
  }};
}
function quotaNumber(value:string|null){return value!==null&&/^\d+$/.test(value)?Number(value):null;}

/** Supplier responses are capped at 500 rows. Never treat a full page as a complete directory. */
export async function readAjesModelDirectory(client:ReturnType<typeof createAjesClient>,input:Record<string,unknown>,ip:string){
 const models:Array<{make:string;model:string;total:number}>=[];
 let observedAt='',observedTime=Infinity,stale=false;
 const identities=new Set<string>();
 // Names for this visitor's query are metadata. Continue within the client's
 // existing page grammar until a short response proves directory exhaustion.
 for(let page=1;;page++){
  const result=await client.read({...input,aggregate:'models',page},ip);
  const pageModels=result?.models,at=Date.parse(result?.observedAt||'');
  if(!Array.isArray(pageModels)||result.page!==page||result.pageSize!==500
    ||!Number.isSafeInteger(result.received)||result.received<0||result.received>500
    ||pageModels.length!==result.received||!Number.isFinite(at))throw new AjesUnavailable('invalid_response');
  if(at<observedTime){observedTime=at;observedAt=result.observedAt;}
  stale=stale||Boolean(result.stale||result.partial);
  for(const model of pageModels){
   if(!model||typeof model.make!=='string'||!model.make.trim()||typeof model.model!=='string'||!model.model.trim()
     ||!Number.isSafeInteger(model.total)||model.total<0)throw new AjesUnavailable('invalid_response');
   const key=JSON.stringify([model.make,model.model]);
   if(identities.has(key))throw new AjesUnavailable('directory_page_repeated');
   identities.add(key);models.push(model);
  }
  // A retained page is useful metadata, but a refused refresh must not cause
  // another source request or turn an unfinished directory into a fresh one.
  if(stale||result.received<500)return {models,observedAt,stale};
 }
}

/** A brand directory is independent of the visible list and model pagination. */
export async function readAjesMakeDirectory(client:ReturnType<typeof createAjesClient>,input:Record<string,unknown>,ip:string){
 const makes:Array<{make:string;total:number}>=[],seen=new Set<string>();let observedAt='',stale=false;
 for(let page=1;page<=10;page++){
  const result=await client.read({...input,aggregate:'makes',page},ip);
  observedAt=observedAt||result.observedAt;stale=stale||Boolean(result.stale);
  for(const row of result.makes||[]){const key=row.make.toUpperCase();if(seen.has(key))throw new AjesUnavailable('directory_page_repeated');seen.add(key);makes.push(row);}
  if(result.received<500)return {makes,observedAt,stale};
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
