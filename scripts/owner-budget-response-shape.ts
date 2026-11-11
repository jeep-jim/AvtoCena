import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {ajesEndpoint} from '../apps/web/lib/catalog/ajes-routing';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {getJsonStorage} from '../apps/web/lib/data';
import {gunzipSync} from 'node:zlib';
import {isIP} from 'node:net';

async function main(){
 const ip=process.env.AJES_DIAG_IP||'';if(!isIP(ip))throw Error('missing_peer');
 const password=await ajesPassword();if(!password)throw Error('not_configured');
 const endpoint=ajesEndpoint(ip);
 for(const table of ['stats','korea'] as const){
  await assertCollectionEnabled(table==='stats'?'ajes_japan_feed':'ajes_korea_feed');
  const query=ajesQuery({table,pageSize:6});
  await reserveAjesRequest(getJsonStorage(),table);
  const url=new URL(endpoint);url.search=new URLSearchParams({ip,json:'',code:password,sql:query.sql}).toString();
  const start=Date.now();const report:any={table,cluster:new URL(endpoint).hostname==='87.242.72.57'?'russia':'international',at:new Date().toISOString()};
  let refusal=false;
  try{
   const response=await fetch(url,{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
   report.http=response.status;report.contentType=response.headers.get('content-type');report.contentEncoding=response.headers.get('content-encoding');
   const reader=response.body?.getReader();if(!reader)throw Error('empty');
   const chunks:Uint8Array[]=[];let bytes=0;
   while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024){await reader.cancel();throw Error('large');}chunks.push(value);}
   const body=Buffer.concat(chunks);report.bytes=body.length;report.gzip=body[0]===31&&body[1]===139;
   const decoded=report.gzip?gunzipSync(body,{maxOutputLength:2*1024*1024}):body;
   const text=decoded.toString('utf8');report.utf8Bom=text.charCodeAt(0)===0xfeff;
   const clean=text.replace(/^\uFEFF/,'');
   refusal=decoded.length<=256&&/^\s*(?:bot|ban)\d*(?:\s|$)/i.test(clean);report.refusal=refusal;
   report.html=/<(?:!doctype|html|head|body)\b/i.test(clean);report.phpWarning=/<b>\s*(?:Warning|Fatal error|Notice)\b/i.test(clean);
   try{
    const value=JSON.parse(clean);report.json=true;report.rootType=Array.isArray(value)?'array':value===null?'null':typeof value;
    if(Array.isArray(value)){report.rows=value.length;report.objectRows=value.filter(v=>v&&typeof v==='object'&&!Array.isArray(v)).length;report.expectedListingFields=value.map(v=>!!v&&['ID','MARKA_NAME','MODEL_NAME'].every(k=>Object.hasOwn(v,k)));}
   }catch{report.json=false;}
  }catch{report.failed=true;}
  report.ms=Date.now()-start;
  console.log('BUDGET_RESPONSE_SHAPE',JSON.stringify(report));
  if(refusal)break;
 }
}
main().catch(()=>{console.log('BUDGET_RESPONSE_SHAPE_FAILED');process.exitCode=1;});
