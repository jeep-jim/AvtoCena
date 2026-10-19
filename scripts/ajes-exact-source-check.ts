import {getJsonStorage} from '../apps/web/lib/data';
import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {createHash} from 'node:crypto';
import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
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
 const targets:Array<{market:'china'|'korea'|'stats';id:string;ajax?:boolean}>=[];
 for(const token of ['AME39AhA3_nkA0rT','GgabHBpFJ9vgLYJ0']){
  const share:any=await storage.readJson('public-share-links/'+token.slice(0,2)+'/'+token+'.json',null);
  if(!share?.path){console.log('PRICE_SHARE',JSON.stringify({token,found:false}));continue;}
  const u=new URL(share.path,'https://avtocena.com'),slug=u.pathname.split('/').at(-1)||'',id=slug.includes('--')?slug.split('--').at(-1)!:slug;
  const version=u.searchParams.get('calculation');if(version&&/^[a-f0-9-]{36}$/.test(version)){const record:any=await storage.readJson('offer-calculation-scenarios/'+createHash('sha256').update(id).digest('hex')+'/'+version+'.json',null); console.log('PRICE_ARCHIVE',JSON.stringify({id,found:!!record,savedAt:record?.savedAt,currencyRate:record?.calculation?.currencyRate,totalRub:record?.calculation?.totalRub}));}
  console.log('PRICE_SHARE',JSON.stringify({token,found:true,offerId:id,calculation:u.searchParams.get('calculation')}));
  if(/^ajes-china-[A-Za-z0-9_-]+$/.test(id)){
   const sourceId=id.slice('ajes-china-'.length);
   const cached:any=await storage.readJson('catalog/partner-cache/ajes/china/'+sourceId+'.json',null),lot=cached?.items?.[0];
   console.log('PRICE_SAVED',JSON.stringify({offerId:id,found:!!lot,observedAt:cached?.observedAt,price:lot?.sourcePrice,currency:lot?.currency,make:lot?.make,model:lot?.model,year:lot?.year,originalLot:lot?.lot,sourceTemplate:lot?.status,mileage:lot?.mileageKm,trim:lot?.trim,technical:{power:lot?.sourcePower,engine:lot?.engineCc,fuel:lot?.sourceFuel}}));
   // Exact China response was already inspected; use its retained technical fields here.
  }
 }
 const client=createAjesClient({password:ajesPassword,assertEnabled:t=>assertCollectionEnabled('ajes_'+(t==='stats'?'japan':t)+'_feed'),reserve:t=>reserveAjesRequest(storage,t)});
 const korea=await client.read({table:'korea',fuel:'petrol',pageSize:2},ip);
 for(const lot of korea.items){console.log('KOREA_LIST_FIELDS',JSON.stringify({id:lot.id,make:lot.make,model:lot.model,year:lot.year,engineCc:lot.engineCc,power:lot.sourcePower,fuel:lot.sourceFuel,transmission:lot.sourceTransmission,drive:lot.sourceDrive,productionMonth:lot.productionMonth}));targets.push({market:'korea',id:lot.id,ajax:true});}
 const password=await ajesPassword();if(!password)throw Error('not_configured');
 for(const {market,id,ajax} of targets){
  await assertCollectionEnabled('ajes_'+(market==='stats'?'japan':market)+'_feed');await reserveAjesRequest(storage,market);
  const url=new URL('http://87.242.72.57/api/');url.search=new URLSearchParams({ip,json:'',code:password,sql:"select * from "+market+" where id='"+id+"'"}).toString();
  if(ajax)url.searchParams.set('ajax','');
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
  const technical=Object.fromEntries(['LOT','YEAR','MONTH','ENG_V','PW','TIME','FUEL','KPP','KPP_TYPE','PRIV','MILEAGE','GRADE','KUZOV'].map(k=>[k,typeof row[k]==='string'?row[k].slice(0,200):typeof row[k]==='number'?row[k]:null]));
  const status=String(row.STATUS||'');let sourceUrl:string|undefined;try{const u=new URL(decode(status));if(/(^|\.)(encar\.com|che168\.com)$/.test(u.hostname)&&!u.username&&!u.password&&![...u.searchParams.keys()].some(k=>/code|token|password|key/i.test(k)))sourceUrl=u.href;}catch{}
  let infoSummary:any={};try{const info=JSON.parse(String(row.INFO||''));infoSummary={keys:Object.keys(info).slice(0,100),numeric:Object.fromEntries(Object.entries(info).filter(([k,v])=>/power|engine|fuel|cc|kw|hp|year|month|body|drive|transmission|출력|배기|연료|马力|功率|排量/i.test(k)&& (typeof v==='number'||typeof v==='string'&&v.length<100)))};}catch{const info=decode(String(row.INFO||'')).replace(/<[^>]*>/g,' ');infoSummary={technicalSnippets:info.match(/(?:horsepower|power|engine|fuel|출력|배기량|연료|马力|功率|排量)[^<>\r\n]{0,80}/gi)?.slice(0,15)||[]};}
  console.log('EXACT_SOURCE_CHECK',JSON.stringify({market,id,ajax:!!ajax,fields,prices,technical,sourceUrl,linkFields,infoSummary}));
 }
}
main().catch(e=>{const reason=String(e?.message||'');console.log('EXACT_SOURCE_CHECK_FAILED',/^(server_ip_not_confirmed|not_configured|visitor_restricted|identity_mismatch|invalid_json|response_too_large|http_\d{3}|collection_disabled)$/.test(reason)?reason:'operation_failed');process.exitCode=1;});
