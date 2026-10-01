import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createLead} from "../apps/web/lib/lead-intake";
import {readChunkedDataJson,resetJsonStorageForTests} from "../apps/web/lib/data";
import {claimCrmNotices} from "../apps/web/lib/crm-relay";
import {leadReadState} from "../apps/web/lib/crm-read-state";
import groupTarget from "../apps/web/lib/crm-group-target.json";

test("website and mini app submit through the same intake, unread CRM state and approved Telegram group",async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER;
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"mini-leads-"));fs.mkdirSync(path.join(tmp,"data"));process.chdir(tmp);process.env.JSON_STORAGE_DRIVER="local";resetJsonStorageForTests();
 try{
  const ids:string[]=[];
  for(const [index,referer] of ["https://avtocena.com/cars/offer/fixture-car","https://avtocena.com/cars/offer/fixture-car?mini=1"].entries()){
   const response=await createLead(new Request("https://avtocena.com/api/leads",{method:"POST",headers:{"content-type":"application/json",origin:"https://avtocena.com",referer},body:JSON.stringify({submissionChannel:index?"telegram_miniapp":"site",requestMode:"offer",source:"catalog_offer_request",offerId:"fixture-car",operationId:`channel-${index}`,submissionThreadToken:`12345678-1234-4321-aaaa-123456789ab${index}`,phone:index?"+78888888888":"+79999999999",name:"Test",city:"Красноярск",contactPreference:"call",personalDataConsent:true,personalDataConsentVersion:"lead-consent-2026-09-30",pageUrl:referer})}));
   assert.equal(response.status,200);ids.push((await response.json()).leadId);
  }
  const leads=await readChunkedDataJson<any>("leads/leads.json",[]);assert.equal(leads.length,2);
  for(const lead of leads){assert.ok(ids.includes(lead.id));assert.ok(lead.notificationRequestedAt);assert.equal(leadReadState(lead,"owner").unread,true);assert.equal(lead.offerId,"fixture-car");}
  assert.equal(leads.find(l=>l.id===ids[1]).submissionChannel,"telegram_miniapp");
  const notices=await claimCrmNotices();assert.equal(notices.length,2);
  assert.ok(notices.some(n=>n.text.includes("Источник: Telegram Mini App")));assert.ok(notices.some(n=>n.text.includes("Источник: Сайт")));
  for(const notice of notices){assert.match(notice.text,/Имя: Test/);assert.match(notice.text,/Город: Красноярск/);assert.match(notice.text,/Телефон · звонок: \+7/);assert.match(notice.text,/Автомобиль:/);assert.equal(notice.chatId,groupTarget.chatId);assert.ok(ids.some(id=>notice.text.includes(id)));}
 }finally{process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;resetJsonStorageForTests();fs.rmSync(tmp,{recursive:true,force:true});}
});

test('dealer profile requests keep verified attribution in CRM and group notice',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER;
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dealer-lead-'));fs.mkdirSync(path.join(tmp,'data/dealers/showcases'),{recursive:true});process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();
 try{
  const {defaultShowcase}=await import('../apps/web/lib/dealers/showcase-model');
  fs.writeFileSync('data/dealers/showcases/dealer_topavto.json',JSON.stringify({...defaultShowcase('dealer_topavto'),profileEnabled:true,name:'Test dealer'}));
  const response=await createLead(new Request('https://avtocena.com/api/leads',{method:'POST',headers:{'content-type':'application/json',origin:'https://avtocena.com'},body:JSON.stringify({requestMode:'generic',source:'dealer_profile_request',dealerId:'dealer_topavto',dealerName:'Forged company',name:'Test',phone:'+79998887766',city:'Новосибирск',car:'Toyota RAV4',contactPreference:'call',personalDataConsent:true,personalDataConsentVersion:'lead-consent-2026-09-30',pageUrl:'https://avtocena.com/request?dealer=dealer_topavto'})}));
  assert.equal(response.status,200,await response.clone().text());
  const lead=(await readChunkedDataJson<any>('leads/leads.json',[]))[0];assert.equal(lead.requestedDealerId,'dealer_topavto');assert.equal(lead.requestedDealerName,'Test dealer');assert.match(lead.comment,/Test dealer/);assert.equal(lead.submissionChannel,'site');
  const notices=await claimCrmNotices();assert.equal(notices.length,1);assert.match(notices[0].text,/Test dealer/);assert.equal(notices[0].text.includes('Forged company'),false);assert.equal(notices[0].chatId,groupTarget.chatId);
 }finally{process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;resetJsonStorageForTests();fs.rmSync(tmp,{recursive:true,force:true});}
});
