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
 const rows=await supplier('select * from korea order by auction_date desc limit 1');
 const id=rows?.[0]?.ID,lot=String(rows?.[0]?.LOT||'');if(!/^[A-Za-z0-9_-]{1,64}$/.test(id)||!/^\d{6,10}$/.test(lot))throw Error('identity');
 console.log('KOREA_CURRENT_ID',JSON.stringify({id,lot}));
 function shape(v:any,d=0):any{return d>7?'...':Array.isArray(v)?{length:v.length,sample:v.slice(0,2).map(x=>shape(x,d+1))}:v&&typeof v==='object'?Object.fromEntries(Object.entries(v).slice(0,100).map(([k,x])=>[k,shape(x,d+1)])):typeof v==='string'?`string(${v.length})`:v;}
 for(const kind of ['history','inspection','ajax']){
  const value=await supplier(`select * from korea where id='${id}'`,kind);
  await storage.writeJson(`integrations/ajes/report-current-${kind}.json`,{id,lot,observedAt:new Date().toISOString(),body:JSON.stringify(value)});
  console.log('KOREA_CURRENT_REPORT',JSON.stringify({kind,shape:shape(value),removed:kind==='ajax'?value?.[0]?.INFO==='LOT REMOVED':undefined}));
 }
 // Public report routes used by the pages the supplier links. No credentials or bypass.
 for(const [kind,path] of [['history',`/v1/readside/record/vehicle/${lot}/summary`],['inspection',`/v1/readside/inspection/vehicle/${lot}`]]){
  const r=await body(new URL(path,'https://api.encar.com'));
  if([401,403,429].includes(r.status)){console.log('KOREA_PUBLIC_REFUSED',{kind,status:r.status});break;}
  await storage.writeJson(`integrations/ajes/report-current-public-${kind}.json`,{id,lot,observedAt:new Date().toISOString(),status:r.status,body:r.text});
  let value:any;try{value=JSON.parse(r.text);}catch{value=null;}
  console.log('KOREA_PUBLIC_REPORT',JSON.stringify({kind,status:r.status,bytes:r.text.length,shape:shape(value)}));
 }
}
main().catch(()=>{console.log('KOREA_REPORT_CHECK_FAILED');process.exitCode=1;});
