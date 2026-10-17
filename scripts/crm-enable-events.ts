import {getTelegramRuntimeConfig} from "../apps/web/lib/telegram-config";
import {setEventDrivenMode, eventDrivenEnabled} from "../apps/web/lib/crm-polling";

async function main() {
  const config = await getTelegramRuntimeConfig();
  if (!config?.token || !config.webhookSecret) throw Error("missing_configuration");
  const origin = "https://bbaohms2ccpm3vb4e73t.containers.yandexcloud.net";
  const target = origin + "/api/telegram/incoming";
  async function telegram(method: string, body: unknown = {}) {
    const response = await fetch(`https://api.telegram.org/bot${config!.token}/${method}`, {
      method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw Error("telegram_request_failed");
    return result.result;
  }
  const me = await telegram("getMe");
  if (!me.is_bot || me.username?.toLowerCase() !== "avtocena_bot") throw Error("bot_mismatch");
  const health = await fetch(origin + "/api/health", {signal: AbortSignal.timeout(15000)}).then(r => r.json());
  const expectedRelease = process.env.CRM_EXPECTED_RELEASE_SHA || process.env.GITHUB_SHA;
  if (!expectedRelease || health.releaseSha !== expectedRelease) throw Error("release_mismatch");
  const before = await telegram("getWebhookInfo");
  if (before.url && before.url !== target) throw Error("unexpected_existing_webhook");
  const probe = await fetch(target, {method: "POST", headers: {"content-type": "application/json", "x-telegram-bot-api-secret-token": config.webhookSecret}, body: "{}", signal: AbortSignal.timeout(15000)});
  if (!probe.ok) throw Error("receiver_probe_failed");
  if (before.url === target && await eventDrivenEnabled()) {
    console.log(`Event receiver already configured; pending=${before.pending_update_count || 0}`); return;
  }
  await setEventDrivenMode(true);
  try {
    await telegram("setWebhook", {url: target, secret_token: config.webhookSecret, max_connections: 1,
      drop_pending_updates: false, allowed_updates: ["message", "callback_query"]});
    const after = await telegram("getWebhookInfo");
    if (after.url !== target) throw Error("webhook_not_confirmed");
    console.log(`Event receiver configured; pending updates preserved; pending=${after.pending_update_count || 0}`);
  } catch {
    await telegram("deleteWebhook", {drop_pending_updates: false});
    await setEventDrivenMode(false);
    throw Error("activation_failed_rolled_back");
  }
}
main().catch(() => {console.error("Event activation failed; inspect configuration and receiver access. Secret details omitted."); process.exitCode = 1;});
