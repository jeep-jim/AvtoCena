import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  appendChunkedDataJson,
  getJsonStorage,
  mutateDataJson,
  readChunkedDataJson,
  updateChunkedDataJson,
} from "@/lib/data";
import { getTelegramRuntimeConfig } from "@/lib/telegram-config";
import { handlePrivateEmployeeLoginStart } from "@/lib/telegram-employee-login";
import { handlePublicBotUpdate } from "@/lib/telegram-public-bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pilotDealer = {
  id: "dealer_topavto",
  name: "TopAvto",
  city: "Новокузнецк",
  status: "verified",
  pilot: true,
  markets: ["Япония", "Китай", "Корея", "ОАЭ", "Европа", "Грузия"],
  telegramChannel: "",
  telegramConnected: false,
  logoUrl: "",
  headerImageUrl: "",
  reviewsEnabled: true,
  photoFeedEnabled: true,
};

function cleanUsername(value: unknown) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function telegramApiUrl(method: string, token: string) {
  return `https://api.telegram.org/bot${token}/${method}`;
}

async function telegramCall<T>(token: string, method: string, body: Record<string, unknown>) {
  const response = await fetch(telegramApiUrl(method, token), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; result?: T; description?: string } | null;
  if (!response.ok || !payload?.ok) throw new Error(payload?.description || `telegram_${method}_failed`);
  return payload.result as T;
}

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

async function handlePrivateLeadStart(update: any, token: string) {
  const message = update?.message;
  if (!message?.chat?.id || message.chat.type !== "private") return false;
  const text = String(message.text || "").trim();
  const match = text.match(/^\/start(?:@[A-Za-z0-9_]+)?\s+lead_([A-Za-z0-9_-]{16,64})$/);
  if (!match?.[1]) return false;

  const rawToken = match[1];
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const leads = await readChunkedDataJson<any>("leads/leads.json", []);
  const now = new Date();
  const lead = leads.find((candidate) => candidate.telegramBindTokenHash === tokenHash
    && candidate.telegramBindExpiresAt
    && Date.parse(candidate.telegramBindExpiresAt) > now.getTime());
  const chatId = String(message.chat.id);

  if (!lead) {
    await telegramCall(token, "sendMessage", {
      chat_id: chatId,
      text: "Эта ссылка на заявку уже использована или устарела. Вернитесь в АвтоЦену и отправьте заявку ещё раз — новая ссылка будет создана автоматически.",
    });
    return true;
  }

  const boundAt = now.toISOString();
  const telegramUsername = cleanUsername(message.from?.username);
  const telegramUserId = String(message.from?.id || message.chat.id);
  const telegramDisplayName = [message.from?.first_name, message.from?.last_name].filter(Boolean).join(" ").trim();

  const updatedLead = await updateChunkedDataJson<any>("leads/leads.json", lead.id, (stored) => ({
    ...stored,
    updatedAt: boundAt,
    telegramChatId: chatId,
    telegramUserId,
    telegramUsername: telegramUsername || stored.telegramUsername || stored.telegram || "",
    telegramDisplayName: telegramDisplayName || stored.telegramDisplayName || "",
    telegramBoundAt: boundAt,
    telegramDeliveryStatus: "connected",
    telegramBindTokenHash: "",
    telegramBindExpiresAt: "",
  })) || lead;

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
    id: `telegram_bound_${lead.id}_${Date.now()}`,
    createdAt: boundAt,
    type: "lead_telegram_connected",
    title: "Клиент подключил Telegram",
    leadId: lead.id,
    clientId: lead.clientId || "",
    text: telegramUsername ? `@${telegramUsername}` : telegramDisplayName || telegramUserId,
  });

  await telegramCall(token, "sendMessage", {
    chat_id: chatId,
    text: "✅ Telegram подключён к вашей заявке в АвтоЦене. Ниже отправляю сохранённые варианты и расчёты. Менеджер сможет продолжить общение здесь.",
    disable_web_page_preview: true,
  });

  const offers = Array.isArray(updatedLead.selectedOffers) ? updatedLead.selectedOffers.slice(0, 5) : [];
  if (offers.length) {
    for (const [index, offer] of offers.entries()) {
      await telegramCall(token, "sendMessage", {
        chat_id: chatId,
        text: customerOfferMessage(offer, index, offers.length),
        disable_web_page_preview: true,
      });
    }
  } else {
    await telegramCall(token, "sendMessage", {
      chat_id: chatId,
      text: updatedLead.car
        ? `Запрос: ${updatedLead.car}\n\nМенеджер проверит варианты и отправит расчёт сюда.`
        : "Менеджер проверит вашу заявку и отправит расчёт сюда.",
    });
  }

  return true;
}

