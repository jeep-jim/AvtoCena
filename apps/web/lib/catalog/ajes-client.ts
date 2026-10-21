import {isIP} from 'node:net';
import {gunzipSync} from 'node:zlib';
import {DetailReadCache} from './detail-read-cache';
import {ajesQuery,ajesLot,type AjesTable,type AjesQuery} from './ajes-query';

export class AjesUnavailable extends Error {constructor(public reason:string){super(`ajes_${reason}`);}}
type Dependencies={password:()=>string|undefined|Promise<string|undefined>; assertEnabled:(table?:AjesTable)=>Promise<void>; reserve:(table:AjesTable,kind?:string)=>Promise<void>; fetcher?:typeof fetch; endpoint?:(ip:string)=>string|Promise<string>; saveEvidence?:(table:AjesTable,value:any)=>Promise<void>; saveAggregateEvidence?:(kind:string,value:any)=>Promise<void>; readQuery?:(sql:string)=>Promise<any|null>; saveQuery?:(sql:string,value:any)=>Promise<void>; readDetail?:(table:AjesTable,id:string)=>Promise<any|null>; readSavedSearch?:(input:AjesQuery)=>Promise<any|null>; readListedDetail?:(table:AjesTable,id:string)=>Promise<any|null>; saveDetail?:(table:AjesTable,id:string,value:any)=>Promise<void>};
export function createAjesClient(deps:Dependencies) {
  // Only fresh successful results can be reused across visitor addresses.
  const cache=new DetailReadCache<any>({maxEntries:300,maxBytes:8*1024*1024,ttlMs:30*60*1000,concurrency:2,shouldCache:value=>!value.stale});
  // Refusals may retain an old card for this visitor, but must not poison others.
  const visitorCache=new DetailReadCache<any>({maxEntries:300,maxBytes:8*1024*1024,ttlMs:30*1000,concurrency:2});
  // Bounded snapshots of rows the visitor already saw, not fabricated full details.
  const listed=new Map<string,{value:any;bytes:number}>();let listedBytes=0;
  const failures=new Map<string,{reason:string;until:number}>();
  const remember=(value:any)=>{
    for(const lot of value.items||[]){
      const key=lot.table+':'+lot.id,snapshot={schemaVersion:value.schemaVersion,items:[lot],page:1,pageSize:1,observedAt:value.observedAt,partial:true};
      const bytes=Buffer.byteLength(JSON.stringify(snapshot));if(bytes>64*1024)continue;
      listedBytes-=listed.get(key)?.bytes||0;listed.delete(key);listed.set(key,{value:snapshot,bytes});listedBytes+=bytes;
      while(listed.size>600||listedBytes>4*1024*1024){const oldest=listed.keys().next().value!;listedBytes-=listed.get(oldest)!.bytes;listed.delete(oldest);}
    }
    return value;
  };
  const cooling=(key:string)=>{const value=failures.get(key);if(value&&value.until>Date.now())return value.reason;failures.delete(key);return null;};
  return {
    async read(input:unknown,clientIp:string) {
      const query=ajesQuery(input);
      if(!isIP(clientIp)) throw new AjesUnavailable('client_ip_missing');
      await deps.assertEnabled(query.table); // Also applies to cache hits after an owner disables the source.
      const password=await deps.password();
      if(!password)throw new AjesUnavailable('not_configured');
      // A valid year interval outside admission policy is known empty, not a failure.
      // Retain visitor and owner-switch checks even when no supplier request is needed.
      if(query.kind!=='detail'&&query.empty)return {schemaVersion:2,items:[],total:0,colors:query.kind==='colors'?[]:undefined,models:query.kind==='models'?[]:undefined,makes:query.kind==='makes'?[]:undefined,page:query.page,pageSize:query.pageSize,received:0,rejected:0,stale:false,observedAt:new Date().toISOString()};
      const visitorKey=clientIp+"\0"+query.sql;
      const quotaKey='quota:'+query.table+((query.kind==='count'||query.kind==='makes')?':count':'');
      return cache.get(query.sql,()=>visitorCache.get(visitorKey,async()=>{
        await deps.assertEnabled(query.table); // Recheck after waiting for concurrency slot.
        // Only successful, user-requested responses are retained; never crawl the database.
        let saved:any=null;
        try {saved=query.kind==='detail'?await deps.readDetail?.(query.table,query.id!):await deps.readQuery?.(query.sql);}catch{}
        const age=Date.now()-Date.parse(saved?.observedAt||'');
        const usable=age>=0&&age<7*24*60*60*1000&&Array.isArray(saved?.items)&&saved.items.length<=query.pageSize
          &&saved.page===query.page&&saved.pageSize===query.pageSize
          &&(query.kind==='count'?Number.isSafeInteger(saved.total)&&saved.total>=0:query.kind==='colors'?Array.isArray(saved.colors):query.kind==='makes'?Array.isArray(saved.makes):query.kind==='models'?Array.isArray(saved.models):saved.items.every((lot:any)=>lot?.table===query.table&&typeof lot.id==='string'))
          &&(query.kind!=='detail'||(saved.items.length===1&&saved.items[0].id===query.id));
        const currentSchema=query.kind==='count'||query.kind==='models'||query.kind==='makes'||query.kind==='colors'||saved?.schemaVersion===2&&(query.table!=='korea'||query.kind!=='detail'||saved?.fullInformation===true);
        if(usable&&currentSchema&&age<30*60*1000)return query.kind==='list'?remember({...saved,stale:false}):{...saved,stale:false};
        const url=new URL(await deps.endpoint?.(clientIp)||'http://87.242.72.57/api/');
        url.search=new URLSearchParams({ip:clientIp,json:'',code:password,sql:query.sql,...(query.table==='korea'&&query.kind==='detail'?{ajax:''}:{})}).toString();
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),query.table==='korea'&&query.kind==='detail'?45000:20000);
        try {
          const cooldown=cooling(quotaKey)||cooling('visitor:'+clientIp)||cooling(visitorKey);
          if(cooldown)throw new AjesUnavailable(cooldown);
          await deps.reserve(query.table,query.kind);
          const response=await (deps.fetcher??fetch)(url,{signal:controller.signal,redirect:'error',cache:'no-store'});
          if(!response.ok)throw new AjesUnavailable(`http_${response.status}`);
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
            if(decoded.length<=256&&/^\s*(?:bot|ban)\d*(?:\s|$)/i.test(decoded.toString('utf8')))throw new AjesUnavailable('visitor_restricted');
            rows=JSON.parse(decoded.toString('utf8'));
          }catch(error){if(error instanceof AjesUnavailable)throw error;throw new AjesUnavailable('invalid_response');}
          if(query.kind==='count'||query.kind==='models'||query.kind==='makes'||query.kind==='colors'){
            const first=Array.isArray(rows)?rows[0]:rows;
            try{await deps.saveAggregateEvidence?.(query.kind,{observedAt:new Date().toISOString(),array:Array.isArray(rows),length:Array.isArray(rows)?rows.length:null,fields:first&&typeof first==='object'?Object.keys(first).slice(0,30):[],numeric:first&&typeof first==='object'?Object.fromEntries(Object.entries(first).filter(([k,v])=>/^(?:total|count(?:\(\*\))?|tag[012])$/i.test(k)&&/^\d+$/.test(String(v)))):{}});}catch{}
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
            try{await deps.saveQuery?.(query.sql,result);}catch{}
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
            try{if(Buffer.byteLength(JSON.stringify(evidence))<=64*1024)await deps.saveEvidence?.(query.table,evidence);}catch{}
          }
          if(query.kind==='list'){
            const accepted=new Set(items.map((lot:any)=>lot.id));
            const sourceEvidenceById=Object.fromEntries(rows.filter(row=>accepted.has(row.ID)).map(row=>[row.ID,{id:row.ID,observedAt:result.observedAt,fields:['ENG_V','PW','TIME','FUEL'].filter(key=>Object.prototype.hasOwnProperty.call(row,key)),values:Object.fromEntries(['ENG_V','PW','TIME','FUEL'].map(key=>[key,row[key]??null]))}]));
            if(Buffer.byteLength(JSON.stringify(sourceEvidenceById))<=32*1024)(result as any).sourceEvidenceById=sourceEvidenceById;
          }
          // A cache storage outage must not discard a successful provider response.
          try {
            if(query.kind==='detail'&&items.length===1)await deps.saveDetail?.(query.table,query.id!,result);
            if(query.kind==='list')await deps.saveQuery?.(query.sql,result);
          }catch{}

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
          if(query.kind==='detail'&&!usable&&recoverable){
            let fallback=listed.get(query.table+':'+query.id)?.value;
            if(!fallback)try{fallback=await deps.readListedDetail?.(query.table,query.id!);}catch{}
            const fallbackAge=Date.now()-Date.parse(fallback?.observedAt||'');
            if(fallbackAge>=0&&fallbackAge<7*86400000&&fallback?.items?.length===1&&fallback.items[0].id===query.id&&fallback.items[0].table===query.table){await deps.assertEnabled(query.table);return {...fallback,partial:true,stale:true};}
          }
          if(usable&&(saved.items.length>0||query.kind==='count'||query.kind==='models'||query.kind==='makes'||query.kind==='colors')&&recoverable){await deps.assertEnabled(query.table);return query.kind==='list'?remember({...saved,stale:true}):{...saved,stale:true};}
          if(query.kind==='list'&&query.page===1&&recoverable&&deps.readSavedSearch){
            let fallback:any=null;
            try{fallback=await deps.readSavedSearch(input as AjesQuery);}catch{}
            if(fallback?.partial&&fallback.items?.length){await deps.assertEnabled(query.table);return remember({...fallback,stale:true});}
          }
          if(error instanceof AjesUnavailable)throw error;
          const code=(error as any)?.cause?.code;
          const reason=controller.signal.aborted?'request_timeout':code==='UND_ERR_CONNECT_TIMEOUT'?'connect_timeout':'request_failed';
          throw new AjesUnavailable(reason);
        }finally{clearTimeout(timer);}
      }),visitorKey);
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
