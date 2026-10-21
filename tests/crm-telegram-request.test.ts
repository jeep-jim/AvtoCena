import test from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore Standalone worker helper.
import { telegramRequest, safeDeliveryError } from '../scripts/lib/crm-telegram-request.mjs';

test('Telegram identity reads survive network, server and short rate-limit failures', async () => {
  for (const failure of ['network', 'server', 'rate']) {
    let calls = 0;
    const waits: number[] = [];
    const result = await telegramRequest('PRIVATE_TOKEN', 'getChat', {}, {
      sleep: async (ms: number) => { waits.push(ms); },
      fetchImpl: async () => {
        if (++calls === 1) {
          if (failure === 'network') throw Error('PRIVATE_TOKEN');
          if (failure === 'server') return new Response('PRIVATE_BODY', {status: 502});
          return Response.json({ok: false, error_code: 429, parameters: {retry_after: 2}}, {status: 429});
        }
        return Response.json({ok: true, result: {id: 77}});
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.result.id, 77);
    assert.deepEqual(waits, [failure === 'rate' ? 2000 : 500]);
  }
});

test('Telegram retries are bounded, permission failures and writes are never retried', async () => {
  for (const [method, status, count] of [['getChat', 503, 3], ['getChat', 403, 1], ['sendMessage', 503, 1]] as const) {
    let calls = 0;
    await assert.rejects(telegramRequest('PRIVATE_TOKEN', method, {}, {
      sleep: async () => {},
      fetchImpl: async () => { calls++; return Response.json({ok: false, error_code: status, description: 'PRIVATE_BODY'}, {status}); },
    }), new RegExp(`telegram_${method === 'sendMessage' ? 'write' : method}_${status}`));
    assert.equal(calls, count);
  }
  let calls = 0;
  await assert.rejects(telegramRequest('PRIVATE_TOKEN', 'getChat', {}, {
    sleep: async () => { assert.fail('long rate limit must not block the worker'); },
    fetchImpl: async () => { calls++; return Response.json({ok:false,error_code:429,parameters:{retry_after:60}}, {status:429}); },
  }), /telegram_getChat_429/);
  assert.equal(calls, 1);
});

test('delivery diagnostics reveal only allowlisted codes', () => {
  assert.equal(safeDeliveryError(Error('telegram_getChat_503')), 'telegram_getChat_503');
  assert.equal(safeDeliveryError(Error('group_identity_mismatch')), 'group_identity_mismatch');
  for (const value of [Error('https://api.telegram.org/botPRIVATE_TOKEN/getChat'), Error('PRIVATE_CONTACT'), {message:'PRIVATE'}])
    assert.equal(safeDeliveryError(value), 'unavailable');
});
