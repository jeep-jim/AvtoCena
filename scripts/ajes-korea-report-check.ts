import {gunzipSync} from 'node:zlib';
import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {getJsonStorage} from '../apps/web/lib/data';
// Single current paid-feed sample; no collection, release or changed controls.
async function main(){
 const ip=process.env.AJES_DIAG_IP;if(ip!=='151.248.113.177')throw Error('address');
 const storage=getJsonStorage();await assertCollectionEnabled('ajes_korea_feed');
 const password=await ajesPassword();if(!password)throw Error('not_configured');
 async function body(url:URL){
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(45000)});
  if(!response.ok){await response.body?.cancel();return {status:response.status,text:''};}
  const reader=response.body?.getReader();if(!reader)throw Error('empty');let size=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw Error('large');}chunks.push(value);}
  const bytes=Buffer.concat(chunks),decoded=bytes[0]===31&&bytes[1]===139?gunzipSync(bytes,{maxOutputLength:2*1024*1024}):bytes;
  const text=decoded.toString('utf8').replace(/^\uFEFF/,'');if(/^\s*(?:bot|ban)\d*(?:\s|$)/i.test(text))throw Error('refused');
  return {status:response.status,text};
 }
 async function supplier(sql:string,kind?:string){
  await assertCollectionEnabled('ajes_korea_feed');await reserveAjesRequest(storage,'korea');
  const url=new URL('http://87.242.72.57/api/');url.search=new URLSearchParams({ip,json:'',code:password,sql,...(kind?{[kind]:''}:{})}).toString();
  const r=await body(url);if(r.status!==200)throw Error('supplier_status');return JSON.parse(r.text);
 }
 const samples=[{id:'6izlwQxlgi4gkA',lot:'43015054'},{id:'6izlQCNqaLZtTq',lot:'43015007'}];
 function shape(v:any,d=0):any{return d>7?'...':Array.isArray(v)?{length:v.length,sample:v.slice(0,2).map(x=>shape(x,d+1))}:v&&typeof v==='object'?Object.fromEntries(Object.entries(v).slice(0,100).map(([k,x])=>[k,shape(x,d+1)])):typeof v==='string'?(/^https?:\/\//.test(v)?{type:'url',host:new URL(v).hostname}:`string(${v.length})`):v;}
 if(process.env.AJES_REPORT_SAVED_ONLY==='1'){
  for(const {id,lot} of samples)for(const kind of ['history','inspection','ajax']){
   const saved=await storage.readJson<any>(`integrations/ajes/report-current-${id}-${kind}.json`,null);
   if(saved?.id!==id||saved?.lot!==lot||typeof saved.body!=='string')throw Error('saved_identity');
   const value=JSON.parse(saved.body),info=value?.[0]?.INFO;
   console.log('KOREA_SAVED_REPORT',JSON.stringify({id,lot,kind,observedAt:saved.observedAt,shape:shape(value),description:kind==='ajax'?(info==='LOT REMOVED'?'removed':typeof info==='string'&&/^(?:NO[ _-]?INFO|NO[ _-]?DATA|NOT[ _-]?FOUND|INFO[ _-]?ERROR)[ !.]*$/i.test(info)?'unavailable':typeof info==='string'&&info.trim()?'present_unclassified':'empty'):undefined}));
  }
  return;
 }
 for(const {id,lot} of samples){
 const current=await supplier(`select * from korea where id='${id}'`);
 if(current?.length!==1||current[0]?.ID!==id||String(current[0]?.LOT)!==lot)throw Error('identity');
 console.log('KOREA_CURRENT_ID',JSON.stringify({id,lot,fields:Object.keys(current[0]),statusPresent:typeof current[0].STATUS==='string'&&current[0].STATUS.length>0}));
 for(const kind of ['history','inspection','ajax']){
  const value=await supplier(`select * from korea where id='${id}'`,kind);
  await storage.writeJson(`integrations/ajes/report-current-${id}-${kind}.json`,{id,lot,observedAt:new Date().toISOString(),body:JSON.stringify(value)});
  console.log('KOREA_CURRENT_REPORT',JSON.stringify({kind,shape:shape(value),removed:kind==='ajax'?value?.[0]?.INFO==='LOT REMOVED':undefined}));
 }
 }
 // Encar denied automated access in the browser. Do not probe alternate routes.

}
main().catch(()=>{console.log('KOREA_REPORT_CHECK_FAILED');process.exitCode=1;});
