import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
// @ts-ignore Shared isolated persistence and Next request context.
import {customerAuthHarness} from './helpers/customer-auth-harness.mjs';

test('email recovery requires the registered phone and previously verified email, without Telegram fallback', async () => {
  const keys = ['AUTH_SECRET', 'ACCOUNT_MAIL_PROVIDER', 'ACCOUNT_SMTP_HOST', 'ACCOUNT_SMTP_USER', 'ACCOUNT_SMTP_PASSWORD', 'ACCOUNT_MAIL_FROM'];
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) process.env[key] = 'isolated-test';
  process.env.ACCOUNT_MAIL_PROVIDER = 'smtp';
  const sent: any[] = [];
  const original = nodemailer.createTransport;
  (nodemailer as any).createTransport = () => ({sendMail: async (mail: any) => {sent.push(mail);}, close() {}});
  try {
    const {handle, state} = await customerAuthHarness();
    let sequence = 0;
    const request = (body: any, route = 'email') => handle(new Request(`https://avtocena.com/api/account/${route}`, {
      method: 'POST', headers: {origin: 'https://avtocena.com', 'content-type': 'application/json', 'x-forwarded-for': `192.0.2.${++sequence}`}, body: JSON.stringify(body),
    }));
    const phone = '+79990004567';
    const registered = await request({action: 'register', phone, password: 'old-test-password', consent: true}, 'auth');
    assert.equal(registered.status, 200);
    const account = (await registered.json()).account;
    const stored = state.records.get(`accounts/users/${account.id}.json`);
    const recover = (email: string, number = phone) => request({action: 'recover', phone: number, email});
    for (const mode of ['missing', 'unverified', 'mismatched']) {
      if (mode === 'unverified') stored.email = 'owner@example.com';
      if (mode === 'mismatched') stored.emailVerifiedAt = new Date().toISOString();
      const response = await recover(mode === 'mismatched' ? 'other@example.com' : 'owner@example.com');
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.match(data.token, /^[a-f0-9]{48}$/);
      assert.equal(data.url, undefined);
      assert.equal(sent.length, 0);
    }
    assert.equal((await recover('owner@example.com', '+79990007654')).status, 200);
    assert.equal(sent.length, 0);
    const response = await recover('Owner@Example.com');
    assert.equal(response.status, 200);
    const {token} = await response.json();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'owner@example.com');
    assert.equal(state.records.has('accounts/telegram-challenges.json'), false);
    const code = sent[0].text.match(/\b\d{6}\b/)[0];
    assert.equal((await request({action: 'complete', token})).status, 400);
    assert.equal(sent.length, 1);
    const reset = {action: 'reset', token, code, password: 'new-test-password'};
    assert.equal((await request({...reset, code: 'not-a-code'})).status, 400);
    assert.equal((await request(reset)).status, 200);
    assert.equal((await request(reset)).status, 400);
    assert.equal((await request({action: 'login', phone, password: 'old-test-password'}, 'auth')).status, 400);
    assert.equal((await request({action: 'login', phone, password: reset.password}, 'auth')).status, 200);
  } finally {
    nodemailer.createTransport = original;
    for (const key of keys) {if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key];}
    delete (globalThis as any).__customerAuthTest;
  }
});
