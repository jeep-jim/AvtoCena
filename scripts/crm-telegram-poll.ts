import { pathToFileURL } from "node:url";
import { handlePrivateLeadStart } from "../apps/web/lib/crm-lead-start";
import { enablePolling, pollingEnabled, pollBatch, eventDrivenEnabled } from "../apps/web/lib/crm-polling";
import {pendingCrmEvents} from "../apps/web/lib/crm-incoming-events";
import { handleCrmBotUpdate } from "../apps/web/lib/crm-bot";
import { flushCrmNotifications, telegramSend } from "../apps/web/lib/crm-notifications";

const token = (process.env.TELEGRAM_BOT_TOKEN || "").trim();
async function telegram(method: string, body: unknown = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST", redirect: "error", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), signal: AbortSignal.timeout(25_000),
  });
  const result = await response.json();
  if (!response.ok || !result?.ok) throw Error("telegram_failed");
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
    await telegram("setMyCommands", { commands: [
      { command: "menu", description: "Главное меню" },
      { command: "request", description: "Заказать расчёт" },
      { command: "my", description: "Мои обращения" },
      { command: "site", description: "Открыть сайт" },
    ] });
  }
  const info = await telegram("getWebhookInfo");
  const eventDriven = await eventDrivenEnabled();
  if (info?.url && !eventDriven) throw Error("webhook_still_active");
  process.env.CRM_BOT_POLL_WORKER = "1";
  const result = await pollBatch(
    offset => eventDriven ? pendingCrmEvents(offset) : telegram("getUpdates", { offset, limit: 8, timeout: process.env.CRM_SERVICE_MODE === "1" ? 15 : 0,
      allowed_updates: ["message", "callback_query"] }),
    async update => {
      const handled = await handlePrivateLeadStart(update, token) || await handleCrmBotUpdate(update, token);
      const message = update.message;
      if (!handled && message?.chat?.type === "private" && String(message.chat.id) === String(message.from?.id)) {
        await telegramSend(token, String(message.chat.id), "АвтоЦена — подбор и расчёт автомобиля. Откройте сайт или отправьте запрос менеджеру.", [
          [{ text: "Открыть сайт", url: "https://avtocena.com" }],
          [{ text: "Заказать расчёт", callback_data: "cust:new" }],
          [{ text: "Мои обращения", callback_data: "cust:my" }],
        ]);
      }
      if (update.callback_query?.id) {
        // Old callbacks may have expired while waiting for a scheduled run.
        await telegram("answerCallbackQuery", { callback_query_id: update.callback_query.id }).catch(() => null);
      }
    },
    !eventDriven,
  );
  await flushCrmNotifications(3);
  console.log(`Telegram polling: processed=${result.processed}, inactiveOrBusy=${result.inactiveOrBusy}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runPolling().catch(() => {
  console.error("Telegram polling failed; queue retained, private details omitted");
  process.exitCode = 1;
});
