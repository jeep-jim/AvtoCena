import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDealerMail, dealerMailLink} from '../apps/web/lib/dealer-mail';
function form(email = 'info@avtocena.com', provider = 'reg', ready = false) {
 const f = new FormData(); f.set('mailEmail', email); f.set('mailProvider', provider); if(ready) f.set('mailReady', 'on'); return f;
}
test('mail settings do not imply a provisioned inbox and old forms preserve settings', () => {
 assert.equal(parseDealerMail(new FormData()), undefined);
 assert.equal(dealerMailLink(parseDealerMail(form())), null);
 assert.equal(dealerMailLink(parseDealerMail(form('info@avtocena.com', 'reg', true))), 'https://webmail.hosting.reg.ru/');
 assert.throws(() => parseDealerMail(form('', 'reg', true)));
 assert.throws(() => parseDealerMail(form('info@avtocena.com', '', true)));
});
test('mail settings reject header injection, unsafe destinations and malformed addresses', () => {
 for(const email of ['a@b.ru\r\nBcc:x@y.ru', 'a b@c.ru', 'x@localhost', 'x@-bad.ru', 'x@bad..ru']) assert.throws(() => parseDealerMail(form(email)));
 for(const provider of ['javascript:alert(1)', 'https://evil.test', '__proto__', 'constructor']) {
  assert.throws(() => parseDealerMail(form('info@avtocena.com', provider, true)));
  assert.equal(dealerMailLink({email:'info@avtocena.com', provider: provider as any, ready:true}), null);
 }
});
