import test from 'node:test';import assert from 'node:assert/strict';
import {validPushSubscription} from '../apps/web/lib/crm-push-policy';
const keys={auth:Buffer.alloc(16).toString('base64url'),p256dh:Buffer.alloc(65).toString('base64url')};
test('push accepts only known HTTPS push endpoints and correct key lengths',()=>{
 for(const endpoint of ['https://fcm.googleapis.com/fcm/send/a','https://updates.push.services.mozilla.com/wpush/v2/a','https://web.push.apple.com/a'])assert.ok(validPushSubscription({endpoint,keys}));
 for(const endpoint of ['https://127.0.0.1/a','https://fcm.googleapis.com.evil.test/a','http://fcm.googleapis.com/a','https://user@fcm.googleapis.com/a','https://fcm.googleapis.com:444/a'])assert.equal(validPushSubscription({endpoint,keys}),false);
 assert.equal(validPushSubscription({endpoint:'https://fcm.googleapis.com/a',keys:{...keys,auth:'x'}}),false);
});
