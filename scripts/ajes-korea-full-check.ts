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
 const page=await client.read({table:'korea',make:'GENESIS',model:'GV80',pageSize:1},ip),lot=page.items[0];
 if(!lot){console.log('KOREA_FULL_CHECK',JSON.stringify({sampleFound:false}));return;}
 await assertCollectionEnabled('ajes_korea_feed');await reserveAjesRequest(storage,'korea');
 const password=await ajesPassword();if(!password)throw Error('not_configured');
 const url=new URL('http://87.242.72.57/api/');url.search=new URLSearchParams({ip,json:'',code:password,sql:ajesQuery({table:'korea',id:lot.id}).sql,ajax:''}).toString();
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(45000)});
 if(!response.ok){await response.body?.cancel();throw Error('upstream_http_'+response.status);}
 const reader=response.body!.getReader(),chunks:Uint8Array[]=[];let bytes=0;
 while(true){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024){await reader.cancel();throw Error('response_too_large');}chunks.push(value);}
 const text=Buffer.concat(chunks).toString('utf8');
 if(bytes<=256&&/^\s*(?:bot|ban)\d*(?:\s|$)/i.test(text))throw Error('visitor_restricted');
 let body:any;try{body=JSON.parse(text);}catch{console.log('KOREA_FULL_CHECK',JSON.stringify({sampleFound:true,listPower:lot.sourcePower,json:false,bytes,technicalLabels:/power|horsepower|출력|мощность/i.test(text)}));return;}
 const row=Array.isArray(body)?body[0]:body;
 const identity=String(row?.ID||'')===lot.id;
 const technical=identity?Object.fromEntries(['PW','ENG_V','TIME','KPP','PRIV'].map(k=>[k,typeof row?.[k]==='string'?row[k].slice(0,60):typeof row?.[k]==='number'?row[k]:null])):{};
 console.log('KOREA_FULL_CHECK',JSON.stringify({sampleFound:true,listPower:lot.sourcePower,json:true,bytes,identity,fields:row&&typeof row==='object'?Object.keys(row).filter(k=>/^[A-Za-z0-9_]{1,40}$/.test(k)).slice(0,60):[],technical}));
}
main().catch(e=>{const reason=String(e?.reason||e?.message||'local_failure');console.log('KOREA_FULL_CHECK_FAILED',/^[a-z_0-9]+$/.test(reason)?reason:'local_failure');process.exitCode=1;});
