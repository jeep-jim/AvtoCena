import test from 'node:test';
import assert from 'node:assert/strict';
import {customerNameError} from '../apps/web/lib/account/profile-name';
import {customerAuthHarness} from './helpers/customer-auth-harness.mjs';
test('customer names accept 2–60 Cyrillic or Latin letters and reject spaces, symbols and prohibited words',()=>{
 for(const name of ['Ян','Антон','Ёлка','John','A'.repeat(60)])assert.equal(customerNameError(name),null,name);
 for(const name of ['',null,42,'А','A'.repeat(61),' Ян','Ян ','Я н','  ','а,4','хуй_на','sex','SEX','John4','Иван\n','Иван-Иван','Иван🙂'])assert.ok(customerNameError(name),String(name));
});
test('profile endpoint rejects invalid names without modifying the account',async()=>{
 process.env.AUTH_SECRET='isolated-profile-test-secret';const harness=await customerAuthHarness();
 const request=(path:string,body:any,cookie='')=>new Request('https://avtocena.com'+path,{method:'POST',headers:{origin:'https://avtocena.com','content-type':'application/json',cookie},body:JSON.stringify(body)});
 const registered=await harness.handle(request('/api/account/auth',{action:'register',phone:'+79990007733',password:'secure-test-password',passwordConfirm:'secure-test-password',consent:true}));
 assert.equal(registered.status,200);const cookie=registered.headers.get('set-cookie')!.split(';')[0];
 for(const name of [' ','Я','Ан тон','A'.repeat(61),'sex','а,4']){const r=await harness.handle(request('/api/account/profile',{name,avatarId:'key'},cookie));assert.equal(r.status,400,name);}
 const saved=await harness.handle(request('/api/account/profile',{name:'Ян',avatarId:'key'},cookie));assert.equal(saved.status,200);assert.equal((await saved.json()).account.name,'Ян');
 const invalid=await harness.handle(request('/api/account/profile',{name:'Ян ',avatarId:'key'},cookie));assert.equal(invalid.status,400);
 const current=await harness.handle(new Request('https://avtocena.com/api/account/auth',{headers:{cookie}}));assert.equal((await current.json()).account.name,'Ян');
});
