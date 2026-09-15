import { pollingEnabled } from "./crm-polling";
import crypto from "node:crypto";
import {
  appendChunkedDataJson,
  readChunkedDataJson,
  updateChunkedDataJson,
  mutateDataJson,
} from "./data";
import groupTarget from "./crm-group-target.json";
import { getTelegramRuntimeConfig } from "./telegram-config";
import { botAdmin } from "./crm-access";

export async function telegramSend(
  token: string,
  chatId: string,
  text: string,
  keyboard?: any,
) {
  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4000),
        disable_web_page_preview: true,
        ...(keyboard ? { reply_markup: Array.isArray(keyboard) ? { inline_keyboard: keyboard } : keyboard } : {}),
      }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    },
  );
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok)
    throw Error(`telegram_delivery_${response.status}`);
  return result.result;
}
export function leadNotice(lead: any) {
  return [
    `📩 Новая заявка №${String(lead.id).slice(0, 100)} · АвтоЦена`,
    lead.name || lead.telegramDisplayName || "Клиент",
    lead.phone ? `Телефон: ${lead.phone}` : "",
    lead.telegram ? `Telegram: @${lead.telegram}` : "",
    lead.car || lead.offerTitle || "Подбор автомобиля",
    ...(Array.isArray(lead.selectedOffers) ? lead.selectedOffers.slice(0, 5).map((offer: any, index: number) => `${index + 1}. ${String(offer.title || "Автомобиль").slice(0, 180)}\nhttps://avtocena.com/cars/offer/${encodeURIComponent(String(offer.id || offer.offerId || ""))}`) : []),
    !lead.selectedOffers?.length && lead.offerId ? `https://avtocena.com/cars/offer/${encodeURIComponent(lead.offerId)}` : "",
    lead.city || "",
    lead.budgetRub
      ? `Бюджет: ${Number(lead.budgetRub).toLocaleString("ru")} ₽`
      : "",
    String(lead.comment || "").slice(0, 1200),
    `https://avtocena.com/crm/leads?id=${encodeURIComponent(lead.id)}`,
  ]
    .filter(Boolean)
    .join("\n");
}
const QUEUE = "telegram/crm-outbox.json";
export async function enqueueMessage(input: {
  id: string;
  chatId: string;
  text: string;
  leadId: string;
  audience: "admin" | "group" | "customer";
  keyboard?: any;
}) {
  return appendChunkedDataJson(QUEUE, {
    ...input,
    createdAt: new Date().toISOString(),
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
  });
}
export async function flushCrmNotifications(limit = 2) {
  if (process.env.CRM_BOT_POLL_WORKER !== "1" && await pollingEnabled()) return { sent: 0, external: true };
  const config = await getTelegramRuntimeConfig();
  if (!config?.token) return { sent: 0, configured: false };
  // A lease prevents overlapping browser, webhook and worker drains.
  const leaseId = crypto.randomUUID();
  let acquired = false;
  await mutateDataJson(
    "telegram/crm-outbox-lease.json",
    { id: "", until: 0 },
    (lease) => {
      acquired = false;
      if (lease.until > Date.now()) return lease;
      acquired = true;
      return { id: leaseId, until: Date.now() + 90_000 };
    },
  );
  if (!acquired) return { sent: 0, busy: true };
  let sent = 0;
  try {
    await queueCrmAdminNotifications();
    const leads = await readChunkedDataJson<any>("leads/leads.json", []);
    const queue = await readChunkedDataJson<any>(QUEUE, []);
    for (const item of queue
      .filter(
        (item) =>
          item.audience === "customer" &&
          item.status !== "sent" &&
          item.status !== "cancelled" &&
          Number(item.nextAttemptAt || 0) <= Date.now(),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)) {
      const lead = leads.find((lead) => lead.id === item.leadId);
      const allowed =
        item.audience === "admin"
          ? Boolean(await botAdmin(item.chatId)) && !lead?.archivedAt
          : String(lead?.telegramChatId || "") === item.chatId;
      if (!allowed) {
        await updateChunkedDataJson<any>(QUEUE, item.id, (row) => ({
          ...row,
          status: "cancelled",
        }));
        continue;
      }
      try {
        const message = await telegramSend(
          config.token,
          item.chatId,
          item.text,
          item.keyboard,
        );
        await updateChunkedDataJson<any>(QUEUE, item.id, (row) => ({
          ...row,
          status: "sent",
          sentAt: new Date().toISOString(),
          messageId: message.message_id,
          lastError: "",
        }));
        sent++;
      } catch {
        await updateChunkedDataJson<any>(QUEUE, item.id, (row) => ({
          ...row,
          status: "pending",
          attempts: Number(row.attempts || 0) + 1,
          nextAttemptAt:
            Date.now() +
            Math.min(
              3600000,
              30000 * 2 ** Math.min(7, Number(row.attempts || 0)),
            ),
          lastError: "Не доставлено, повтор запланирован",
        }));
      }
    }
    return { sent, configured: true };
  } finally {
    await mutateDataJson(
      "telegram/crm-outbox-lease.json",
      { id: "", until: 0 },
      (lease) => (lease.id === leaseId ? { id: "", until: 0 } : lease),
    );
  }
}

export async function queueCrmAdminNotifications() {
    const leads = await readChunkedDataJson<any>("leads/leads.json", []);
    const queue = await readChunkedDataJson<any>(QUEUE, []);
    // A recipient correction moves only unfinished notices and revokes old claims.
    for (const item of queue.filter(row => row.audience === "group" &&
      !["sent", "cancelled"].includes(row.status) && String(row.chatId) !== groupTarget.chatId)) {
      await updateChunkedDataJson<any>(QUEUE, item.id, row =>
        row.audience === "group" && !["sent", "cancelled"].includes(row.status) && String(row.chatId) !== groupTarget.chatId
          ? {...row, chatId: groupTarget.chatId, relayHash: "", relayUntil: 0, lastAckHash: "", nextAttemptAt: 0}
          : row);
    }
    const pendingLegacy = new Set(queue.filter(row => row.audience === "admin" && !["sent", "cancelled"].includes(row.status)).map(row => row.leadId));
    // notificationRequestedAt excludes historical/test rows from unsolicited backfill.
    for (const lead of leads
      .filter(
        (lead) =>
          lead.notificationRequestedAt &&
          (!lead.notificationsQueuedAt || pendingLegacy.has(lead.id)) &&
          !lead.groupNotificationQueuedAt &&
          !lead.archivedAt,
      )
      .slice(0, 5)) {
        await enqueueMessage({
          id: `group_${lead.id}`,
          chatId: groupTarget.chatId,
          leadId: lead.id,
          audience: "group",
          text: leadNotice(lead),
          keyboard: [
            [
              {
                text: "Открыть заявку",
                url: `https://avtocena.com/crm/leads?id=${encodeURIComponent(lead.id)}`,
              },
            ],
          ],
        });
      await updateChunkedDataJson<any>(
        "leads/leads.json",
        lead.id,
        (stored) => ({
          ...stored,
          notificationsQueuedAt: new Date().toISOString(),
          groupNotificationQueuedAt: new Date().toISOString(),
        }),
      );
    }
}
