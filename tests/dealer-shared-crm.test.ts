import {notificationReplyTarget} from '../apps/web/lib/notification-reply';
import {createReminder,readReminders,finishReminder} from '../apps/web/lib/crm-reminders';
import './helpers/server-only-hook.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {writeDataJson,readChunkedDataJson,resetJsonStorageForTests} from '../apps/web/lib/data';
import {chatList,chatDetail,createDirectChat,createChatRoom,sendChatMessage} from '../apps/web/lib/crm-chat';
import {readDiscussion,addDiscussionMessage,editDiscussionMessage,discussionTargets} from '../apps/web/lib/crm-discussion-store';
import {workspaceCanSee,workspacePermission} from '../apps/web/lib/crm-workspace';
import {GENERAL_CHAT_ID} from '../apps/web/lib/chat-emoji';
import type {AuthUser} from '../apps/web/lib/auth';
const a={id:'dealer-a-owner',role:'dealer',companyId:'dealer_a',dealerTeamRole:'owner',dealerApproved:true,status:'active',displayName:'A',telegramUsername:'owner_a'} as AuthUser;
const teammate={...a,id:'dealer-a-manager',dealerTeamRole:'manager',displayName:'Manager'} as AuthUser;
const b={...a,id:'dealer-b-owner',companyId:'dealer_b',displayName:'B'} as AuthUser;
const platform={...a,id:'platform',companyId:'dealer_topavto',role:'owner',displayName:'Platform'} as AuthUser;
test('shared dealer CRM isolates chats, discussions, clients and disclosure without platform rights',async()=>{
 const cwd=process.cwd(),driver=process.env.JSON_STORAGE_DRIVER,tmp=fs.mkdtempSync(path.join(os.tmpdir(),'dealer-shared-'));fs.mkdirSync(path.join(tmp,'data'));process.chdir(tmp);process.env.JSON_STORAGE_DRIVER='local';resetJsonStorageForTests();
 try{
 await writeDataJson('auth/users.json',[a,teammate,b,platform]);
 await writeDataJson('dealers/dealers.json',[{id:'dealer_a',status:'verified'},{id:'dealer_b',status:'verified'}]);
 const lead={id:'a-lead',companyId:'dealer_a',requestedDealerId:'dealer_a',name:'A client',clientId:'same-id',assignedManagerId:a.id,platformTerms:{agreementDigest:'test'},dealerContactResult:'contacted',status:'contacted',internalNotes:[{id:'private',text:'PLATFORM PRIVATE'}]};
 await writeDataJson('leads/leads.json',[lead,{...lead,id:'b-lead',companyId:'dealer_b',requestedDealerId:'dealer_b'}, {...lead,id:'closed',assignedManagerId:'',name:'UNDISCLOSED'}]);
 await writeDataJson('dealers/dealer_a/clients.json',[{id:'same-id',companyId:'dealer_a',fio:'Own client'}]);
 await writeDataJson('dealers/dealer_b/clients.json',[{id:'same-id',companyId:'dealer_b',fio:'Foreign client'}]);
 await writeDataJson('clients/clients.json',[{id:'same-id',fio:'Platform client',internalNotes:[{text:'PLATFORM PRIVATE'}]}]);
 assert.equal(workspacePermission(a,'site'),false);assert.equal(workspacePermission(a,'catalog'),false);assert.equal(workspacePermission(a,'settings'),false);
 assert.equal(workspaceCanSee(a,{...lead,assignedManagerId:''}),false);
 const list=await chatList(a);assert.deepEqual(list.team.map(u=>u.id),[teammate.id]);assert.ok(!JSON.stringify(list).includes('UNDISCLOSED'));assert.ok(!list.threads.some(t=>t.id==='lead:b-lead'));
 await assert.rejects(createDirectChat(a,b.id));await assert.rejects(createDirectChat(a,platform.id));await assert.rejects(createChatRoom(a,{title:'Bad',operationId:'room-operation',participants:[b.id]}));
 await sendChatMessage(a,GENERAL_CHAT_ID,{text:'Company A only',operationId:'general-message'});
 assert.equal((await chatDetail(teammate,GENERAL_CHAT_ID)).messages.length,1);assert.equal((await chatDetail(b,GENERAL_CHAT_ID)).messages.length,0);assert.equal((await chatDetail(platform,GENERAL_CHAT_ID)).messages.length,0);
 const direct=await createDirectChat(a,teammate.id);await sendChatMessage(a,direct.id,{text:'Direct',operationId:'direct-operation'});await assert.rejects(chatDetail(b,direct.id));
 const first=await readDiscussion(a,'lead','a-lead');assert.equal(first.messages.length,0);
 await assert.rejects(readDiscussion(a,'lead','b-lead'));await assert.rejects(readDiscussion(a,'lead','closed'));
 const result=await addDiscussionMessage(a,'lead','a-lead',{text:'Dealer note',operationId:'dealer-message'});assert.equal(result.messages[0].text,'Dealer note');
 await addDiscussionMessage(a,'lead','a-lead',{text:'Dealer note',operationId:'dealer-message'});
 await assert.rejects(editDiscussionMessage(teammate,'lead','a-lead',{messageId:result.messages[0].id,text:'Forged',expectedText:'Dealer note'}));
 const stored=(await readChunkedDataJson<any>('leads/leads.json',[])).find(l=>l.id==='a-lead');assert.equal(stored.internalNotes[0].text,'PLATFORM PRIVATE');assert.equal(stored.dealerInternalNotes.length,1);
 const client=await readDiscussion(a,'client','same-id');assert.equal(client.label,'Клиент: Own client');assert.equal(client.messages.length,0);
 await addDiscussionMessage(a,'client','same-id',{text:'Own client note',operationId:'client-message'});
 assert.equal((await readDiscussion(b,'client','same-id')).messages.length,0);
 assert.ok(!(await discussionTargets(a)).some(t=>t.id==='b-lead'||t.id==='closed'));
 const reminder=await createReminder(a,{entityType:'client',entityId:'same-id',text:'Company A reminder',dueAt:new Date(Date.now()+3600000).toISOString()});
 assert.equal((await readReminders(teammate)).length,1);assert.equal((await readReminders(b)).length,0);assert.equal((await readReminders(platform)).length,0);
 await assert.rejects(createReminder(a,{entityType:'lead',entityId:'b-lead',text:'Forbidden',dueAt:new Date(Date.now()+3600000).toISOString()}));
 await assert.rejects(finishReminder(b,reminder.id));await finishReminder(teammate,reminder.id);assert.ok((await readReminders(a))[0].doneAt);
 await assert.rejects(chatList({...a,dealerApproved:false}));await assert.rejects(readDiscussion({...a,status:'disabled'},'lead','a-lead'));
 }finally{process.chdir(cwd);if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;resetJsonStorageForTests();fs.rmSync(tmp,{recursive:true,force:true});}
});

