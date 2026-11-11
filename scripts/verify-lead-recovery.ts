import assert from 'node:assert/strict';
import {readChunkedDataJson} from '../apps/web/lib/data';
import {LEAD_CONSENT_VERSION} from '../apps/web/lib/privacy-documents';
async function main(){
// Synthetic contact only; no customer contacts or comments appear in logs.
const marker=`lead-recovery-20261031-${process.env.GITHUB_RUN_ID}`;
assert(/^lead-recovery-20261031-\d+$/.test(marker));
const body={operationId:marker,requestMode:'generic',source:'lead_incident_acceptance',phone:'+70000000000',name:'Техническая проверка — не звонить',comment:marker,contactPreference:'call',personalDataConsent:true,personalDataConsentVersion:LEAD_CONSENT_VERSION,analyticsConsent:false};
const before=await readChunkedDataJson<any>('leads/leads.json',[]);
const daily:Record<string,number>={};for(const lead of before){const day=String(lead.createdAt||'').slice(0,10);if(day>='2026-10-25'&&day<='2026-10-31')daily[day]=(daily[day]||0)+1;}
console.log('LEAD_COUNTS_UTC_DAYS',JSON.stringify(daily));
let savedId='';
for(let attempt=0;attempt<2;attempt++){
 const response=await fetch('https://avtocena.com/api/leads',{method:'POST',headers:{'content-type':'application/json',origin:'https://avtocena.com'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 assert.equal(response.status,200,'Public intake must return success');
 const result=await response.json();assert.equal(result.ok,true);assert.ok(result.leadId);
 if(savedId)assert.equal(result.leadId,savedId,'Retry must not create a duplicate');savedId=result.leadId;
 const leads=await readChunkedDataJson<any>('leads/leads.json',[]);
 const matching=leads.filter(l=>l.source===body.source&&l.comment===marker);
 assert.equal(matching.length,1);assert.equal(matching[0].id,savedId);assert.equal(matching[0].personalDataConsent,true);
 const clients=await readChunkedDataJson<any>('clients/clients.json',[]);assert.ok(clients.some(c=>c.id===matching[0].clientId));
 console.log('LEAD_INTAKE_VERIFIED',JSON.stringify({attempt:attempt+1,leadId:savedId,durableLead:true,durableClient:true,retryDeduplicated:attempt===1}));
}

}
main().catch(error=>{console.error("LEAD_RECOVERY_VERIFICATION_FAILED",error?.name||"Error");process.exitCode=1;});
