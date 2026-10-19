import {getJsonStorage} from '../apps/web/lib/data';
import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {gunzipSync} from 'node:zlib';
// Owner-requested exact-record inspection. No publication or retries; credentials stay on server.
function decode(s:string){
 return s.replace(/\\\//g,'/').replace(/\\u([0-9a-f]{4})/gi,(_,h)=>String.fromCharCode(parseInt(h,16))).replace(/&#(x[0-9a-f]+|\d+);?/gi,(_,v)=>{const n=v[0].toLowerCase()==='x'?parseInt(v.slice(1),16):Number(v);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';}).replace(/&amp;/gi,'&').replace(/&quot;/gi,'"').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>');
}
function inspect(value:unknown){
 const s=typeof value==='string'?value:JSON.stringify(value??null),decoded=decode(s);
 const candidates=[{encoding:'text',text:decoded}];
 if(s.length>16&&s.length<200000&&/^[A-Za-z0-9+/=\r\n]+$/.test(s)){
  const b=Buffer.from(s,'base64');
  try{candidates.push({encoding:b[0]===31&&b[1]===139?'base64-gzip':'base64',text:decode((b[0]===31&&b[1]===139?gunzipSync(b,{maxOutputLength:1024*1024}):b).toString('utf8'))});}catch{}
 }
 const links=candidates.flatMap(c=>[...c.text.matchAll(/(?:https?:)?\/\/[^\s<>"']+/g)].map(m=>{
  try{const u=new URL(m[0].startsWith('//')?'https:'+m[0]:m[0]);if(!/(^|\.)(encar\.com|kcar\.com|che168\.com|autohome\.com\.cn|kbchachacha\.com|bobaedream\.co\.kr|dongchedi\.com)$/.test(u.hostname))return null;
  return {encoding:c.encoding,host:u.hostname,path:u.pathname,query:Object.fromEntries([...u.searchParams].filter(([k,v])=>/^(carid|carId|id|i_sCarCd|carNo)$/i.test(k)&&/^[a-z0-9_-]{1,64}$/i.test(v)))};
  }catch{return null;}
 })).filter(Boolean);
 return {length:s.length,encodings:candidates.map(c=>c.encoding),links,tags:[...decoded.matchAll(/<\/?([a-z][a-z0-9]*)/gi)].map(m=>m[1]).slice(0,8)};
}
async function main(){
 const storage=getJsonStorage(),ip=process.env.AJES_DIAG_IP;
 if(ip!=='151.248.113.177')throw Error('server_ip_not_confirmed');
 const targets:Array<{market:'china'|'korea';id:string}>=[{market:'korea',id:'6bucknsm0H1rhz'}];
 for(const token of ['AME39AhA3_nkA0rT','GgabHBpFJ9vgLYJ0']){
  const share:any=await storage.readJson('public-share-links/'+token.slice(0,2)+'/'+token+'.json',null);
  if(!share?.path){console.log('PRICE_SHARE',JSON.stringify({token,found:false}));continue;}
  const u=new URL(share.path,'https://avtocena.com'),id=u.pathname.split('/').at(-1)||'';
  console.log('PRICE_SHARE',JSON.stringify({token,found:true,offerId:id,calculation:u.searchParams.get('calculation')}));
  if(/^ajes-china-[A-Za-z0-9_-]+$/.test(id)){
   const sourceId=id.slice('ajes-china-'.length);
   const cached:any=await storage.readJson('catalog/partner-cache/ajes/china/'+sourceId+'.json',null),lot=cached?.items?.[0];
   console.log('PRICE_SAVED',JSON.stringify({offerId:id,found:!!lot,observedAt:cached?.observedAt,price:lot?.sourcePrice,currency:lot?.currency,make:lot?.make,model:lot?.model,year:lot?.year}));
   targets.push({market:'china',id:sourceId});
  }
 }
 const password=await ajesPassword();if(!password)throw Error('not_configured');
 for(const {market,id} of targets){
  await assertCollectionEnabled('ajes_'+market+'_feed');await reserveAjesRequest(storage,market);
  const url=new URL('http://87.242.72.57/api/');url.search=new URLSearchParams({ip,json:'',code:password,sql:"select * from "+market+" where id='"+id+"'"}).toString();
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(45000)});
  if(!response.ok){await response.body?.cancel();throw Error('http_'+response.status);}
  const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2*1024*1024){await reader.cancel();throw Error('response_too_large');}chunks.push(value);}
  const bytes=Buffer.concat(chunks),body=(bytes[0]===31&&bytes[1]===139?gunzipSync(bytes,{maxOutputLength:2*1024*1024}):bytes).toString('utf8');
  if(body.length<=256&&/^\s*(bot|ban)\d*(?:\s|$)/i.test(body))throw Error('visitor_restricted');
  let parsed:any;try{parsed=JSON.parse(body);}catch{throw Error('invalid_json');}
  const row=Array.isArray(parsed)?parsed[0]:parsed;if(!row||String(row.ID)!==id)throw Error('identity_mismatch');
  const fields=Object.keys(row).filter(k=>/^[A-Za-z0-9_]{1,64}$/.test(k));
  const linkFields=Object.fromEntries(fields.filter(k=>k!=='IMAGES').map(k=>[k,inspect(row[k])]).filter(([k,v])=>k==='INFO'||(v as any).links.length));
  const prices=Object.fromEntries(['FINISH','START','PRICE','AVG_PRICE'].filter(k=>Object.hasOwn(row,k)).map(k=>[k,/^\d+(?:\.\d+)?$/.test(String(row[k]))?Number(row[k]):null]));
  console.log('EXACT_SOURCE_CHECK',JSON.stringify({market,id,fields,prices,linkFields}));
 }
}
main().catch(e=>{const reason=String(e?.message||'');console.log('EXACT_SOURCE_CHECK_FAILED',/^(server_ip_not_confirmed|not_configured|visitor_restricted|identity_mismatch|invalid_json|response_too_large|http_\d{3}|collection_disabled)$/.test(reason)?reason:'operation_failed');process.exitCode=1;});
