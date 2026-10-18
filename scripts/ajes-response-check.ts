import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {getJsonStorage} from '../apps/web/lib/data';
import {gunzipSync} from 'node:zlib';
import {isIP} from 'node:net';
// Supplier instruction 18 October: genuine server IP for server-origin diagnostics.
// One Moscow request per table, no endpoint rotation or automatic retries.
let stage='start';
async function main(){
 const ip=process.env.AJES_DIAG_IP||'';
 if(!isIP(ip)||ip!=='151.248.113.177')throw Error('server_ip_not_confirmed');
 stage='password';const password=await ajesPassword();if(!password)throw Error('not_configured');
 const storage=getJsonStorage();
 for(const market of ['korea','china'] as const){
  const table=market;
  stage=`${market}:switch`;await assertCollectionEnabled(`ajes_${market}_feed`);
  stage=`${market}:usage`;await reserveAjesRequest(storage,table);
  const sample=await storage.readJson<any>(`integrations/ajes/server-sample-${market}.json`,null);
  const id=String(sample?.rows?.[0]?.ID||'');if(!/^[A-Za-z0-9_-]{1,64}$/.test(id))throw Error('sample_missing');
  const sql=`select * from ${table} where id='${id}'`,endpoint='http://87.242.72.57/api/';
  const diagnostic={market,startedAt:new Date().toISOString(),finishedAt:'',clientIp:ip,sql,endpoint,requestStarted:false,httpStatus:null as number|null,providerCode:null as string|null,outcome:'pending'};
  let summary:Record<string,unknown>={market,table};
  try{
   const url=new URL(endpoint);url.search=new URLSearchParams({ip,json:'',code:password,sql}).toString();
   diagnostic.requestStarted=true;
   const response=await fetch(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
   diagnostic.httpStatus=response.status;
   if(!response.ok){await response.body?.cancel();throw Error(`http_${response.status}`);}
   const reader=response.body?.getReader();if(!reader)throw Error('invalid_response');
   const chunks:Uint8Array[]=[];let size=0;
   while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw Error('response_too_large');}chunks.push(value);}
   const bytes=Buffer.concat(chunks),decoded=bytes[0]===31&&bytes[1]===139?gunzipSync(bytes,{maxOutputLength:2*1024*1024}):bytes;
   const text=decoded.toString('utf8').replace(/^\uFEFF/,'');
   const refusal=decoded.length<=256?text.match(/^\s*((?:bot|ban)\d*)(?:\s|$)/i):null;
   if(refusal){diagnostic.providerCode=refusal[1].toLowerCase();throw Error('provider_restricted');}
   let rows:unknown;try{rows=JSON.parse(text);}catch{throw Error('invalid_response');}
   if(!Array.isArray(rows)||rows.length>5||rows.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error('invalid_response');
   const fields=[...new Set(rows.flatMap(r=>Object.keys(r)))].filter(k=>/^[a-zA-Z0-9_() *-]{1,64}$/.test(k)).slice(0,150);
   const selected=['MONTH','SERIAL','AUCTION_DATE','ID','MARKA_NAME','MODEL_NAME','YEAR','ENG_V','PW','TIME','FUEL','FINISH','PRICE','CURRENCY','KUZOV','MILEAGE','KPP','PRIV','STATUS'];
   const safeRows=rows.map(row=>Object.fromEntries(selected.filter(k=>Object.prototype.hasOwnProperty.call(row,k)).map(k=>[k,typeof row[k]==='string'?row[k].slice(0,256):typeof row[k]==='number'&&Number.isFinite(row[k])?row[k]:null])));
   await storage.writeJson(`integrations/ajes/detail-sample-${market}.json`,{market,observedAt:new Date().toISOString(),received:rows.length,fields,rows:safeRows});
   summary={...summary,received:rows.length,fields,units:{fuel:[...new Set(rows.map(r=>String(r.TIME)).filter(v=>/^[A-Z]{1,3}$/.test(v)))],priceRange:rows.map(r=>Number(r.FINISH)).filter(Number.isFinite),engineRange:rows.map(r=>Number(r.ENG_V)).filter(Number.isFinite),powerSyntax:rows.map(r=>String(r.PW)).filter(v=>/^[0-9,. ]{0,30}$/.test(v)),imageHosts:[...new Set(rows.flatMap(r=>String(r.IMAGES||'').split('#').map(u=>{try{return new URL(u).hostname}catch{return ''}})))],infoKeys:rows.flatMap(r=>{try{return Object.keys(JSON.parse(r.INFO))}catch{return []}})},present:Object.fromEntries(selected.map(k=>[k,rows.filter(r=>r[k]!=null&&String(r[k]).trim()!=='').length]))};
   diagnostic.outcome=rows.length?'success':'empty';
  }catch(error){const message=error instanceof Error?error.message:'';diagnostic.outcome=/^(provider_restricted|invalid_response|response_too_large|http_[1-5]\d\d)$/.test(message)?message:'request_failed';}
  diagnostic.finishedAt=new Date().toISOString();
  await storage.writeJson(`integrations/ajes/server-diagnostic-${market}.json`,diagnostic);
  console.log('AJES_SERVER_CHECK',JSON.stringify({...summary,endpoint,httpStatus:diagnostic.httpStatus,providerCode:diagnostic.providerCode,outcome:diagnostic.outcome,startedAt:diagnostic.startedAt}));
  if(diagnostic.providerCode)break;
 }
}
main().catch(error=>{const reason=error instanceof Error?error.message:'';console.log('AJES_SERVER_CHECK_FAILED',JSON.stringify({stage,reason:['server_ip_not_confirmed','not_configured','ajes_configuration_unavailable','encryption_unavailable','collection_disabled','ajes_quota_invalid','ajes_quota_busy'].includes(reason)?reason:'internal_failure'}));process.exitCode=1;});
