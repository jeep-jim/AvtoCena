import {recoverTelegramTransport} from "./lib/crm-telegram-transport";
import {MINI_APP_URL} from "../apps/web/lib/telegram-miniapp";
import { flushCrmPush } from "../apps/web/lib/crm-push";
import { pathToFileURL } from "node:url";
import { handlePrivateLeadStart } from "../apps/web/lib/crm-lead-start";
import { enablePolling, pollingEnabled, pollBatch, eventDrivenEnabled, setEventDrivenMode } from "../apps/web/lib/crm-polling";
import {pendingCrmEvents} from "../apps/web/lib/crm-incoming-events";
import { handleCrmBotUpdate, sendCustomerWelcome } from "../apps/web/lib/crm-bot";
import { flushCrmNotifications } from "../apps/web/lib/crm-notifications";

let profileAttempted = false;
const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
async function telegram(method: string, body: unknown = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", redirect: "error", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(25_000),
  });
  const result = await response.json();
  if (!response.ok || !result?.ok) {
    console.error(JSON.stringify({telegramMethod:method,status:response.status,errorCode:result?.error_code,retryAfter:result?.parameters?.retry_after}));
    throw Error("telegram_failed");
  }
  return result.result;
}
export async function runPolling() {
  const operation = process.env.CRM_SERVICE_MODE === "1" ? "poll" : process.argv[2] || "poll";
  if (!["poll", "enable-polling"].includes(operation)) throw Error("invalid_operation");
  if (process.env.JSON_STORAGE_DRIVER !== "object" || !token ||
      !process.env.AUTH_SECRET || !process.env.YC_OBJECT_STORAGE_BUCKET ||
      !process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID || !process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY)
    throw Error("configuration_missing");
  if (operation === "poll" && !(await pollingEnabled())) {
    console.log("Polling not enabled; no updates consumed"); return;
  }
  const me = await telegram("getMe");
  if (me?.username?.toLowerCase() !== "avtocena_bot" || me?.is_bot !== true) throw Error("bot_mismatch");
  if (operation === "enable-polling") {
    // Existing updates are preserved. Set server-side guard before removing webhook.
    await enablePolling();
    await telegram("deleteWebhook", { drop_pending_updates: false });
  }
  if (!profileAttempted && (operation === "enable-polling" || process.env.ACCEPTANCE_RUN === "1")) {
    // Profile updates are optional setup, never a prerequisite for consuming updates.
    // The supervised loop must not rewrite them every two seconds.
    profileAttempted = true;
    try {
      await telegram("deleteMyCommands");
      await telegram("setChatMenuButton", {menu_button:{type:"web_app",text:"АвтоЦена",web_app:{url:MINI_APP_URL}}});
      await telegram("setMyDescription", {description:"АвтоЦена — каталог автомобилей из-за рубежа. Откройте приложение, выберите автомобиль и рассчитайте стоимость."});
      await telegram("setMyShortDescription", {short_description:"Автомобили из-за рубежа: каталог, фильтры и расчёт стоимости."});
      const menu = await telegram("getChatMenuButton");
      console.log(JSON.stringify({publicMiniAppMenu:menu?.type,miniAppUrl:menu?.web_app?.url}));
    } catch { console.error("Bot profile setup incomplete; update processing continues"); }
  }
  let info = await telegram("getWebhookInfo");
  let eventDriven = await eventDrivenEnabled();
  const recovery = await recoverTelegramTransport(info, eventDriven, telegram, setEventDrivenMode);
  info = recovery.info; eventDriven = recovery.eventDriven;
  if (recovery.recovered) console.log("Unreachable known webhook disabled; pending updates preserved for polling");
  if (process.env.ACCEPTANCE_RUN === "1" && process.env.CRM_SERVICE_MODE !== "1") {
    const target = info?.url ? new URL(info.url) : null;
    console.log(JSON.stringify({eventDriven,webhookHost:target?.hostname||null,webhookPath:target?.pathname||null,pending:info?.pending_update_count||0,lastErrorAt:info?.last_error_date||null,lastErrorCategory:/timeout|timed out/i.test(info?.last_error_message||"")?"timeout":info?.last_error_message?"other":"none"}));
  }
  if (info?.url && !eventDriven) throw Error("webhook_still_active");
  process.env.CRM_BOT_POLL_WORKER = "1";
  const handleUpdate = async (update: any) => {
      const handled = await handlePrivateLeadStart(update, token) || await handleCrmBotUpdate(update, token);
      const message = update.message;
      if (!handled && message?.chat?.type === "private" && String(message.chat.id) === String(message.from?.id)) {
        await sendCustomerWelcome(token, String(message.chat.id));
      }
      if (update.callback_query?.id) {
        // Old callbacks may have expired while waiting for a scheduled run.
        await telegram("answerCallbackQuery", { callback_query_id: update.callback_query.id }).catch(() => null);
      }
    };
  // Old webhook events remain eligible even after transport recovery.
  const queued = await pollBatch(pendingCrmEvents, handleUpdate, false);
  const result = eventDriven ? queued : await pollBatch(
    offset => telegram("getUpdates", {offset,limit:8,timeout:process.env.CRM_SERVICE_MODE === "1" ? 15 : 0,allowed_updates:["message","callback_query"]}),
    handleUpdate,
    true,
  );
  await flushCrmNotifications(3);
  await flushCrmPush(10).catch(() => undefined);
  console.log(`Telegram polling: processed=${result.processed}, inactiveOrBusy=${result.inactiveOrBusy}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runPolling().catch(() => {
  console.error("Telegram polling failed; queue retained, private details omitted");
  process.exitCode = 1;
});
