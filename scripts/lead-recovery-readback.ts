import assert from 'node:assert/strict';
import {readChunkedDataJson} from '../apps/web/lib/data';
async function main(){
 const leads=await readChunkedDataJson<any>('leads/leads.json',[]);
 const tests=leads.filter(l=>l.phone==='+70000000000'&&l.name==='Техническая проверка — не звонить'&&String(l.createdAt).startsWith('2026-10-31'));
 const queue=await readChunkedDataJson<any>('telegram/crm-outbox.json',[]);
 const clients=await readChunkedDataJson<any>('clients/clients.json',[]);
 assert.ok(tests.some(l=>l.source==='lead_incident_acceptance'));
 assert.ok(tests.some(l=>l.offerId==='ajes-korea-6izz0N4BLK8FlP'));
 for(const lead of tests){assert.ok(clients.some(c=>c.id===lead.clientId));console.log('RECOVERY_READBACK',JSON.stringify({id:lead.id,createdAt:lead.createdAt,offerId:lead.offerId||'',durableClient:true,notifications:queue.filter(q=>q.leadId===lead.id).map(q=>({status:q.status,sentAt:q.sentAt||null,audience:q.audience}))}));}
 console.log('RECOVERY_BROWSER_AND_API_LEADS_VERIFIED',tests.length);
}
main().catch(error=>{console.error('RECOVERY_READBACK_FAILED',error?.name||'Error');process.exitCode=1;});
