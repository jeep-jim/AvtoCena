import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesQuery} from '../apps/web/lib/catalog/ajes-query';
import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {getJsonStorage} from '../apps/web/lib/data';
async function main(){
 const ip=process.env.AJES_DIAG_IP;if(ip!=='151.248.113.177')throw Error('address');
 const storage=getJsonStorage();
 const client=createAjesClient({password:ajesPassword,assertEnabled:t=>assertCollectionEnabled(`ajes_${t}_feed`),reserve:t=>reserveAjesRequest(storage,t)});
 const count=await client.read({table:'korea',aggregate:'count'},ip);
 const next=await client.read({table:'korea',page:2,pageSize:24},ip);
 console.log('KOREA_PAGINATION',JSON.stringify({total:count.total,observedAt:count.observedAt,page:next.page,received:next.received,rejected:next.rejected,ids:next.items.slice(0,3).map((v:any)=>v.id),withPower:next.items.filter((v:any)=>Number(v.sourcePower)>0).length}));
 for(const market of ['korea'] as const){
 const page=await client.read({table:market,id:'6cyeERjzLgmBr4'},ip),lot=page.items[0];
 if(!lot){console.log('MARKET_FIELDS_CHECK',JSON.stringify({sampleFound:false}));return;}
 await assertCollectionEnabled(`ajes_${market}_feed`);await reserveAjesRequest(storage,market);
 const password=await ajesPassword();if(!password)throw Error('not_configured');
 const url=new URL('http://87.242.72.57/api/');url.search=new URLSearchParams({ip,json:'',code:password,sql:ajesQuery({table:market,id:lot.id}).sql,ajax:''}).toString();
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(45000)});
 if(!response.ok){await response.body?.cancel();throw Error('upstream_http_'+response.status);}
 const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let bytes=0;
 while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024){await reader.cancel();throw Error('response_too_large');}chunks.push(value);}
 const text=Buffer.concat(chunks).toString('utf8');
 if(bytes<=256&&/^\s*(?:bot|ban)\d*(?:\s|$)/i.test(text))throw Error('visitor_restricted');
 let body:any;try{body=JSON.parse(text);}catch{console.log('MARKET_FIELDS_CHECK',JSON.stringify({sampleFound:true,listPower:lot.sourcePower,json:false,bytes,technicalLabels:/power|horsepower|출력|мощность/i.test(text)}));return;}
 const row=Array.isArray(body)?body[0]:body;
 const technicalInfo=String(row?.INFO||'').replace(/<[^>]*>/g,' ').split(/\r?\n/).filter(line=>/horsepower|power|출력|мощност/i.test(line)).filter(line=>line.length<240).slice(0,12);
 console.log('KOREA_TECHNICAL_INFO',JSON.stringify({id:lot.id,technicalInfo}));
 const identity=String(row?.ID||'')===lot.id;
 const technical=identity?Object.fromEntries(['PW','ENG_V','TIME','KPP','PRIV'].map(k=>[k,typeof row?.[k]==='string'?row[k].slice(0,60):typeof row?.[k]==='number'?row[k]:null])):{};
 console.log('MARKET_FIELDS_CHECK',JSON.stringify({sampleFound:true,market,listPower:lot.sourcePower,infoLength:String(row?.INFO||'').length,links:[...String(row?.INFO||'').matchAll(/https?:\/\/[^\s<>"']+/g)].map(m=>{try{const u=new URL(m[0]);return {host:u.hostname,path:u.pathname.slice(0,180)};}catch{return null;}}).slice(0,6),json:true,bytes,identity,fields:row&&typeof row==='object'?Object.keys(row).filter(k=>/^[A-Za-z0-9_]{1,40}$/.test(k)).slice(0,60):[],technical}));
 }
}
main().catch(e=>{const reason=String(e?.reason||e?.message||'local_failure');console.log('KOREA_FULL_CHECK_FAILED',/^[a-z_0-9]+$/.test(reason)?reason:'local_failure');process.exitCode=1;});
