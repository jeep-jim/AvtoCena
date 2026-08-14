import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getTelegramRuntimeConfig } from "@/lib/telegram-config";
import { runPublicBotSubscriptionNotifications } from "@/lib/telegram-public-bot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  const expected = String(process.env.AUTH_ACCESS_KEY || "");
  const supplied = String(request.headers.get("x-auth-key") || "");
  if (!safeEqual(expected, supplied)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const config = await getTelegramRuntimeConfig();
  if (!config?.token) {
    return NextResponse.json({ ok: false, error: "telegram_not_configured" }, { status: 503 });
  }

  const result = await runPublicBotSubscriptionNotifications(config.token);
  return NextResponse.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
}
