import crypto from 'node:crypto';
import groupTarget from '../apps/web/lib/crm-group-target.json' with { type: 'json' };
import { verifyGroupTarget } from './lib/crm-group-target.mjs';

// Never print request/response bodies, errors with URLs, tokens, or chat IDs.
const token = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const secret = process.env.AUTH_ACCESS_KEY || '';
const operation = process.argv[2] || 'deliver';
const relayKey = secret ? crypto.createHmac('sha256', secret).update('avtocena:crm-notification-relay:v1').digest('hex') : '';
async function post(url, body, headers = {}) {
  const response = await fetch(url, {method: 'POST', redirect: 'error', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body), signal: AbortSignal.timeout(15000)});
  const result = await response.json();
  if (!response.ok || !result.ok) throw Error('request_failed');
  return result;
}
const telegram = (method, body = {}) => post(`https://api.telegram.org/bot${token}/${method}`, body);
const relay = body => post('https://avtocena.com/api/internal/crm/relay', body, {'x-crm-relay-key': relayKey});
async function main() {
  if (!token || !secret) throw Error('configuration_missing');
  if (!['deliver', 'check', 'setup-webhook', 'check-group'].includes(operation)) throw Error('operation_invalid');
  const me = await telegram('getMe');
  if (me.result?.username?.toLowerCase() !== 'avtocena_bot' || me.result?.is_bot !== true) throw Error('bot_mismatch');
  console.log('Telegram bot identity verified');
  if (operation === 'check') return;
  if (operation === 'setup-webhook') {
    const config = await relay({action: 'webhook'});
    await telegram('setWebhook', {url: config.url, secret_token: config.secret, drop_pending_updates: false,
      allowed_updates: ['message', 'callback_query', 'my_chat_member', 'channel_post', 'edited_channel_post']});
    const info = await telegram('getWebhookInfo');
    if (info.result?.url !== config.url) throw Error('webhook_mismatch');
    console.log('Webhook configured; pending updates preserved');
    return;
  }
  await verifyGroupTarget(telegram, me.result, groupTarget);
  console.log('Approved private group identity and bot membership verified');
  if (operation === 'check-group') return;
  const {notices} = await relay({action: 'claim'});
  let sent = 0, failed = 0;
  for (const notice of notices) {
    if (notice.audience !== 'group' || String(notice.chatId) !== groupTarget.chatId) throw Error('recipient_mismatch');
    const reference = {id: notice.id, token: notice.token};
    const permission = await relay({action: 'authorize', ...reference});
    if (!permission.allowed) continue;
    let message;
    try {
      message = await telegram('sendMessage', {chat_id: notice.chatId, text: notice.text, disable_web_page_preview: true,
        reply_markup: {inline_keyboard: [[{text: 'Открыть CRM', url: notice.url}]]}});
    } catch {
      await relay({action: 'ack', ...reference});
      failed++;
      continue;
    }
    // Retry only the acknowledgement, never sendMessage after a received success.
    let acknowledged = false;
    for (let attempt = 0; attempt < 3 && !acknowledged; attempt++) {
      try { await relay({action: 'ack', ...reference, messageId: message.result.message_id}); acknowledged = true; }
      catch { /* Claim expires if all acknowledgements fail. */ }
    }
    if (!acknowledged) throw Error('acknowledgement_failed');
    sent++;
  }
  console.log(`Delivery batch: sent=${sent}, failed=${failed}, claimed=${notices.length}`);
  if (failed) throw Error('delivery_incomplete');
}
main().catch(() => { console.error('CRM Telegram worker failed. Check configuration and service availability; private details omitted.'); process.exitCode = 1; });
