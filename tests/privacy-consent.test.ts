import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createLead} from '../apps/web/lib/lead-intake';
import {readChunkedDataJson,resetJsonStorageForTests} from '../apps/web/lib/data';
import {LEAD_CONSENT_VERSION,LEAD_CONSENT_TEXT} from '../apps/web/lib/privacy-documents';
import {metrikaOrder} from '../apps/web/lib/metrika-crm';
test('required lead consent never grants analytics; explicitly allowed attribution preserves CRM export',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,temp=fs.mkdtempSync(path.join(os.tmpdir(),'privacy-'));
 process.chdir(temp);process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();
 const send=(extra:object,origin='https://avtocena.com')=>createLead(new Request('https://avtocena.com/api/leads',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({name:'Test',phone:'+79991234567',source:'home_lead_banner',requestMode:'generic',operationId:'privacy-test',...extra})}));
 try{
  assert.equal((await send({})).status,400);
  assert.equal((await send({personalDataConsent:true,personalDataConsentVersion:'old'})).status,400);
  assert.equal((await send({personalDataConsent:true,personalDataConsentVersion:'lead-consent-2026-10-02'})).status,400);
  assert.equal((await send({personalDataConsent:true,personalDataConsentVersion:LEAD_CONSENT_VERSION},'https://evil.example')).status,403);
  const r=await send({personalDataConsent:true,personalDataConsentVersion:LEAD_CONSENT_VERSION,personalDataConsentText:'FORGED',analyticsConsent:false,attribution:{metrikaClientId:'12345',yclid:'999'}});assert.equal(r.status,200);
  const [lead]=await readChunkedDataJson<any>('leads/leads.json',[]);assert.equal(lead.personalDataConsentText,LEAD_CONSENT_TEXT);assert.equal(lead.personalDataConsentVersion,LEAD_CONSENT_VERSION);assert.ok(lead.personalDataConsentAt);assert.equal(lead.analyticsConsent,false);assert.ok(!lead.metrikaClientId);assert.equal(metrikaOrder(lead,'UTC'),null);
  const allowed=await send({operationId:'privacy-allowed',phone:'+79991234568',personalDataConsent:true,personalDataConsentVersion:LEAD_CONSENT_VERSION,analyticsConsent:true,attribution:{metrikaClientId:'12345',yclid:'999'}});assert.equal(allowed.status,200);
  const permitted=(await readChunkedDataJson<any>('leads/leads.json',[])).find(x=>x.phone==='+79991234568');assert.equal(permitted.analyticsConsent,true);assert.equal(permitted.metrikaClientId,'12345');assert.ok(metrikaOrder(permitted,'UTC'));
  assert.equal(metrikaOrder({...lead,analyticsConsent:false,personalDataConsentVersion:'lead-consent-2026-09-30',metrikaClientId:'12345'},'UTC'),null);
 }finally{process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;resetJsonStorageForTests();fs.rmSync(temp,{recursive:true,force:true});}
});
