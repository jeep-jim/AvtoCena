import {gunzipSync} from 'node:zlib';
import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {getJsonStorage} from '../apps/web/lib/data';
// One owner-selected vehicle, three sequential requests. No collection or deployment.
async function main(){
 const ip=process.env.AJES_DIAG_IP;if(ip!=='151.248.113.177')throw Error('address');
 const storage=getJsonStorage(),id='6iz93V3W4idxXQ';
 await assertCollectionEnabled('ajes_korea_feed');
 const password=await ajesPassword();if(!password)throw Error('not_configured');
 for(const kind of ['history','inspection','ajax']){
  await assertCollectionEnabled('ajes_korea_feed');await reserveAjesRequest(storage,'korea');
  const url=new URL('http://87.242.72.57/api/');url.search=new URLSearchParams({ip,json:'',code:password,sql:`select * from korea where id='${id}'`,[kind]:''}).toString();
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(45000)});
  if(!response.ok){await response.body?.cancel();console.log('KOREA_REPORT',{kind,status:response.status});continue;}
  const reader=response.body?.getReader();if(!reader)throw Error('empty');let size=0;const chunks:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw Error('large');}chunks.push(value);}
  const bytes=Buffer.concat(chunks),decoded=bytes[0]===31&&bytes[1]===139?gunzipSync(bytes,{maxOutputLength:2*1024*1024}):bytes;
  const body=decoded.toString('utf8').replace(/^\uFEFF/,'');if(/^\s*(?:bot|ban)\d*(?:\s|$)/i.test(body)){console.log('KOREA_REPORT_REFUSED',{kind});break;}
  // The commercial body remains private. Public log contains field structure and labels only.
  await storage.writeJson(`integrations/ajes/report-sample-${kind}.json`,{id,observedAt:new Date().toISOString(),body});
  let json:any=null;try{json=JSON.parse(body);}catch{}
  const shape=(v:any,depth=0):any=>depth>5?'...':Array.isArray(v)?{array:v.length,sample:v.slice(0,2).map(x=>shape(x,depth+1))}:v&&typeof v==='object'?Object.fromEntries(Object.entries(v).slice(0,100).map(([k,x])=>[k,shape(x,depth+1)])):typeof v==='string'?`string(${v.length})`:typeof v;
  const tags=[...body.matchAll(/<([a-z][a-z0-9]*)\b/gi)].map(x=>x[1].toLowerCase());
  const labels=[...body.matchAll(/<(?:th|dt|label|h[1-6])\b[^>]*>([\s\S]*?)<\/(?:th|dt|label|h[1-6])>/gi)].map(x=>x[1].replace(/<[^>]*>/g,' ').trim()).filter(x=>x.length<100&&!/https?:|@|\d{3}/.test(x)).slice(0,100);
  console.log('KOREA_REPORT',JSON.stringify({kind,bytes:decoded.length,contentType:response.headers.get('content-type'),shape:json===null?null:shape(json),tags:[...new Set(tags)],labels}));
 }
}
main().catch(()=>{console.log('KOREA_REPORT_CHECK_FAILED');process.exitCode=1;});
