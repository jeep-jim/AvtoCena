import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser, isPartnerRole } from "@/lib/auth";
import { appendChunkedDataJson, readChunkedDataJson, readDataJson } from "@/lib/data";

type PartnerRecord = {
  id: string;
  code?: string | null;
  name?: string;
  telegram?: string | null;
  status?: string;
  partnerType?: string;
  balanceRub?: number;
};

type PayoutRequest = {
  id: string;
  createdAt: string;
  updatedAt: string;
  partnerId: string;
  partnerCode: string;
  partnerName: string;
  telegram: string | null;
  amountRub: number;
  status: "pending" | "approved" | "paid" | "rejected";
  comment: string | null;
  requestedByUserId: string;
  notificationSent: boolean;
};

function makeId(prefix: string) {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function clean(value: unknown, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function redirectToCabinet(request: Request, state: "sent" | "duplicate" | "empty" | "error") {
  const url = new URL("/partner", request.url);
  url.searchParams.set("payout", state);
  url.hash = "payout";
  return NextResponse.redirect(url, 303);
}

async function notifyTelegram(record: PayoutRequest) {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = process.env.TELEGRAM_ADMIN_CHAT_ID?.trim();

  if (!token || !chatId) return false;

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://avtocena.com").replace(/\/$/, "");
  const text = [
    "💸 Новый запрос выплаты партнёра",
    "",
    `Партнёр: ${record.partnerName}`,
    `Код: ${record.partnerCode}`,
    `Telegram: ${record.telegram || "—"}`,
    `Сумма: ${new Intl.NumberFormat("ru-RU").format(record.amountRub)} ₽`,
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

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!user || !isPartnerRole(user.role)) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  const partners = await readDataJson<PartnerRecord[]>("partners/partners.json", []);
  const partnerCode = user.partnerCode || "";
  const partner = partners.find((item) => item.code === partnerCode);

  if (!partner || partner.status === "disabled" || partner.status === "rejected") {
    return redirectToCabinet(request, "error");
  }

  if (partner.partnerType === "cpa-network") {
    return redirectToCabinet(request, "error");
  }

  const amountRub = Math.max(0, Number(partner.balanceRub || 0));
  if (!amountRub) {
    return redirectToCabinet(request, "empty");
  }

  const existing = await readChunkedDataJson<PayoutRequest>("partners/payout-requests.json", []);
  const pending = existing.find(
    (item) => item.partnerCode === partnerCode && item.status === "pending",
  );

  if (pending) {
    return redirectToCabinet(request, "duplicate");
  }

  const formData = await request.formData().catch(() => null);
  const comment = clean(formData?.get("comment"), 1000);
  const now = new Date().toISOString();
  const record: PayoutRequest = {
    id: makeId("payout"),
    createdAt: now,
    updatedAt: now,
    partnerId: partner.id,
    partnerCode,
    partnerName: partner.name || user.displayName,
    telegram: partner.telegram || `@${user.telegramUsername}`,
    amountRub,
    status: "pending",
    comment: comment || null,
    requestedByUserId: user.id,
    notificationSent: false,
  };

  record.notificationSent = await notifyTelegram(record);
  await appendChunkedDataJson("partners/payout-requests.json", record);

  return redirectToCabinet(request, "sent");
}
