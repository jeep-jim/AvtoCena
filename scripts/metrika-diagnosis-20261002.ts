import {readDataJson,readChunkedDataJson} from '../apps/web/lib/data';
import {metrikaOrder} from '../apps/web/lib/metrika-crm';
async function main(){
const config=await readDataJson<any>('integrations/metrika/config.json',null);
const state=await readDataJson<any>('integrations/metrika/state.json',{sent:{}});
const leads=await readChunkedDataJson<any>('leads/leads.json',[]);
const day=(s:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Krasnoyarsk',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s));
const recent=leads.filter(l=>Number.isFinite(Date.parse(l.createdAt))&&day(l.createdAt)==='2026-10-01');
const target=recent.filter(l=>/sienna/i.test([l.car,l.brand,l.model,l.carTitle,l.offerSnapshot?.model,l.offerSnapshot?.title].filter(Boolean).join(' ')));
console.log(JSON.stringify({enabled:!!config?.enabled,lastAcceptedAt:state.lastAcceptedAt,lastError:state.lastError||null,pending:state.pending,missingClientId:state.missingClientId,targetCount:target.length,target:target.map(l=>({createdAt:l.createdAt,status:l.status,source:l.source,analyticsConsent:l.analyticsConsent===true,hasClientId:!!(l.metrikaClientId||l.attribution?.metrikaClientId),hasYclid:!!(l.yclid||l.attribution?.yclid),previouslyAccepted:!!state.sent[l.id],eligible:!!metrikaOrder(l,config?.timeZone||'UTC'),qualifiedHistory:(l.statusHistory||[]).filter((h:any)=>h.status==='qualified').map((h:any)=>({at:h.at||h.createdAt||h.date||null}))})),yesterday:{total:recent.length,consented:recent.filter(l=>l.analyticsConsent===true).length,withClientId:recent.filter(l=>!!(l.metrikaClientId||l.attribution?.metrikaClientId)).length}}));

}
main().catch(()=>{console.error('diagnosis_read_failed');process.exitCode=1;});
