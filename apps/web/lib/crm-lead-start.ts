import crypto from "node:crypto";
import { readChunkedDataJson, updateChunkedDataJson, appendChunkedDataJson } from "./data";
import { telegramSend, enqueueMessage, flushCrmNotifications } from "./crm-notifications";
const cleanUsername = (value: unknown) => String(value || "").trim().replace(/^@+/, "").toLowerCase();

function formatRub(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0
    ? `${new Intl.NumberFormat("ru-RU").format(Math.round(number))} ₽`
    : "";
}

function compactBreakdown(offer: any) {
  const rows = Array.isArray(offer?.breakdown)
    ? offer.breakdown
    : Array.isArray(offer?.calculationSnapshot?.breakdown)
      ? offer.calculationSnapshot.breakdown
      : [];
  return rows.slice(0, 8).map((row: any) => {
    const label = String(row?.label || row?.title || row?.name || "").trim();
    const amount = Number(row?.amountRub ?? row?.valueRub ?? row?.rub ?? row?.amount ?? row?.value);
    if (!label || !Number.isFinite(amount) || amount <= 0) return "";
    return `• ${label}: ${formatRub(amount)}`;
  }).filter(Boolean);
}

function customerOfferMessage(offer: any, index: number, total: number) {
  const title = String(offer?.title || [offer?.make, offer?.model, offer?.year].filter(Boolean).join(" ") || "Автомобиль").trim();
  const meta = [offer?.marketLabel, offer?.year].filter(Boolean).join(" · ");
  const price = formatRub(offer?.totalRub);
  const breakdown = compactBreakdown(offer);
  return [
    total > 1 ? `🚘 Вариант ${index + 1} из ${total}` : "🚘 Ваш автомобиль",
    title,
    meta,
    price ? `Под ключ: ${price}` : "Точный расчёт проверит менеджер",
    ...breakdown,
    offer?.href ? String(offer.href) : "",
  ].filter(Boolean).join("\n");
}

export async function handlePrivateLeadStart(update: any, token: string) {
  const message = update?.message;
  if (!message?.from?.id || String(message.from.id) !== String(message.chat?.id) || message.chat.type !== "private") return false;
  const text = String(message.text || "").trim();
  const match = text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+lead_([A-Za-z0-9_-]{16,64})$/);
  if (!match?.[1]) return false;

  const rawToken = match[1];
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const leads = await readChunkedDataJson<any>("leads/leads.json", []);
  const now = new Date();
  const lead = leads.find((candidate) => candidate.telegramBindTokenHash === tokenHash
    && candidate.telegramBindExpiresAt
    && Date.parse(candidate.telegramBindExpiresAt) > now.getTime()
    || (candidate.telegramLastBindHash === tokenHash && String(candidate.telegramUserId || "") === String(message.from?.id)));
  const chatId = String(message.chat.id);

  if (!lead) {
    await telegramSend(token, chatId, "Эта ссылка на заявку уже использована или устарела. Вернитесь в АвтоЦену и отправьте заявку ещё раз — новая ссылка будет создана автоматически.");
    return true;
  }

  const boundAt = now.toISOString();
  const telegramUsername = cleanUsername(message.from?.username);
  const telegramUserId = String(message.from?.id || message.chat.id);
  const telegramDisplayName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ").trim();

  let claimed=false;
  const updatedLead = await updateChunkedDataJson<any>("leads/leads.json", lead.id, (stored) => {
    claimed=false;
    if(stored.telegramLastBindHash===tokenHash && String(stored.telegramUserId || "")===telegramUserId){claimed=true;return stored;}
    if(stored.telegramBindTokenHash!==tokenHash || !(Date.parse(stored.telegramBindExpiresAt || "")>Date.now()))return stored;
    claimed=true;
    return {...stored,updatedAt:boundAt,telegramChatId:chatId,telegramUserId,telegramUsername:telegramUsername || "",telegramDisplayName,
      telegramBoundAt:boundAt,telegramDeliveryStatus:"connected",telegramLastBindHash:tokenHash,telegramBindTokenHash:"",telegramBindExpiresAt:""};
  });
  if(!claimed)return true;

  if (lead.clientId) {
    await updateChunkedDataJson<any>("clients/clients.json", lead.clientId, (client) => ({
      ...client,
      updatedAt: boundAt,
      telegramChatId: chatId,
      telegramUserId,
      telegramUsername: telegramUsername || client.telegramUsername || client.telegram || "",
      telegramDisplayName: telegramDisplayName || client.telegramDisplayName || "",
      telegramBoundAt: boundAt,
    }));
  }

  await appendChunkedDataJson("activity/feed.json", {
    id: `telegram_bound_${lead.id}_${telegramUserId}`,
    createdAt: boundAt,
    type: "lead_telegram_connected",
    title: "Клиент подключил Telegram",
    leadId: lead.id,
    clientId: lead.clientId || "",
    text: telegramUsername ? `@${telegramUsername}` : telegramDisplayName || telegramUserId,
  });

  const offers = Array.isArray(updatedLead.selectedOffers) ? updatedLead.selectedOffers.slice(0,5) : [];
  await enqueueMessage({id:`bound_${lead.id}`,chatId,leadId:lead.id,audience:"customer",text:[
    "Заявка получена. Telegram подключён. Менеджер проверит автомобиль и ответит здесь. Можно написать дополнительные пожелания.",
    ...offers.map((offer:any,index:number)=>customerOfferMessage(offer,index,offers.length)),
    !offers.length ? updatedLead.car || "Запрос на подбор автомобиля" : ""
  ].filter(Boolean).join("\n\n")});
  try {await flushCrmNotifications(2);}catch{console.error("crm_bound_notification_pending");}

  return true;
}

