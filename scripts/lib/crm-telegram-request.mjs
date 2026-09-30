import { setTimeout as delay } from 'node:timers/promises';

const readMethods = new Set(['getMe', 'getChat', 'getChatMember', 'getWebhookInfo']);

// Only reads may be retried: a lost sendMessage response can hide a successful send.
export async function telegramRequest(token, method, body = {}, {fetchImpl = fetch, sleep = delay} = {}) {
  const attempts = readMethods.has(method) ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let retryable = false, wait = 500 * (attempt + 1), code = 'network';
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST', redirect: 'error', headers: {'content-type': 'application/json'},
        body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
      });
      // An intermediary can return HTML on a temporary failure.
      let result;
      try { result = await response.json(); } catch { /* Classified by HTTP status below. */ }
      if (response.ok && result?.ok) return result;
      const status = Number(result?.error_code || response.status);
      code = Number.isInteger(status) && status >= 100 && status <= 599 ? String(status) : 'response';
      retryable = status === 429 || status >= 500;
      const retryAfter = Number(result?.parameters?.retry_after);
      if (status === 429 && retryAfter > 0) {
        wait = retryAfter * 1000;
        if (wait > 10000) retryable = false;
      }
    } catch { retryable = true; }
    if (!retryable || attempt + 1 === attempts) {
      // Never propagate Telegram descriptions, URLs, response bodies or tokens.
      throw Error(`telegram_${readMethods.has(method) ? method : 'write'}_${code}`);
    }
    await sleep(wait);
  }
}

export function safeDeliveryError(error) {
  const code = error instanceof Error ? error.message : '';
  if (/^telegram_(getMe|getChat|getChatMember|getWebhookInfo|write)_(network|response|[1-5][0-9]{2})$/.test(code)) return code;
  return ['configuration_missing', 'operation_invalid', 'bot_mismatch', 'group_identity_mismatch',
    'group_membership_missing', 'group_send_forbidden', 'recipient_mismatch',
    'acknowledgement_failed', 'delivery_incomplete', 'request_failed', 'webhook_mismatch'].includes(code) ? code : 'unavailable';
}
