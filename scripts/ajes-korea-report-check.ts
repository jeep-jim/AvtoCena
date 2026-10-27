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
  const saved=await storage.readJson<any>(`integrations/ajes/report-sample-${kind}.json`,null);
  if(saved?.id!==id||typeof saved.body!=='string')throw Error('sample_missing');
  const value=JSON.parse(saved.body);
  function safe(v:unknown){
   if(typeof v!=='string')return typeof v;
   if(v.includes(password!))return '[credential-bearing text omitted]';
   try{const u=new URL(v);return {host:u.hostname,path:u.pathname,queryKeys:[...u.searchParams.keys()]};}catch{}
   return v.replace(/https?:[^\s<>"']+/g,'[URL]').replace(/\b[\w.+-]+@[\w.-]+\b/g,'[contact]').replace(/\+?\d[\d ()-]{7,}\d/g,'[number]').slice(0,1000);
  }
  console.log('KOREA_REPORT_SAVED',JSON.stringify({kind,observedAt:saved.observedAt,strings:Array.isArray(value)?value.filter(v=>typeof v==='string').map(safe):[],info:kind==='ajax'?safe(value?.[0]?.INFO):undefined}));
 }
}
main().catch(()=>{console.log('KOREA_REPORT_CHECK_FAILED');process.exitCode=1;});
