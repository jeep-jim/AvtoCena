// Read-only latency measurements. Never print page bodies, users or session credentials.
import {performance} from 'node:perf_hooks';
import {createSessionCookie} from '../apps/web/lib/auth.ts';
import {readCrmUsers} from '../apps/web/lib/crm-users.ts';
const user=(await readCrmUsers()).find(u=>u.role==='owner'&&u.status!=='disabled');
if(!user)throw Error('active_owner_missing');
const cookie=createSessionCookie(user);
for(const path of ['/api/health','/','/cars','/crm','/crm','/api/crm/inbox']){
 const start=performance.now();
 try{const r=await fetch('https://avtocena.com'+path,{redirect:'manual',headers:path.startsWith('/crm')||path.startsWith('/api/crm/')?{cookie:`avtocena_session=${cookie}`}:{},signal:AbortSignal.timeout(35000)});const first=performance.now()-start;const body=await r.text();console.log(JSON.stringify({path,status:r.status,firstMs:Math.round(first),totalMs:Math.round(performance.now()-start),bytes:Buffer.byteLength(body),aborted:body.includes('signal: aborted')}));}catch(e){console.log(JSON.stringify({path,error:e.name,totalMs:Math.round(performance.now()-start)}));}
}
