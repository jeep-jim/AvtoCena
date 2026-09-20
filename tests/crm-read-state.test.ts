import test from 'node:test';
import assert from 'node:assert/strict';
import {canMigrateLegacyAcknowledgement} from '../apps/web/lib/crm-alert-state';
import {leadReadState,markLeadRead} from '../apps/web/lib/crm-read-state';
const a={id:'a',displayName:'Антон'},b={id:'b',displayName:'Менеджер'};
const original={id:'lead',createdAt:'2026-09-20T10:00:00Z',status:'new',assignedManagerId:'b'};
test('reading is personal and persists independently of status and manager actions',()=>{
 const read=markLeadRead(original,a,leadReadState(original,a.id).eventKey,'2026-09-20T10:01:00Z');
 assert.equal(leadReadState(read,a.id).unread,false);assert.equal(leadReadState(read,b.id).unread,true);
 const both=markLeadRead(read,b,leadReadState(read,b.id).eventKey,'2026-09-20T10:02:00Z');
 assert.equal(both.readReceipts.length,2);assert.equal(leadReadState({...both,status:'assigned',updatedAt:'2026-09-20T10:03:00Z'},a.id).unread,false);
 const followup={...both,followups:[{createdAt:'2026-09-20T10:04:00Z'}]};
 assert.equal(leadReadState(followup,a.id).unread,true);assert.equal(leadReadState(followup,b.id).unread,true);
 assert.equal(markLeadRead(followup,a,leadReadState(both,a.id).eventKey,'2026-09-20T10:05:00Z'),null,'stale screen cannot read a later message');
});
test('assignment is an independent targeted event, including reassignment back to the same person',()=>{
 let lead:any=original;
 for(const user of [a,b])lead=markLeadRead(lead,user,leadReadState(lead,user.id).eventKey,'2026-09-20T10:01:00Z');
 lead={...lead,managerHistory:[{assignedManagerId:'b',changedAt:'2026-09-20T10:02:00Z'}]};
 assert.equal(leadReadState(lead,a.id).unread,false);assert.equal(leadReadState(lead,b.id).assignmentUnread,true);
 lead=markLeadRead(lead,b,leadReadState(lead,b.id).eventKey,'2026-09-20T10:03:00Z');
 lead={...lead,assignedManagerId:'a',managerHistory:[...lead.managerHistory,{assignedManagerId:'a',changedAt:'2026-09-20T10:04:00Z'}]};
 assert.equal(leadReadState(lead,b.id).unread,false);assert.equal(leadReadState(lead,a.id).assignmentUnread,true);
 lead={...lead,assignedManagerId:'b',managerHistory:[...lead.managerHistory,{assignedManagerId:'b',changedAt:'2026-09-20T10:05:00Z'}]};
 assert.equal(leadReadState(lead,b.id).assignmentUnread,true);
});

test('legacy confirmation migrates only personally confirmed prior events, never a new assignment or message',()=>{
 const ack=Date.parse('2026-09-20T10:01:00Z');
 assert.equal(canMigrateLegacyAcknowledgement(original,ack),true);
 assert.equal(canMigrateLegacyAcknowledgement({...original,hasReadReceipt:true},ack),false);
 assert.equal(canMigrateLegacyAcknowledgement({...original,assignmentAt:'2026-09-20T10:00:30Z'},ack),false);
 assert.equal(canMigrateLegacyAcknowledgement({...original,lastIncomingAt:'2026-09-20T10:02:00Z'},ack),false);
});
