import { NextResponse } from "next/server";
import { appendDataJson, readDataJson } from "@/lib/data";
import { getCurrentUser, isCrmRole, normalizeTelegramUsername } from "@/lib/auth";

type PartnerRecord = {
  id: string;
  createdAt: string;
  updatedAt?: string;
  code?: string | null;
  name: string;
  telegram: string | null;
  status: "pending" | "active" | "rejected" | "disabled";
  payoutRub: number;
  link?: string | null;
  accessKey?: string | null;
  partnerType?: string;
  trafficSource?: string | null;
  comment?: string | null;
  notificationSent?: boolean;
};

function cleanText(value: unknown, maxLength: number) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function wantsHtml(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  return contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
}

function landingRedirect(request: Request, state: "sent" | "duplicate" | "error") {
  const url = new URL("/partner/landing", request.url);
  url.searchParams.set("request", state);
  url.hash = "access-request";
  return NextResponse.redirect(url, 303);
}

async function readPayload(request: Request) {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return request.json().catch(() => ({}));
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return {};

  return Object.fromEntries(formData.entries());
}

async function notifyTelegram(record: PartnerRecord) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();

  if (!token || !chatId) return false;

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://avtocena.com").replace(/\/$/, "");
  const text = [
    "🆕 Новая заявка на партнёрский доступ",
    "",
    `Имя: ${record.name}`,
    `Telegram: ${record.telegram || "—"}`,
    `Тип: ${record.partnerType || "—"}`,
    `Источник трафика: ${record.trafficSource || "—"}`,
    `Комментарий: ${record.comment || "—"}`,
    "",
    `ID: ${record.id}`,
  ].join("\n");

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
        reply_markup: {
          inline_keyboard: [[{ text: "Открыть партнёров CRM", url: `${appUrl}/crm/partners` }]],
        },
      }),
      cache: "no-store",
    });

    return response.ok;
  } catch {
    return false;
  }
}

export async function GET() {
  const user = getCurrentUser();

  if (!isCrmRole(user?.role)) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  return NextResponse.json(readDataJson<PartnerRecord[]>("partners/partners.json", []));
}

export async function POST(request: Request) {
  const body = await readPayload(request);
  const htmlRequest = wantsHtml(request);

  // Простая honeypot-защита от автоматического спама.
  if (cleanText(body.website, 200)) {
    return htmlRequest
      ? landingRedirect(request, "sent")
      : NextResponse.json({ ok: true, accepted: true }, { status: 202 });
  }

  const name = cleanText(body.name, 120);
  const telegramRaw = cleanText(body.telegram, 80);
  const telegramUsername = normalizeTelegramUsername(telegramRaw);
  const trafficSource = cleanText(body.trafficSource, 80);
  const comment = cleanText(body.comment, 1200);

  if (!name || !telegramUsername || !trafficSource) {
    return htmlRequest
      ? landingRedirect(request, "error")
      : NextResponse.json(
          { ok: false, error: "name_telegram_and_traffic_source_required" },
          { status: 400 },
        );
  }

  const telegram = `@${telegramUsername}`;
  const partners = readDataJson<PartnerRecord[]>("partners/partners.json", []);
  const duplicate = partners.find(
    (partner) =>
      partner.status === "pending" &&
      normalizeTelegramUsername(partner.telegram || "") === telegramUsername,
  );

  if (duplicate) {
    return htmlRequest
      ? landingRedirect(request, "duplicate")
      : NextResponse.json({ ok: true, duplicate: true, requestId: duplicate.id });
  }

  const now = new Date().toISOString();
  const requestId = `partner_request_${Date.now()}`;
  const record: PartnerRecord = {
    id: requestId,
    createdAt: now,
    updatedAt: now,
    code: null,
    name,
    telegram,
    status: "pending",
    payoutRub: 10000,
    link: null,
    accessKey: null,
    partnerType: trafficSource === "cpa-network" ? "cpa-network" : "direct",
    trafficSource,
    comment: comment || null,
    notificationSent: false,
  };

  const notificationSent = await notifyTelegram(record);
  record.notificationSent = notificationSent;
  appendDataJson("partners/partners.json", record);

  return htmlRequest
    ? landingRedirect(request, "sent")
    : NextResponse.json(
        {
          ok: true,
          requestId,
          status: "pending",
          notificationSent,
        },
        { status: 201 },
      );
}
