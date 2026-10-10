import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {customerConversation,leadCustomerEvents} from '../apps/web/lib/account/conversation-events';
import {customerNotices} from '../apps/web/lib/account/notifications';
import {connectRegisteredClient,canConnectCustomer} from '../apps/web/lib/account/connect-client';
import {accountPath,phoneAccountId} from '../apps/web/lib/account/auth';
import {linksPath,threadPath,portalData} from '../apps/web/lib/account/portal';
import {notifyCustomerForLead} from '../apps/web/lib/account/lead-push';
import {writeDataJson,readDataJson,readChunkedDataJson,resetJsonStorageForTests} from '../apps/web/lib/data';
const at='2026-10-10T11:00:00.000Z',owner:any={id:'owner',role:'owner',companyId:'dealer_topavto',displayName:'Владелец'};
const lead={id:'lead',clientId:'client',status:'assigned',assignedManagerId:'manager',car:'Тестовый автомобиль',updatedAt:at};
const users=[owner,{id:'manager',displayName:'Тестовый менеджер',role:'manager',companyId:'dealer_topavto'}];
test('customer events contain public changes but never internal notes; replay has stable identities',()=>{
 const previous={...lead,status:'new',assignedManagerId:null};const changed={...lead,internalNotes:[{text:'private note'}],partnerRef:'private partner'};
 const events=leadCustomerEvents(changed,previous,'Тестовый менеджер');assert.equal(events.length,2);assert.deepEqual(events,leadCustomerEvents(changed,previous,'Тестовый менеджер'));assert.doesNotMatch(JSON.stringify(events),/private/);
 assert.deepEqual(leadCustomerEvents(changed,lead,'Тестовый менеджер'),[]);
 assert.equal(leadCustomerEvents({...lead,archivedAt:at},lead)[0].eventKind,'archive');
 const current=customerConversation(events,{documents:[]},[lead],users);assert.equal(current.length,2);
});
test('documents appear once in chat and notices; hidden, trashed and unrelated contracts stay private',()=>{
 const client={documents:[{id:'shared',name:'test.pdf',customerVisible:true,createdAt:at},{id:'private',name:'secret.pdf',createdAt:at},{id:'deleted',customerVisible:true,deletedAt:at,createdAt:at}],portalContracts:{foreign:{documentId:'shared',confirmedAt:at},lead:{documentId:'private',confirmedAt:at}}};
 const messages=customerConversation([],client,[lead],users);assert.equal(messages.filter(m=>m.documentId).length,1);assert.doesNotMatch(JSON.stringify(messages),/secret|foreign|deleted/);
 const notices=customerNotices([{leads:[{...lead,title:'Заявка'}],documents:client.documents.slice(0,1),messages}]);assert.equal(notices.length,3);assert.equal(notices.filter(n=>n.text.includes('test.pdf')).length,1);
});
async function isolated(run:()=>Promise<void>){const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,secret=process.env.AUTH_SECRET,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'customer-conversation-'));fs.mkdirSync(path.join(tmp,'data'));process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';process.env.AUTH_SECRET='fixture-only-conversation-secret';resetJsonStorageForTests();try{await writeDataJson('auth/users.json',users);await run();}finally{process.chdir(cwd);for(const [k,v] of Object.entries({JSON_STORAGE_DRIVER:driver,AUTH_SECRET:secret})){if(v===undefined)delete process.env[k];else process.env[k]=v;}resetJsonStorageForTests();fs.rmSync(tmp,{recursive:true,force:true});}}
test('existing registration requires explicit authorized link; repeat repairs index without duplicates; other identities rejected',()=>isolated(async()=>{
 const phone='+79990000001',id=phoneAccountId(phone),account:any={id,phone,name:'Тестовый клиент',createdAt:at,sessionVersion:0};const client={id:'client',phone,assignedManagerId:'manager'};
 await writeDataJson(accountPath(id),account);await writeDataJson('clients/clients.json',[client]);await writeDataJson('leads/leads.json',[lead]);
 await assert.rejects(connectRegisteredClient(owner,'dealer_topavto',client.id,{accountId:id}));
 await assert.rejects(connectRegisteredClient({...owner,id:'outsider',role:'manager',permissions:{viewAll:false}},'dealer_topavto',client.id,{accountId:id,confirmed:true}));
 await assert.rejects(connectRegisteredClient(owner,'dealer_topavto',client.id,{accountId:'b'.repeat(64),confirmed:true}));
 assert.equal(canConnectCustomer(owner,{...client,portalAccountId:'other'},account,'dealer_topavto'),false);
 assert.equal(canConnectCustomer(owner,client,{...account,disabled:true},'dealer_topavto'),false);
 assert.equal(canConnectCustomer({...owner,companyId:'dealer_foreign'},client,account,'dealer_topavto'),false);
 assert.equal(canConnectCustomer(owner,client,account,'dealer_foreign'),false);
 await connectRegisteredClient(owner,'dealer_topavto',client.id,{accountId:id,confirmed:true});await connectRegisteredClient(owner,'dealer_topavto',client.id,{accountId:id,confirmed:true});
 assert.equal((await readDataJson<any[]>(linksPath(id),[])).length,1);
 const portal=await portalData(account);assert.equal(portal.length,1);assert.equal(portal[0].manager?.name,'Тестовый менеджер');assert.ok(portal[0].messages.some(m=>m.text.includes('Тестовый менеджер')));
}));
test('saved assignment and status events deduplicate and appear in the customer thread',()=>isolated(async()=>{
 await writeDataJson('clients/clients.json',[{id:'client'}]);
 const before={...lead,status:'new',assignedManagerId:null};await notifyCustomerForLead(lead,before);await notifyCustomerForLead(lead,before);
 const messages=await readChunkedDataJson<any>(threadPath('dealer_topavto','client'),[]);assert.equal(messages.length,2);assert.ok(messages.some(m=>m.text.includes('назначен менеджер')));
}));
