import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {createLead} from '../apps/web/lib/lead-intake';
import {readChunkedDataJson,resetJsonStorageForTests} from '../apps/web/lib/data';
import {leadNotice} from '../apps/web/lib/crm-notifications';
import {LEAD_CONSENT_VERSION} from '../apps/web/lib/privacy-documents';
import {leadChannelLabel} from '../apps/web/lib/lead-source';
test('Mini App origin survives intake, activity, no analytics and cross-channel followups',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,temp=fs.mkdtempSync(path.join(os.tmpdir(),'mini-leads-'));
 process.chdir(temp);process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();
 const send=async(extra:object)=>{const response=await createLead(new Request('https://avtocena.com/api/leads',{method:'POST',headers:{origin:'https://avtocena.com','content-type':'application/json'},body:JSON.stringify({name:'Тест',phone:'+79991234567',source:'catalog_offer_request',offerId:'fixture',submissionThreadToken:'12345678-1234-4321-aaaa-123456789abc',personalDataConsent:true,personalDataConsentVersion:LEAD_CONSENT_VERSION,analyticsConsent:false,...extra})}));assert.equal(response.status,200);return response.json();};
 try {
  const first=await send({operationId:'mini-first',submissionChannel:'telegram_miniapp'});
  const again=await send({operationId:'site-followup',submissionChannel:'site'});assert.equal(first.leadId,again.leadId);
  const lead=(await readChunkedDataJson<any>('leads/leads.json',[]))[0];
  assert.equal(lead.source,'catalog_offer_request');assert.equal(lead.submissionChannel,'telegram_miniapp');assert.equal(lead.analyticsConsent,false);
  assert.equal(lead.followups[0].submissionChannel,'site');
  const event=(await readChunkedDataJson<any>('activity/feed.json',[]))[0];assert.equal(event.title,'Заявка из Telegram Mini App');assert.equal(event.actor.name,'Telegram Mini App');
  assert.match(leadNotice(lead),/Источник: Telegram Mini App/);assert.match(leadNotice(lead,lead.followups[0]),/Источник: Сайт/);
  const site=await send({operationId:'ordinary',submissionThreadToken:'',requestMode:'generic',submissionChannel:'owner'});
  const other=(await readChunkedDataJson<any>('leads/leads.json',[])).find(l=>l.id===site.leadId);assert.equal(other.submissionChannel,'site');assert.equal(leadChannelLabel(other),'Сайт');
 }finally{process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;resetJsonStorageForTests();fs.rmSync(temp,{recursive:true,force:true});}
});
test('group notice contains only source and CRM link even with prior consent',()=>{
 const base={id:'test',name:'Стас',phone:'+79991234567',car:'Honda Stepwgn',city:'Новокузнецк',personalDataConsent:true,personalDataConsentVersion:LEAD_CONSENT_VERSION,submissionChannel:'telegram_miniapp',comment:'PRIVATE_COMMENT',internalNote:'PRIVATE_NOTE'};
 for(const contact of [{contactPreference:'call'},{contactPreference:'message',messenger:'telegram',telegram:'test_user'},{contactPreference:'message',messenger:'max',max:'https://max.ru/u/test'}]){
  const text=leadNotice({...base,...contact});assert.doesNotMatch(text,/Стас|79991234567|Honda Stepwgn/);assert.match(text,/Источник: Telegram Mini App/);assert.doesNotMatch(text,/PRIVATE_|№test/);
  assert.doesNotMatch(text,/@test_user/);
  assert.doesNotMatch(text,/max.ru/);
 }
 for(const extra of [{personalDataConsentVersion:'lead-consent-2026-09-29'},{source:'privacy_request'}])assert.doesNotMatch(leadNotice({...base,...extra}),/Стас|79991234567|Honda|PRIVATE_/);
});
