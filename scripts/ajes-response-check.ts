import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {createAjesClient,AjesUnavailable} from '../apps/web/lib/catalog/ajes-client';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {getJsonStorage} from '../apps/web/lib/data';
import {gunzipSync} from 'node:zlib';
import {isIP} from 'node:net';
async function main(){
 const ip=process.env.AJES_DIAG_IP||'';if(!isIP(ip))throw Error();
 const client=createAjesClient({password:ajesPassword,assertEnabled:()=>assertCollectionEnabled('ajes_japan_feed'),reserve:t=>reserveAjesRequest(getJsonStorage(),t),fetcher:async(...args)=>{
  const r=await fetch(...args),reader=r.clone().body!.getReader();const chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw Error();}chunks.push(value);}
  let b=Buffer.concat(chunks);const gzip=b[0]===31&&b[1]===139;if(gzip)b=gunzipSync(b,{maxOutputLength:2*1024*1024});
  const s=b.toString('utf8');let value:unknown,validJson=false;try{value=JSON.parse(s);validJson=true;}catch{}
  const marker=s.trimStart().match(/^bot(\d{0,3})(?=\s|$)/i);
  console.log('AJES_RESPONSE_SHAPE',JSON.stringify({status:r.status,bytes:b.length,gzip,validJson,array:Array.isArray(value),rows:Array.isArray(value)?value.length:null,bom:s.charCodeAt(0)===65279,html:/^\s*<(?:!doctype|html)/i.test(s),bot:marker?'bot'+marker[1]:null,productionBotMatch:b.length<=256&&/^bot\d*\s/i.test(s)}));
  return r;
 }});
 for(const [name,query]of [['minimal',{table:'stats',pageSize:1}],['catalog',{table:'stats',make:'HONDA',pageSize:24}]] as const){
  try{const r=await client.read(query,ip);console.log('AJES_RESULT',JSON.stringify({name,ok:true,received:r.received,accepted:r.items.length,rejected:r.rejected}));}
  catch(e){const allowed=['visitor_restricted','invalid_response','not_configured','client_ip_missing','request_failed','request_timeout','connect_timeout','quota_exhausted','quota_invalid','quota_busy'];console.log('AJES_RESULT',JSON.stringify({name,ok:false,reason:e instanceof AjesUnavailable&&allowed.includes(e.reason)?e.reason:'check_failed'}));}
 }
}
main().catch(()=>{console.log('AJES_CHECK_FAILED');process.exitCode=1;});
