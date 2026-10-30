import {ajesFailureSlot,type AjesRequestDiagnostic} from './ajes-request-diagnostic';
import {preserveKoreaListingLink} from './ajes-korea-detail-cache';
import type {CalculationIndex} from '../encyclopedia/calculation-index';
import {isIP} from 'node:net';
import {gunzipSync} from 'node:zlib';
import {DetailReadCache} from './detail-read-cache';
import {ajesQuery,ajesLot,type AjesTable,type AjesQuery} from './ajes-query';

export class AjesUnavailable extends Error {constructor(public reason:string){super(`ajes_${reason}`);}}
// Release supplier admission before consulting historical
// storage. Shared callers recover once; stale results never enter the fresh cache.
class AjesSavedRecovery {
  private pending?:Promise<any>;
  constructor(private readonly load:()=>Promise<any>){}
  read(){return this.pending??=(this.load());}
}
type Dependencies={saveRequestFailure?:(value:AjesRequestDiagnostic)=>Promise<unknown>;calculationIndex?:()=>CalculationIndex|null;password:()=>string|undefined|Promise<string|undefined>; assertEnabled:(table?:AjesTable)=>Promise<void>; reserve:(table:AjesTable,kind?:string)=>Promise<void>; fetcher?:typeof fetch; endpoint?:(ip:string)=>string|Promise<string>; saveEvidence?:(table:AjesTable,value:any)=>Promise<void>; saveAggregateEvidence?:(kind:string,value:any)=>Promise<void>; readQuery?:(sql:string)=>Promise<any|null>; readLegacyQuery?:(sql:string)=>Promise<any|null>; saveQuery?:(sql:string,value:any)=>Promise<void>; readDetail?:(table:AjesTable,id:string)=>Promise<any|null>; readSavedSearch?:(input:AjesQuery)=>Promise<any|null>; readListedDetail?:(table:AjesTable,id:string)=>Promise<any|null>; saveDetail?:(table:AjesTable,id:string,value:any)=>Promise<void>};
export function createAjesClient(deps:Dependencies) {
  // Only fresh successful results can be reused across visitor addresses.
  const cache=new DetailReadCache<any>({maxEntries:300,maxBytes:8*1024*1024,ttlMs:30*60*1000,concurrency:2,shouldCache:value=>!value.stale});
  // Stored recovery has its own bounded queue. It must neither occupy supplier
  // admission nor promote a visitor's stale result into the shared fresh cache.
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
  const failures=new Map<string,{reason:string;until:number}>();
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
  return {
    async read(input:unknown,clientIp:string) {
      const query=ajesQuery(input,deps.calculationIndex?.()||null);
      if(!isIP(clientIp)) throw new AjesUnavailable('client_ip_missing');
      await deps.assertEnabled(query.table); // Also applies to cache hits after an owner disables the source.
      const password=await deps.password();
      if(!password)throw new AjesUnavailable('not_configured');
      // A valid year interval outside admission policy is known empty, not a failure.
      // Retain visitor and owner-switch checks even when no supplier request is needed.
      if(query.kind!=='detail'&&query.empty)return {schemaVersion:2,items:[],total:0,colors:query.kind==='colors'?[]:undefined,models:query.kind==='models'?[]:undefined,makes:query.kind==='makes'?[]:undefined,page:query.page,pageSize:query.pageSize,received:0,rejected:0,stale:false,observedAt:new Date().toISOString()};
      const visitorKey=clientIp+"\0"+query.sql;
      const quotaKey='quota:'+query.table+((query.kind==='count'||query.kind==='makes')?':count':'');
      const isUsable=(saved:any)=>{const age=Date.now()-Date.parse(saved?.observedAt||'');return age>=0&&age<7*24*60*60*1000&&Array.isArray(saved?.items)&&saved.items.length<=query.pageSize
          &&saved.page===query.page&&saved.pageSize===query.pageSize
          &&(query.kind==='count'?Number.isSafeInteger(saved.total)&&saved.total>=0:query.kind==='colors'?Array.isArray(saved.colors):query.kind==='makes'?Array.isArray(saved.makes):query.kind==='models'?Array.isArray(saved.models):saved.items.every((lot:any)=>lot?.table===query.table&&typeof lot.id==='string'))
          &&(query.kind!=='detail'||(saved.items.length===1&&saved.items[0].id===query.id));};
      const listFallback=async(saved:any)=>{
        const usable=isUsable(saved);
        if(usable&&saved.items.length){await deps.assertEnabled(query.table);return remember({...saved,stale:true});}
        if(!usable&&deps.readLegacyQuery){
          let fallback:any=null;try{fallback=await deps.readLegacyQuery(query.sql);}catch{}
          if(isUsable(fallback)&&fallback.items.length){await deps.assertEnabled(query.table);return remember({...fallback,stale:true});}
        }
        if(query.page===1&&deps.readSavedSearch){
          let fallback:any=null;try{fallback=await deps.readSavedSearch(input as AjesQuery);}catch{}
          if(fallback?.partial&&isUsable(fallback)&&fallback.items.length){await deps.assertEnabled(query.table);return remember({...fallback,stale:true});}
        }
        return null;
      };
      return cache.get(query.sql,async()=>{
        await deps.assertEnabled(query.table); // Recheck after waiting for concurrency slot.
        // Only successful, user-requested responses are retained; never crawl the database.
        let saved:any=null;
        try {saved=query.kind==='detail'?await deps.readDetail?.(query.table,query.id!):await deps.readQuery?.(query.sql);}catch{}
        const age=Date.now()-Date.parse(saved?.observedAt||'');
        const usable=isUsable(saved);
        const currentSchema=query.kind==='count'||query.kind==='models'||query.kind==='makes'||query.kind==='colors'||saved?.schemaVersion===2&&(query.table!=='korea'||query.kind!=='detail'||saved?.fullInformation===true);
        if(usable&&currentSchema&&age<30*60*1000)return query.kind==='list'?remember({...saved,stale:false}):{...saved,stale:false};
        const url=new URL(await deps.endpoint?.(clientIp)||'http://87.242.72.57/api/');
        url.search=new URLSearchParams({ip:clientIp,json:'',code:password,sql:query.sql,...(query.table==='korea'&&query.kind==='detail'?{ajax:''}:{})}).toString();
        let requestStarted=false,httpStatus:number|null=null,providerCode:string|null=null;
        const startedAt=new Date().toISOString();
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),query.table==='korea'&&query.kind==='detail'?45000:20000);
        try {
          const cooldown=cooling(quotaKey)||cooling('visitor:'+clientIp)||cooling(visitorKey);
          if(cooldown)throw new AjesUnavailable(cooldown);
          await deps.reserve(query.table,query.kind);
          requestStarted=true;
          const response=await (deps.fetcher??fetch)(url,{signal:controller.signal,redirect:'error',cache:'no-store'});
          httpStatus=response.status;
          if(!response.ok)throw new AjesUnavailable(response.status===414?'query_too_large':`http_${response.status}`);
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
            if(deps.saveQuery)persist(()=>deps.saveQuery!(query.sql,result));
            return result;
          }
          const items=rows.map(r=>ajesLot(r,query.table,query.kind==='detail')).filter(Boolean);
          const result={schemaVersion:2,...(query.table==='korea'&&query.kind==='detail'?{fullInformation:true}:{}),stale:false,items,page:query.page,pageSize:query.pageSize,received:rows.length,rejected:rows.length-items.length,observedAt:new Date().toISOString(),
            quota:{counter:quotaNumber(response.headers.get('api-counter')),limit:quotaNumber(response.headers.get('api-limit')),remaining:quotaNumber(response.headers.get('api-rest'))}};
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
            const accepted=new Set(items.map((lot:any)=>lot.id));
            const sourceEvidenceById=Object.fromEntries(rows.filter(row=>accepted.has(row.ID)).map(row=>[row.ID,{id:row.ID,observedAt:result.observedAt,fields:['ENG_V','PW','TIME','FUEL'].filter(key=>Object.prototype.hasOwnProperty.call(row,key)),values:Object.fromEntries(['ENG_V','PW','TIME','FUEL'].map(key=>[key,row[key]??null]))}]));
            if(Buffer.byteLength(JSON.stringify(sourceEvidenceById))<=32*1024)(result as any).sourceEvidenceById=sourceEvidenceById;
          }
          // A cache storage outage must not discard a successful provider response.
          if(query.kind==='detail'&&items.length===1&&deps.saveDetail)persist(()=>deps.saveDetail!(query.table,query.id!,result));
          if(query.kind==='list'&&deps.saveQuery)persist(()=>deps.saveQuery!(query.sql,result));

          return query.kind==='list'?remember(result):result;
        }catch(error){
          // Never propagate URLs, provider bodies, credentials or nested fetch causes to logs.
          const recoverable=!(error instanceof AjesUnavailable)||['visitor_restricted','request_failed','request_timeout','connect_timeout','quota_exhausted','quota_busy','invalid_response','empty_response'].includes(error.reason)||/^http_(429|5\d\d)$/.test(error.reason);
          if(error instanceof AjesUnavailable&&recoverable){
            const key=error.reason==='quota_exhausted'?quotaKey:error.reason==='visitor_restricted'?'visitor:'+clientIp:visitorKey;
            // Do not extend an existing cooldown when merely reading the cached failure.
            if(!cooling(key))failures.set(key,{reason:error.reason,until:Date.now()+(error.reason==='visitor_restricted'?300000:30000)});
            while(failures.size>500)failures.delete(failures.keys().next().value!);
          }
          const code=(error as any)?.cause?.code;
          const failure=error instanceof AjesUnavailable?error:new AjesUnavailable(controller.signal.aborted?'request_timeout':code==='UND_ERR_CONNECT_TIMEOUT'?'connect_timeout':'request_failed');
          // Throttle fixed page/kind slots independently: a first-page failure
          // must not suppress continuation evidence. Cooldown is not a request.
          const failureSlot=ajesFailureSlot(query);
          if(requestStarted&&deps.saveRequestFailure&&Date.now()-(lastFailureSaved.get(failureSlot)??0)>=60000){
            lastFailureSaved.set(failureSlot,Date.now());
            const diagnostic:AjesRequestDiagnostic={table:query.table,kind:query.kind,page:query.page,pageSize:query.pageSize,startedAt,finishedAt:new Date().toISOString(),clientIp,sql:query.sql,endpoint:url.origin+url.pathname,httpStatus,providerCode,outcome:failure.reason};
            if(Buffer.byteLength(JSON.stringify(diagnostic))<=64*1024)persist(()=>deps.saveRequestFailure!(diagnostic));
          }
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
            if(query.kind!=='list'&&usable&&(saved.items.length>0||query.kind==='count'||query.kind==='models'||query.kind==='makes'||query.kind==='colors')){await deps.assertEnabled(query.table);return {...saved,stale:true};}
            throw failure;
          });
        }finally{clearTimeout(timer);}
      },visitorKey).then(value=>{
        if(query.table!=='korea'||query.kind!=='detail'||value.stale||value.items?.length!==1)return value;
        const snapshot=listed.get('korea:'+query.id)?.value;
        const age=Date.now()-Date.parse(snapshot?.observedAt||'');
        if(snapshot?.stale||!(age>=0&&age<30*60000)||snapshot.items?.length!==1)return value;
        const item=preserveKoreaListingLink(value.items[0],snapshot.items[0]);
        return item===value.items[0]?value:{...value,items:[item]};
      }).catch(async error=>{
        if(error instanceof AjesSavedRecovery)return visitorCache.get(visitorKey,()=>error.read()).catch(recoveryError=>{
          if(recoveryError instanceof Error&&/^detail_cache_queue_(?:timeout|full)$/.test(recoveryError.message))throw new AjesUnavailable('local_busy');
          throw recoveryError;
        });
        // Admission queue rejection happens outside the provider try/catch.
        // Treat only these bounded local failures as recoverable unavailability;
        // never turn programming/data errors into an empty successful response.
        if(error instanceof Error&&/^detail_cache_queue_(?:timeout|full)$/.test(error.message)){
          // Queue admission failed before persisted rows were read. Recover only
          // bounded saved lists, never call the supplier outside its queue.
          if(query.kind==='list'){
            await deps.assertEnabled(query.table);
            let saved:any=null;try{saved=await deps.readQuery?.(query.sql);}catch{}
            const fallback=await listFallback(saved);if(fallback)return fallback;
          }else if(query.kind==='models'||query.kind==='makes'){
            // Retained directory pages are names, not a fresh inventory count.
            await deps.assertEnabled(query.table);
            let saved:any=null;try{saved=await deps.readQuery?.(query.sql);}catch{}
            if(isUsable(saved)){await deps.assertEnabled(query.table);return {...saved,stale:true};}
          }
          throw new AjesUnavailable('local_busy');
        }
        throw error;
      });
    },
  };
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
