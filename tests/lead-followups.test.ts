import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createLead} from '../apps/web/lib/lead-intake';
import {readChunkedDataJson, resetJsonStorageForTests, updateChunkedDataJson} from '../apps/web/lib/data';
import {leadContact} from '../apps/web/lib/lead-contact';
import {followupText, leadNotice} from '../apps/web/lib/crm-notifications';
import {claimCrmNotices, completeCrmNotice} from '../apps/web/lib/crm-relay';

test('same-browser offer followups are atomic and isolated from generic requests and other clients', async () => {
  const cwd=process.cwd(), driver=process.env.JSON_STORAGE_DRIVER;
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'lead-followups-'));
  fs.mkdirSync(path.join(temp,'data')); process.chdir(temp); process.env.JSON_STORAGE_DRIVER='local'; resetJsonStorageForTests();
  const base={requestMode:'offer',source:'catalog_offer_request',offerId:'fixture-car',submissionThreadToken:'12345678-1234-4321-aaaa-123456789abc',phone:'+79999999999',name:'Test',contactPreference:'call',personalDataConsent:true,comment:'Первое обращение'};
  const submit=async (body:any)=>{const response=await createLead(new Request('https://avtocena.com/api/leads',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...base,...body})})); assert.equal(response.status,200); return response.json();};
  try {
    const first=await submit({operationId:'one'});
    await updateChunkedDataJson<any>('leads/leads.json',first.leadId,row=>({...row,status:'in_progress',assignedManagerId:'manager-fixture'}));
    const [second,third]=await Promise.all([submit({operationId:'two',comment:'Дополню: нужен белый',phone:'+78888888888'}),submit({operationId:'three',comment:'И автомат'})]);
    assert.equal(first.leadId,second.leadId); assert.equal(first.leadId,third.leadId); assert.equal(first.clientId,second.clientId);
    await submit({operationId:'two',comment:'Дополню: нужен белый',phone:'+78888888888'});
    let leads=await readChunkedDataJson<any>('leads/leads.json',[]);
    assert.equal(leads.length,1); assert.equal(leads[0].status,'in_progress'); assert.equal(leads[0].assignedManagerId,'manager-fixture'); assert.equal(leads[0].followups.length,2); assert.equal(leads[0].comment,'Первое обращение');
    assert.equal((await readChunkedDataJson<any>('clients/clients.json',[])).length,1);
    const notices=await claimCrmNotices();
    assert.equal(notices.length,3); assert.ok(notices[0].text.includes('Новая заявка')); assert.equal(notices.filter(n=>n.text.includes('Дополнение к заявке')).length,2);
    for(const n of notices) await completeCrmNotice(n.id,n.token,123);
    assert.equal((await claimCrmNotices()).length,0);
    const generic=await submit({operationId:'generic',source:'home_lead_banner',requestMode:'generic',selectedOfferIds:['fixture-car'],car:'Нужен минивэн',pageUrl:'https://avtocena.com/'});
    assert.notEqual(generic.leadId,first.leadId);
    leads=await readChunkedDataJson<any>('leads/leads.json',[]);
    const general=leads.find(l=>l.id===generic.leadId); assert.equal(general.offerId,''); assert.deepEqual(general.selectedOffers,[]); assert.equal(general.car,'Нужен минивэн'); assert.ok(!leadNotice(general).includes('/cars/offer/'));
    const other=await submit({operationId:'other-person',submissionThreadToken:'99999999-1234-4321-aaaa-123456789abc'}); assert.notEqual(other.leadId,first.leadId);
    const car2=await submit({operationId:'other-car',offerId:'another-car'}); assert.notEqual(car2.leadId,first.leadId);
    const [race1,race2]=await Promise.all([submit({operationId:'race-one',offerId:'race-car'}),submit({operationId:'race-two',offerId:'race-car',comment:'Добавление при одновременной первой отправке'})]);
    assert.equal(race1.leadId,race2.leadId); assert.equal(race1.clientId,race2.clientId);
    const racing=(await readChunkedDataJson<any>('leads/leads.json',[])).find(l=>l.id===race1.leadId); assert.equal(racing.followups.length,1);
    await updateChunkedDataJson<any>('leads/leads.json',first.leadId,row=>({...row,archivedAt:new Date().toISOString()}));
    const reopened=await submit({operationId:'new-after-archive',phone:'+77777777777'}); assert.notEqual(reopened.leadId,first.leadId); assert.equal(reopened.clientId,first.clientId);
    assert.equal((await readChunkedDataJson<any>('clients/clients.json',[])).find(c=>c.id===reopened.clientId).phone,'+77777777777');
  } finally {process.chdir(cwd); if(driver===undefined) delete process.env.JSON_STORAGE_DRIVER; else process.env.JSON_STORAGE_DRIVER=driver; resetJsonStorageForTests(); fs.rmSync(temp,{recursive:true,force:true});}
});

