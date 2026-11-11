import test from 'node:test';
import assert from 'node:assert/strict';
import {accountMailConfigured, sendAccountMail} from '../apps/web/lib/account/mail';

test('Postbox sends via container IAM, rejects metadata/provider failures without leaking details', async () => {
  const before = {provider: process.env.ACCOUNT_MAIL_PROVIDER, from: process.env.ACCOUNT_MAIL_FROM};
  const original = globalThis.fetch;
  process.env.ACCOUNT_MAIL_PROVIDER = 'yandex-postbox';
  process.env.ACCOUNT_MAIL_FROM = 'noreply@avtocena.com';
  const calls: {url: string; options: RequestInit}[] = [];
  let mode = 'ok';
  globalThis.fetch = (async (url: any, options: RequestInit) => {
    calls.push({url: String(url), options});
    if (String(url).startsWith('http://169.254.169.254/')) {
      return new Response(JSON.stringify({access_token: 'test-iam-secret', expires_in: mode === 'expired' ? 0 : 3600}), {status: mode === 'metadata' ? 503 : 200});
    }
    return new Response(JSON.stringify({MessageId: 'test', detail: 'private provider detail'}), {status: mode === 'provider' ? 403 : 200});
  }) as typeof fetch;
  try {
    assert.equal(accountMailConfigured(), true);
    await sendAccountMail('user@example.com', 'Код', 'Тестовый код');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.redirect, 'error');
    assert.deepEqual(calls[0].options.headers, {'Metadata-Flavor': 'Google'});
    assert.equal(calls[1].url, 'https://postbox.cloud.yandex.net/v2/email/outbound-emails');
    assert.equal((calls[1].options.headers as any)['X-YaCloud-SubjectToken'], 'test-iam-secret');
    const payload = JSON.parse(calls[1].options.body as string);
    assert.equal(payload.FromEmailAddress, 'noreply@avtocena.com');
    assert.deepEqual(payload.Destination.ToAddresses, ['user@example.com']);
    assert.equal(payload.Content.Simple.Body.Text.Data, 'Тестовый код');
    for (mode of ['metadata', 'expired', 'provider']) {
      calls.length = 0;
      await assert.rejects(sendAccountMail('user@example.com', 'Код', 'Текст'), {message: 'Не удалось отправить письмо. Попробуйте позже.'});
      assert.equal(calls.length, mode === 'provider' ? 2 : 1);
    }
    delete process.env.ACCOUNT_MAIL_FROM;
    assert.equal(accountMailConfigured(), false);
  } finally {
    globalThis.fetch = original;
    for (const [key, value] of Object.entries({ACCOUNT_MAIL_PROVIDER: before.provider, ACCOUNT_MAIL_FROM: before.from})) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
