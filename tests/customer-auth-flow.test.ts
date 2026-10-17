import {passwordDigest} from '../apps/web/lib/account/auth';
import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Node fixture helper shared with browser integration.
import {customerAuthHarness} from './helpers/customer-auth-harness.mjs';
process.env.AUTH_SECRET='isolated-account-flow-test-secret';
test('registration, session, logout and login remain independent from employee credentials',async()=>{
 const {handle,state}=await customerAuthHarness();
 const request=(body:any,cookie='avtocena_session=staff-session')=>new Request('https://avtocena.com/api/account/auth',{method:'POST',headers:{origin:'https://avtocena.com',cookie,'content-type':'application/json'},body:JSON.stringify(body)});
 const body={action:'register',phone:'+79990001234',password:'isolated-test-password',consent:true};
 let response=await handle(request({...body,phone:'+79990'}));assert.equal(response.status,400);assert.match((await response.json()).error,/не хватает/);
 response=await handle(request({...body,phone:'staff-login'}));assert.equal(response.status,400);
 response=await handle(request(body));assert.equal(response.status,200);const account=(await response.json()).account;assert.equal(account.phone,body.phone);assert.equal(account.passwordHash,undefined);
 const cookie=response.headers.get('set-cookie');assert.match(cookie,/avtocena_customer=/);assert.match(cookie,/HttpOnly/i);assert.match(cookie,/SameSite=lax/i);assert.doesNotMatch(cookie,/avtocena_session=/);
 const sessionCookie='avtocena_session=staff-session; '+cookie.split(';')[0];
 const current=()=>handle(new Request('https://avtocena.com/api/account/auth',{headers:{cookie:sessionCookie}}));
 assert.equal((await (await current()).json()).account.id,account.id);
 response=await handle(request({...body,password:'different-password'}));assert.equal(response.status,400);assert.match((await response.json()).error,/уже существует/);
 assert.equal((await handle(request({...body,action:'login',password:'incorrect'}))).status,400);
 assert.equal((await handle(request({...body,action:'login',phone:'8 (999) 000-12-34'}))).status,200);
 response=await handle(request({action:'logout'},sessionCookie));assert.match(response.headers.get('set-cookie'),/Max-Age=0/i);assert.doesNotMatch(response.headers.get('set-cookie'),/avtocena_session=/);
 assert.equal((await (await handle(new Request('https://avtocena.com/api/account/auth',{headers:{cookie:'avtocena_session=staff-session'}}))).json()).account,null);
 state.records.get(`accounts/users/${account.id}.json`).sessionVersion++;
 assert.equal((await (await current()).json()).account,null);
 state.failWrites=true;response=await handle(request({...body,phone:'+79990005678'}));assert.match((await response.json()).error,/сохранить кабинет/);
 delete (globalThis as any).__customerAuthTest;
});

test('temporary password permits one login, expires, and changes only with current credential',async()=>{
 const {handle,state}=await customerAuthHarness();
 const request=(body:any,cookie='',route='auth')=>new Request('https://avtocena.com/api/account/'+route,{method:'POST',headers:{origin:'https://avtocena.com',cookie,'content-type':'application/json'},body:JSON.stringify(body)});
 const phone='+79990009876';let response=await handle(request({action:'register',phone,password:'initial-password',consent:true}));const account=(await response.json()).account;
 const stored=state.records.get(`accounts/users/${account.id}.json`);stored.passwordHash=await passwordDigest('temporary-test-password');stored.passwordTemporaryUntil=Date.now()+600000;stored.passwordTemporaryUsed=false;
 response=await handle(request({action:'login',phone,password:'temporary-test-password'}));assert.equal(response.status,200);const cookie=response.headers.get('set-cookie')!.split(';')[0];assert.equal((await response.json()).account.passwordChangeRequired,true);
 assert.equal((await handle(request({action:'login',phone,password:'temporary-test-password'}))).status,400);
 assert.equal((await handle(request({currentPassword:'incorrect',password:'new-permanent-password'},cookie,'password'))).status,400);
 assert.equal((await handle(request({currentPassword:'temporary-test-password',password:'new-permanent-password'},cookie,'password'))).status,200);
 assert.equal((await handle(request({action:'login',phone,password:'new-permanent-password'}))).status,200);
 const next=state.records.get(`accounts/users/${account.id}.json`);assert.equal(next.passwordTemporaryUntil,undefined);next.passwordTemporaryUntil=Date.now()-1;assert.equal((await handle(request({action:'login',phone,password:'new-permanent-password'}))).status,400);
 delete (globalThis as any).__customerAuthTest;
});