test('messenger telephone and username contacts are explicitly labelled without false links',()=>{
  for(const messenger of ['telegram','max']) {
    const phone={contactPreference:'message',messenger,messengerContactKind:'phone',phone:'+79999999999',[messenger]:'+79999999999'};
    const c=leadContact(phone); assert.equal(c.channel,messenger); assert.match(c.text,/телефон аккаунта/); assert.ok(!c.value.startsWith('@')); assert.equal(c.href,messenger==='telegram'?'https://t.me/+79999999999':'');
    const text=leadNotice({id:'test',...phone}); assert.ok(text.includes(messenger==='max'?'MAX':'Telegram')); assert.ok(!text.includes('Телефон · звонок'));
    const username=leadContact({...phone,phone:'',messengerContactKind:'username',[messenger]:'@test_user'}); assert.equal(username.value,'@test_user'); assert.match(username.text,/никнейм/);
  }
  assert.equal(leadContact({contactPreference:'call',phone:'+79999999999'}).href,'tel:+79999999999');
});

test('followups state one contact action instead of internal field transitions', () => {
  const entry = {
    comment: 'Свяжитесь вечером', contactPreference: 'message', messenger: 'telegram',
    messengerContactKind: 'phone', phone: '+79999999999', telegram: '+79999999999',
    changes: {
      contactPreference: {before: 'call', after: 'message'},
      messenger: {before: '', after: 'telegram'},
      messengerContactKind: {before: '', after: 'phone'},
      telegram: {before: '', after: '+79999999999'},
    },
  };
  const original = structuredClone(entry);
  assert.equal(followupText(entry), 'Свяжитесь вечером\nНаписать в Telegram: +79999999999 (телефон аккаунта)');
  const notice = leadNotice({id: 'fixture', name: 'Клиент'}, entry);
  assert.equal(notice.split('Написать в Telegram:').length - 1, 1);
  assert.doesNotMatch(notice, /Способ связи|Мессенджер:|Тип контакта|не указан →/);
  assert.equal(followupText({...entry, changes: {}}), 'Свяжитесь вечером');
  assert.equal(followupText({...entry, comment: '', messenger: 'max', max: '@test_user', phone: '', messengerContactKind: 'username'}), 'Написать в MAX: @test_user (никнейм)');
  assert.equal(followupText({...entry, comment: '', contactPreference: 'call', phone: '+78888888888'}), 'Позвонить: +78888888888');
  assert.equal(followupText({comment: '', changes: {name: {before: 'max', after: 'call'}}}), 'Имя: max → call');
  assert.deepEqual(entry, original);
});

test('contact actions link supported identities without inventing MAX phone links',()=>{
 assert.equal(leadContact({telegram:'8 (999) 123-45-67'}).href,'https://t.me/+79991234567');
 assert.equal(leadContact({telegram:'@test_user'}).href,'https://t.me/test_user');
 assert.equal(leadContact({telegram:'javascript:alert(1)'}).href,'');
 assert.equal(leadContact({max:'+79991234567'}).href,'');
 assert.equal(leadContact({max:'@test_user'}).href,'');
 assert.equal(leadContact({max:'https://max.ru/u/test_profile'}).href,'https://max.ru/u/test_profile');
 assert.equal(leadContact({max:'https://max.ru.evil.example/u/test_profile'}).href,'');
 assert.equal(leadContact({max:'https://evil@max.ru/u/test_profile'}).href,'');
});
