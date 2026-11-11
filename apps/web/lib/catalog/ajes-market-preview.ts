import {isIP} from 'node:net';
import {gunzipSync} from 'node:zlib';
export type AjesPreviewMarket='china'|'korea';
export type AjesPreviewDiagnostic={market:AjesPreviewMarket;startedAt:string;finishedAt:string;clientIp:string;sql:string;endpoint:string;requestStarted:boolean;httpStatus:number|null;providerCode:string|null;outcome:string};
export class AjesPreviewError extends Error {
 constructor(reason:string,readonly diagnostic:AjesPreviewDiagnostic){super(reason);}
}
export function ajesPreviewMarket(value:unknown):AjesPreviewMarket {
 if(value!=='china'&&value!=='korea')throw Error('invalid_market');
 return value;
}
const fields=['ID','MARKA_NAME','MODEL_NAME','YEAR','ENG_V','PW','TIME','FUEL','FINISH','PRICE','CURRENCY','KUZOV','MILEAGE','KPP','PRIV','STATUS'];
export type AjesMarketPreview={market:AjesPreviewMarket;observedAt:string;received:number;fields:string[];rows:Record<string,string|number|null>[]};
type Dependencies={password:()=>Promise<string|undefined>;assertEnabled:(market:AjesPreviewMarket)=>Promise<void>;reserve:(market:AjesPreviewMarket)=>Promise<void>;read:(market:AjesPreviewMarket)=>Promise<AjesMarketPreview|null>;save:(market:AjesPreviewMarket,value:AjesMarketPreview)=>Promise<unknown>;saveDiagnostic?:(market:AjesPreviewMarket,value:AjesPreviewDiagnostic)=>Promise<unknown>;endpoint?:(ip:string)=>string;fetcher?:typeof fetch};
/** Owner-only schema inspection; no publication, price conversion or invented units. */
export function createAjesMarketPreview(deps:Dependencies){
 const failures=new Map<string,number>();
 const pending=new Map<string,Promise<AjesMarketPreview>>();
 return async function preview(value:unknown,clientIp:string):Promise<AjesMarketPreview>{
  const market=ajesPreviewMarket(value);
  if(!isIP(clientIp))throw Error('client_ip_missing');
  await deps.assertEnabled(market);
  const password=await deps.password();if(!password)throw Error('not_configured');
  const cached=await deps.read(market);
  const age=Date.now()-Date.parse(cached?.observedAt||'');
  if(cached?.market===market&&age>=0&&age<30*60000)return cached;
  if((failures.get(clientIp)||0)>Date.now())throw Error('preview_cooldown');
  const key=market+'\0'+clientIp;
  const existing=pending.get(key);if(existing)return existing;
  const task=(async()=>{
   const diagnostic:AjesPreviewDiagnostic={market,startedAt:new Date().toISOString(),finishedAt:'',clientIp,sql:`select * from ${market} limit 5`,endpoint:deps.endpoint?.(clientIp)||'http://87.242.72.57/api/',requestStarted:false,httpStatus:null,providerCode:null,outcome:'pending'};
   async function record(outcome:string){
    diagnostic.outcome=outcome;diagnostic.finishedAt=new Date().toISOString();
    // Private, owner-only last result. Never retain response bodies or credential-bearing URLs.
    try{await deps.saveDiagnostic?.(market,{...diagnostic});}catch{/* Preserve the original result even if diagnostic storage is unavailable. */}
   }
   try{
    await deps.assertEnabled(market);await deps.reserve(market);
    const url=new URL(diagnostic.endpoint);
    url.search=new URLSearchParams({ip:clientIp,json:'',code:password,sql:`select * from ${market} limit 5`}).toString();
    diagnostic.requestStarted=true;
    const response=await (deps.fetcher||fetch)(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
    diagnostic.httpStatus=response.status;
    if(!response.ok){await response.body?.cancel();throw Error(`http_${response.status}`);}
    const reader=response.body?.getReader();if(!reader)throw Error('invalid_response');
    const chunks:Uint8Array[]=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw Error('response_too_large');}chunks.push(value);}
    const bytes=Buffer.concat(chunks),decoded=bytes[0]===0x1f&&bytes[1]===0x8b?gunzipSync(bytes,{maxOutputLength:2*1024*1024}):bytes;
    const text=decoded.toString('utf8');
    const bot=decoded.length<=256?text.match(/^\s*((?:bot|ban)\d*)(?:\s|$)/i):null;
    if(bot){diagnostic.providerCode=bot[1].toLowerCase();throw Error('visitor_restricted');}
    let rows:unknown;try{rows=JSON.parse(text);}catch{throw Error('invalid_response');}
    if(!Array.isArray(rows)||rows.length>5||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('invalid_response');
    const result:AjesMarketPreview={market,observedAt:new Date().toISOString(),received:rows.length,
     fields:[...new Set(rows.flatMap(r=>Object.keys(r)))].filter(k=>/^[a-zA-Z0-9_() *-]{1,64}$/.test(k)).slice(0,100),
     rows:rows.map(row=>Object.fromEntries(fields.filter(k=>Object.prototype.hasOwnProperty.call(row,k)).map(k=>{
      const v=row[k];return [k,typeof v==='number'&&Number.isFinite(v)?v:typeof v==='string'?v.slice(0,256):null];
     })))};
    await deps.assertEnabled(market);
    await deps.save(market,result);await record(rows.length?'success':'empty');return result;
   }catch(error){
    // Never expose upstream URLs, response bodies, contacts or the API password.
    failures.set(clientIp,Date.now()+5*60000);while(failures.size>100)failures.delete(failures.keys().next().value!);
    const reason=(error as any)?.reason|| (error instanceof Error?error.message:'');
    const safeReason=['quota_exhausted','quota_busy','quota_invalid','visitor_restricted','not_configured','client_ip_missing','invalid_response','response_too_large'].includes(reason)||/^http_[1-5]\d\d$/.test(reason)?reason:error instanceof Error&&error.name==='TimeoutError'?'request_timeout':'preview_unavailable';
    await record(safeReason);
    throw new AjesPreviewError(safeReason,{...diagnostic});
   }finally{pending.delete(key);}
  })();
  pending.set(key,task);return task;
 };
}
