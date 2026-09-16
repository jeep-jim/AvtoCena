import assert from 'node:assert/strict';
import {test} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {guardLead, leadVisitor, needsCaptcha, validateCaptcha, WINDOW_MS} from '../apps/web/lib/lead-antispam';
import {resetJsonStorageForTests} from '../apps/web/lib/data';

test('third same offer / fourth overall; window expires; favorites count each selected offer', () => {
  const now=Date.now();
  const rows=[{at:now, fingerprint:'1', offers:['a','b']},{at:now,fingerprint:'2',offers:['a']}];
  assert.equal(needsCaptcha(rows,['a'],now),true);
  assert.equal(needsCaptcha(rows,['b'],now),false);
  assert.equal(needsCaptcha(rows,[],now),false);
  assert.equal(needsCaptcha([...rows,{at:now,fingerprint:'3',offers:[]}],['c'],now),true);
  assert.equal(needsCaptcha(rows,['a'],now+WINDOW_MS),false);
});

test('persisted reservations serialize parallel requests; retries, contact identity, captcha failure and activation', async () => {
  const cwd=process.cwd(), env={...process.env}, originalFetch=globalThis.fetch;
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'captcha-'));
  fs.mkdirSync(path.join(temp,'data')); process.chdir(temp);
  process.env.JSON_STORAGE_DRIVER='local'; process.env.AUTH_SECRET='unit-test-only';
  process.env.SMARTCAPTCHA_CLIENT_KEY='client'; process.env.SMARTCAPTCHA_SERVER_KEY='server';
  resetJsonStorageForTests();
  const visitor=leadVisitor(new Request('https://avtocena.com'));
  const request=new Request('https://avtocena.com/api/leads',{headers:{cookie:`ac_lead_visitor=${visitor.cookie}`}});
  const body=(operationId:string)=>({operationId,phone:'+79999999999',personalDataConsent:true});
  const submit=(id:string, extra={})=>guardLead(request,{...body(id),...extra},['a'],['+79999999999']);
  try {
    assert.equal(leadVisitor(request).id,visitor.id);
    assert.notEqual(leadVisitor(new Request('https://avtocena.com',{headers:{cookie:`ac_lead_visitor=${visitor.id}.fake`}})).id,visitor.id);
    const results=await Promise.all(['one','two','three'].map(id=>submit(id)));
    assert.equal(results.filter(r=>r===null).length,2);
    assert.equal(results.filter(r=>r?.status===429).length,1);
    assert.equal(await submit('one'),null);
    assert.equal(await guardLead(request,body('one'),['b'],['+79999999999']),null);
    assert.equal((await guardLead(request,body('different-context'),['c'],['+79999999999']))?.status,429);
    assert.equal((await submit('one',{comment:'changed'}))?.status,429);
    const blocked=await guardLead(new Request('https://avtocena.com/api/leads'),body('new-browser'),['a'],['+79999999999']);
    assert.equal(blocked?.status,429);
    globalThis.fetch=async()=>Response.json({status:'failed'});
    assert.equal((await submit('four',{captchaToken:'bad'}))?.status,429);
    globalThis.fetch=async()=>Response.json({status:'ok',host:'attacker.example'});
    assert.equal(await validateCaptcha('token'),false);
    globalThis.fetch=async()=>Response.json({status:'ok',host:''});
    assert.equal(await validateCaptcha('token'),false);
    globalThis.fetch=async()=>{throw new Error('offline')};
    assert.equal((await submit('four',{captchaToken:'token'}))?.status,503);
    let calls=0;
    globalThis.fetch=async()=>{calls++; return Response.json({status:'ok',host:'avtocena.com'})};
    assert.equal(await submit('four',{captchaToken:'valid'}),null);
    assert.equal(calls,1);
    assert.equal(await submit('four'),null);
    assert.equal((await submit('five'))?.status,429);
    delete process.env.SMARTCAPTCHA_SERVER_KEY;
    assert.equal((await submit('partial-config'))?.status,503);
    delete process.env.SMARTCAPTCHA_CLIENT_KEY;
    assert.equal(await submit('disabled'),null);
  } finally {
    globalThis.fetch=originalFetch; process.chdir(cwd);
    for(const key of ['JSON_STORAGE_DRIVER','AUTH_SECRET','SMARTCAPTCHA_CLIENT_KEY','SMARTCAPTCHA_SERVER_KEY']) { if(env[key]===undefined) delete process.env[key]; else process.env[key]=env[key]; }
    resetJsonStorageForTests(); fs.rmSync(temp,{recursive:true,force:true});
  }
});
