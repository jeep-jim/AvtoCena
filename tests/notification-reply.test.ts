import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationReplyTarget} from '../apps/web/lib/notification-reply';
test('notification replies use exact original chat and discussion; system/external/mismatched links have no recipient',()=>{
 const id='chat_'+'a'.repeat(64),thread='team_'+'b'.repeat(64);
 assert.deepEqual(notificationReplyTarget({id,kind:'staff',href:`/crm/chat?thread=${thread}`}),{kind:'chat',thread,messageId:id});
 assert.deepEqual(notificationReplyTarget({id:'comment_lead_a_message1',kind:'comment',entityType:'lead',entityId:'a',href:'/crm/leads?id=a&message=message1#discussion-lead-a'}),{kind:'discussion',type:'lead',id:'a',messageId:'message1'});
 assert.deepEqual(notificationReplyTarget({id:'comment_client_c_message2',kind:'comment',entityType:'client',entityId:'c',href:'/crm/clients/c?message=message2'}),{kind:'discussion',type:'client',id:'c',messageId:'message2'});
 for(const href of ['https://external.test/crm/chat?thread='+thread,'//external.test/crm/chat?thread='+thread,'/crm/chat?thread=lead:x','/crm/chat?thread=unknown'])assert.equal(notificationReplyTarget({id,kind:'staff',href}),undefined);
 assert.equal(notificationReplyTarget({id:'comment_lead_a_message1',kind:'comment',entityType:'lead',entityId:'b',href:'/crm/leads?id=a&message=message1'}),undefined);
 assert.equal(notificationReplyTarget({id:'birthday',kind:'birthday',href:'/crm/managers'}),undefined);
});
