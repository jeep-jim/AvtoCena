import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createLead} from '../apps/web/lib/lead-intake';
import {readChunkedDataJson,resetJsonStorageForTests} from '../apps/web/lib/data';
import {LEAD_CONSENT_VERSION,LEAD_CONSENT_TEXT} from '../apps/web/lib/privacy-documents';
import {metrikaOrder} from '../apps/web/lib/metrika-crm';
test('public consent is required, versioned and recorded from authoritative text; analytics is independent',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,temp=fs.mkdtempSync(path.join(os.tmpdir(),'privacy-'));
 process.chdir(temp);process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();
 const send=(extra:object,origin='https://avtocena.com')=>createLead(new Request('https://avtocena.com/api/leads',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify({name:'Test',phone:'+79991234567',source:'home_lead_banner',requestMode:'generic',operationId:'privacy-test',...extra})}));
 try{
  assert.equal((await send({})).status,400);
  assert.equal((await send({personalDataConsent:true,personalDataConsentVersion:'old'})).status,400);
  assert.equal((await send({personalDataConsent:true,personalDataConsentVersion:LEAD_CONSENT_VERSION},'https://evil.example')).status,403);
  const r=await send({personalDataConsent:true,personalDataConsentVersion:LEAD_CONSENT_VERSION,personalDataConsentText:'FORGED',analyticsConsent:false,attribution:{metrikaClientId:'12345',yclid:'999'}});assert.equal(r.status,200);
  const [lead]=await readChunkedDataJson<any>('leads/leads.json',[]);assert.equal(lead.personalDataConsentText,LEAD_CONSENT_TEXT);assert.equal(lead.personalDataConsentVersion,LEAD_CONSENT_VERSION);assert.ok(lead.personalDataConsentAt);assert.equal(lead.analyticsConsent,false);assert.equal(lead.metrikaClientId,'');
  assert.equal(metrikaOrder({...lead,metrikaClientId:'12345'},'UTC'),null);
 }finally{process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;resetJsonStorageForTests();fs.rmSync(temp,{recursive:true,force:true});}
});