test('dealer status edits retain contract safeguards, tenant assignment, archive rights and conflict detection',async()=>{
 const {applyDealerLeadUpdate:patch}=await import('../apps/web/lib/dealers/lead-update');
 const now=new Date('2026-11-04T12:00:00Z'),lead={id:'lead',requestedDealerId:a.companyId,assignedManagerId:a.id,status:'selection',platformTerms:{agreementDigest:'signed'},dealerContactResult:'contacted'};
 const apply=(body:any,user=a,current:any=lead)=>patch(current,user,body,[a,teammate,b],[],now);
 assert.throws(()=>apply({status:'paid'}));assert.throws(()=>apply({status:'contract_signed'}));assert.throws(()=>apply({status:'rejected',note:''}));
 assert.throws(()=>apply({status:'selection',assignedManagerId:b.id,expectedManagerId:a.id}));
 assert.throws(()=>apply({assignedManagerId:teammate.id,expectedManagerId:'stale'}));
 assert.throws(()=>apply({assignedManagerId:teammate.id,expectedManagerId:a.id},teammate));
 assert.throws(()=>apply({archived:true,note:'Reason'},teammate));assert.throws(()=>apply({status:'selection'},b));
 assert.throws(()=>apply({status:'selection'},a,{...lead,platformTerms:null}));
 const next=apply({status:'offer_sent',note:'Offer ready',assignedManagerId:teammate.id,expectedManagerId:a.id});assert.equal(next.status,'offer_sent');assert.equal(next.assignedManagerId,teammate.id);assert.equal(next.dealerInternalNotes[0].text,'Offer ready');assert.equal(next.platformTerms,lead.platformTerms);
 assert.ok(apply({archived:true,note:'Duplicate'}).archivedAt);
});

test('dealer notification reply targets require matching company URLs and retain client discussion identity',()=>{
 const notice={id:'comment_client_client-a_note-a',kind:'comment',entityType:'client' as const,entityId:'client-a',companyId:'dealer_a',href:'/dealer-cabinet/company/dealer_a/clients/client-a?message=note-a#discussion-client-client-a'};
 assert.deepEqual(notificationReplyTarget(notice),{kind:'discussion',type:'client',id:'client-a',messageId:'note-a'});
 assert.equal(notificationReplyTarget({...notice,companyId:'dealer_b'}),undefined);
});
