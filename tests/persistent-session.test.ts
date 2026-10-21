import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {NextRequest} from 'next/server';
import {createSessionCookie,verifySessionCookie,resolveSessionUser,type AuthUser} from '../apps/web/lib/auth';
import {accountSession,parseAccountSession,type CustomerAccount} from '../apps/web/lib/account/auth';
import {middleware} from '../apps/web/middleware';
process.env.AUTH_SECRET='persistent-session-test-secret';
const user:AuthUser={id:'test',telegramUsername:'test',displayName:'Test',role:'dealer',companyId:'dealer_test',sessionVersion:2};
const customer={id:'a'.repeat(64),sessionVersion:2} as CustomerAccount;
const signed=(p:object,prefix='')=>{const b=Buffer.from(JSON.stringify(p)).toString('base64url');return b+'.'+createHmac('sha256',process.env.AUTH_SECRET!).update(prefix+b).digest('base64url');};
test('new sessions have no elapsed-time logout, while account revocation still applies',()=>{
 const staff=createSessionCookie(user),buyer=accountSession(customer),now=Date.now;
 try{Date.now=()=>now()+10*365*86400000;assert.equal(verifySessionCookie(staff)?.id,user.id);assert.equal(parseAccountSession(buyer)?.id,customer.id);}finally{Date.now=now;}
 assert.equal(resolveSessionUser(user,[{...user,status:'disabled'}]),null);
 assert.equal(resolveSessionUser(user,[{...user,sessionVersion:3}]),null);
 assert.equal(resolveSessionUser(user,[]),null);
 assert.equal(verifySessionCookie(staff+'.extra'),null);
 assert.equal(parseAccountSession(buyer+'x'),null);
});
test('valid legacy cookies migrate, expired and forged cookies do not',async()=>{
 const legacy=signed({...user,exp:Math.floor(Date.now()/1000)+600});
 const buyer=signed({...customer,v:2,exp:Date.now()+600000},'customer:');
 const request=(cookie:string)=>new NextRequest('https://avtocena.com/account',{headers:{cookie}});
 const migrated=await middleware(request(`avtocena_session=${legacy}; avtocena_customer=${buyer}`));
 const staff=migrated.cookies.get('avtocena_session')!;assert.ok(staff);assert.equal(verifySessionCookie(staff.value)?.id,user.id);
 assert.ok(migrated.cookies.get('avtocena_customer'));assert.equal(migrated.headers.get('cache-control'),'private, no-store');
 const expired=signed({...user,exp:1});assert.equal(verifySessionCookie(expired),null);
 assert.equal((await middleware(request(`avtocena_session=${expired}`))).cookies.get('avtocena_session'),undefined);
 assert.equal((await middleware(request(`avtocena_session=${legacy}x`))).cookies.get('avtocena_session'),undefined);
 const fresh=createSessionCookie(user);assert.equal((await middleware(request(`avtocena_session=${fresh}`))).cookies.get('avtocena_session'),undefined);
});
test('daily renewal preserves version and never overwrites a logout request',async()=>{
 const token=signed({...user,exp:0,persistent:true,renewedAt:Date.now()-2*86400000});
 const response=await middleware(new NextRequest('https://avtocena.com/dealer-cabinet',{headers:{cookie:`avtocena_session=${token}`}}));
 assert.equal(verifySessionCookie(response.cookies.get('avtocena_session')?.value)?.sessionVersion,2);
 for(const [url,method] of [['/api/auth/logout','GET'],['/api/account/auth','POST']]){
 const out=await middleware(new NextRequest('https://avtocena.com'+url,{method,headers:{cookie:`avtocena_session=${token}`}}));
 assert.equal(out.cookies.get('avtocena_session'),undefined);
 }
});
