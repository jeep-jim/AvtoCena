import { NextResponse } from "next/server";
import { appendChunkedDataJson, getJsonStorage, mutateDataJson } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const pilotDealer = {
  id: "dealer_topavto",
  name: "TopAvto",
  city: "Новокузнецк",
  status: "verified",
  pilot: true,
  markets: ["Япония", "Китай", "Корея", "ОАЭ", "Европа", "Грузия", "Кыргызстан"],
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
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET || "";
  const actualSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";
  if (expectedSecret && actualSecret !== expectedSecret) return NextResponse.json({ ok: false }, { status: 403 });
  if (!token) return NextResponse.json({ ok: true, ignored: "telegram_not_configured" });

  const update = await request.json().catch(() => null) as any;
  if (!update) return NextResponse.json({ ok: true, ignored: "invalid_update" });
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