function mimeFromPath(filePath: string) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  return "image/jpeg";
}

async function downloadTelegramFile(token: string, fileId: string) {
  const file = await telegramCall<{ file_path?: string }>(token, "getFile", { file_id: fileId });
  if (!file?.file_path) throw new Error("telegram_file_path_missing");
  const response = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`, { cache: "no-store" });
  if (!response.ok) throw new Error("telegram_file_download_failed");
  return { data: Buffer.from(await response.arrayBuffer()), mimeType: response.headers.get("content-type") || mimeFromPath(file.file_path), filePath: file.file_path };
}

async function saveDealerLogo(token: string, dealerId: string, chatId: string) {
  const chat = await telegramCall<any>(token, "getChat", { chat_id: chatId });
  const fileId = chat?.photo?.big_file_id || chat?.photo?.small_file_id;
  if (!fileId) return null;
  const file = await downloadTelegramFile(token, fileId);
  const extension = file.mimeType === "image/png" ? "png" : file.mimeType === "image/webp" ? "webp" : "jpg";
  const objectKey = `dealers/${dealerId}/telegram-logo.${extension}`;
  const storage = getJsonStorage();
  if (!storage.putBinary) return null;
  await storage.putBinary(objectKey, file.data, file.mimeType);
  return { objectKey, url: `/api/dealers/${encodeURIComponent(dealerId)}/logo` };
}

function findChat(update: any) {
  return update?.my_chat_member?.chat || update?.channel_post?.chat || update?.edited_channel_post?.chat || null;
}

function isAdministratorUpdate(update: any) {
  const status = update?.my_chat_member?.new_chat_member?.status;
  return status === "administrator" || status === "creator";
}

export async function POST(request: Request) {
  const telegramConfig = await getTelegramRuntimeConfig();
  const token = telegramConfig?.token || "";
  const expectedSecret = telegramConfig?.webhookSecret || "";
  const headerSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";
  let urlSecret = "";
  try {
    urlSecret = new URL(request.url).searchParams.get("key") || "";
  } catch {}
  if (expectedSecret && headerSecret !== expectedSecret && urlSecret !== expectedSecret) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  if (!token) return NextResponse.json({ ok: true, ignored: "telegram_not_configured" });

  const update = await request.json().catch(() => null) as any;
  if (!update) return NextResponse.json({ ok: true, ignored: "invalid_update" });

  try {
    if (await handlePrivateEmployeeLoginStart(update, token)) {
      return NextResponse.json({ ok: true, handled: "employee_login_confirmed" });
    }
  } catch (error) {
    console.error("telegram_employee_login_failed", error);
    return NextResponse.json({ ok: true, warning: "employee_login_processing_failed" });
  }

  try {
    if (await handlePrivateLeadStart(update, token)) {
      return NextResponse.json({ ok: true, handled: "lead_telegram_connected" });
    }
  } catch (error) {
    console.error("telegram_lead_start_failed", error);
    return NextResponse.json({ ok: true, warning: "lead_start_processing_failed" });
  }

  try {
    if (await handlePublicBotUpdate(update, token)) {
      return NextResponse.json({ ok: true, handled: "public_bot" });
    }
  } catch (error) {
    console.error("telegram_public_bot_failed", error);
    return NextResponse.json({ ok: true, warning: "public_bot_processing_failed" });
  }

  const chat = findChat(update);
  if (!chat?.id) return NextResponse.json({ ok: true, ignored: "no_chat" });

  const chatId = String(chat.id);
  const chatUsername = cleanUsername(chat.username);
  let matchedDealer: any = null;

  try {
    await mutateDataJson<any[]>("dealers/dealers.json", [pilotDealer], async (stored) => {
      const dealers = Array.isArray(stored) && stored.length ? stored : [pilotDealer];
      const dealer = dealers.find((item) => String(item.telegramChatId || "") === chatId || (chatUsername && cleanUsername(item.telegramChannel) === chatUsername));
      if (!dealer) return dealers;
      matchedDealer = dealer;

      const connected = isAdministratorUpdate(update) || Boolean(dealer.telegramConnected && String(dealer.telegramChatId || "") === chatId);
      let logo = null;
      if (connected) {
        try { logo = await saveDealerLogo(token, dealer.id, chatId); } catch (error) { console.error("telegram_dealer_logo_failed", error); }
      }

      return dealers.map((item) => item.id === dealer.id ? {
        ...item,
        telegramChatId: chatId,
        telegramChannel: chatUsername ? `@${chatUsername}` : item.telegramChannel || "",
        telegramTitle: String(chat.title || item.telegramTitle || ""),
        telegramConnected: connected,
        telegramConnectedAt: connected ? item.telegramConnectedAt || new Date().toISOString() : item.telegramConnectedAt || null,
        logoObjectKey: logo?.objectKey || item.logoObjectKey || "",
        logoUrl: logo?.url || item.logoUrl || "",
        updatedAt: new Date().toISOString(),
      } : item);
    });

    const post = update.channel_post || update.edited_channel_post;
    if (matchedDealer && post && matchedDealer.status === "verified" && matchedDealer.photoFeedEnabled !== false) {
      const text = String(post.text || post.caption || "").trim();
      const photos = Array.isArray(post.photo) ? post.photo : [];
      const largestPhoto = photos.length ? photos[photos.length - 1] : null;
      let mediaObjectKey = "";
      let mediaUrl = "";
      if (largestPhoto?.file_id) {
        try {
          const media = await downloadTelegramFile(token, largestPhoto.file_id);
          const extension = media.mimeType === "image/png" ? "png" : media.mimeType === "image/webp" ? "webp" : "jpg";
          mediaObjectKey = `dealers/${matchedDealer.id}/feed/${post.message_id}-${Date.now()}.${extension}`;
          const storage = getJsonStorage();
          if (storage.putBinary) {
            await storage.putBinary(mediaObjectKey, media.data, media.mimeType);
            mediaUrl = `/api/dealers/${encodeURIComponent(matchedDealer.id)}/feed/${encodeURIComponent(String(post.message_id))}`;
          }
        } catch (error) {
          console.error("telegram_dealer_feed_media_failed", error);
        }
      }

      await appendChunkedDataJson("dealers/feed.json", {
        id: `telegram_${matchedDealer.id}_${post.message_id}`,
        dealerId: matchedDealer.id,
        telegramMessageId: String(post.message_id),
        telegramChatId: chatId,
        type: largestPhoto ? "photo" : "text",
        text,
        mediaObjectKey,
        mediaUrl,
        publishedAt: new Date(Number(post.date || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        createdAt: new Date().toISOString(),
        status: "published",
      });
    }

    return NextResponse.json({ ok: true, dealerId: matchedDealer?.id || null });
  } catch (error) {
    console.error("telegram_webhook_failed", error);
    return NextResponse.json({ ok: true, warning: "processing_failed" });
  }
}
