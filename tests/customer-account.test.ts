import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeAccountPhone,passwordDigest,passwordMatches,accountSession,parseAccountSession,phoneAccountId,accountPath,type CustomerAccount} from '../apps/web/lib/account/auth';
process.env.AUTH_SECRET='customer-account-test-secret-not-production';
test('phone aliases share one account without accepting invalid identifiers',()=>{
 assert.equal(normalizeAccountPhone('8 (999) 123-45-67'),'+79991234567');
 assert.equal(normalizeAccountPhone('+7 999 1234567'),'+79991234567');
 assert.throws(()=>normalizeAccountPhone('123'));
 assert.throws(()=>accountPath('../clients'));
 assert.equal(phoneAccountId('+79991234567').length,64);
});
test('passwords are salted and verified with a bounded scrypt input',async()=>{
 const first=await passwordDigest('a-good-test-password'),second=await passwordDigest('a-good-test-password');
 assert.notEqual(first,second);assert.equal(await passwordMatches('a-good-test-password',first),true);
 assert.equal(await passwordMatches('wrong',first),false);assert.equal(await passwordMatches('x'.repeat(129),first),false);
 await assert.rejects(passwordDigest('short'));
});
test('customer session rejects tampering and never accepts extra components',()=>{
 const a={id:phoneAccountId('+79991234567'),sessionVersion:3} as CustomerAccount;
 const session=accountSession(a),p=parseAccountSession(session);assert.equal(p.id,a.id);assert.equal(p.v,3);
 assert.equal(parseAccountSession(session+'x'),null);assert.equal(parseAccountSession(session+'.extra'),null);
 const parts=session.split('.');parts[0]=Buffer.from(JSON.stringify({...p,id:'f'.repeat(64)})).toString('base64url');assert.equal(parseAccountSession(parts.join('.')),null);
});
import {readAccountJson} from '../apps/web/lib/account/request';
test('account forms enforce actual body size without trusting Content-Length',async()=>{
 const req=(body:string)=>new Request('https://avtocena.com/api/account/auth',{method:'POST',headers:{'Content-Type':'application/json'},body});
 assert.deepEqual(await readAccountJson(req('{"action":"login"}')),{action:'login'});
 await assert.rejects(readAccountJson(req(JSON.stringify({text:'x'.repeat(9000)}))));
 await assert.rejects(readAccountJson(req('[]')));
});
import {accountCanAccessClient,canClaimCustomerInvite,sharedCustomerDocuments,confirmedCustomerContract} from '../apps/web/lib/account/access';
test('a matching phone never grants client access; owner binding and live invite are required',()=>{
 const now=Date.now(),client:any={phone:'+79991234567',portalAccountId:'a',portalInvite:{hash:'token-hash',expiresAt:new Date(now+1000).toISOString()}};
 assert.equal(accountCanAccessClient('b',client),false);assert.equal(accountCanAccessClient('a',client),true);
 assert.equal(canClaimCustomerInvite('b',client,'token-hash',now),false);
 assert.equal(canClaimCustomerInvite('a',client,'wrong',now),false);
 assert.equal(canClaimCustomerInvite('a',client,'token-hash',now+2000),false);
 client.portalInvite.expiresAt='bad';assert.equal(canClaimCustomerInvite('a',client,'token-hash',now),false);
 client.deletedAt=new Date().toISOString();assert.equal(accountCanAccessClient('a',client),false);
});
test('private, trashed and purging files never authorize download or review',()=>{
 const client:any={documents:[{id:'private'},{id:'shared',customerVisible:true},{id:'trash',customerVisible:true,deletedAt:'now'},{id:'purging',customerVisible:true,purgeToken:'active'}],portalContracts:{lead:{documentId:'shared',confirmedBy:'manager',confirmedAt:new Date().toISOString()}}};
 assert.deepEqual(sharedCustomerDocuments(client).map((d:any)=>d.id),['shared']);
 assert.ok(confirmedCustomerContract(client,'lead'));assert.equal(confirmedCustomerContract(client,'other'),null);
 client.portalContracts.lead.revokedAt='now';assert.equal(confirmedCustomerContract(client,'lead'),null);
 delete client.portalContracts.lead.revokedAt;client.documents[1].customerVisible=false;assert.equal(confirmedCustomerContract(client,'lead'),null);
});
import {obsoleteMessageChunks} from '../apps/web/lib/account/maintenance';
test('message cleanup retains referenced chunks, recent writes, unknown dates and unrelated data',()=>{
 const name='a'.repeat(64),now=Date.now(),file=(id:string)=>`${name}-0001-${id.repeat(8)}-${id.repeat(4)}-${id.repeat(4)}-${id.repeat(4)}-${id.repeat(12)}.json`;
 const object=(f:string,at=now-3*86400000)=>({key:'accounts/messages/'+f,lastModified:new Date(at).toISOString(),size:5});
 const rows=[object(file('1')),object(file('2')),object(file('3'),now),{key:'accounts/messages/'+file('4')},object('private.json')];
 const index={version:1,collection:name,total:1,chunks:[{file:file('1'),count:1}]};
 assert.deepEqual(obsoleteMessageChunks(rows,index,name,now).map(x=>x.key),['accounts/messages/'+file('2')]);
 assert.deepEqual(obsoleteMessageChunks(rows,null,name,now),[]);
 assert.deepEqual(obsoleteMessageChunks(rows,{...index,collection:'wrong'},name,now),[]);
});
