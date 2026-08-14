import { NextResponse } from "next/server";
import { getTelegramRuntimeConfig } from "@/lib/telegram-config";
import { handlePrivateEmployeeLoginStart } from "@/lib/telegram-employee-login";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LEGACY_WEBHOOK_URL = "https://avtocena.com/api/telegram/webhook";

export async function POST(request: Request) {
  const config = await getTelegramRuntimeConfig();
  const token = config?.token || "";
  const expectedSecret = config?.webhookSecret || "";
  const actualSecret = request.headers.get("x-telegram-bot-api-secret-token") || "";

  if (expectedSecret && actualSecret !== expectedSecret) {
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
    const response = await fetch(LEGACY_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(actualSecret ? { "x-telegram-bot-api-secret-token": actualSecret } : {}),
      },
      body: JSON.stringify(update),
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    return new NextResponse(text || JSON.stringify({ ok: response.ok }), {
      status: response.status,
      headers: { "content-type": response.headers.get("content-type") || "application/json" },
    });
  } catch (error) {
    console.error("telegram_legacy_webhook_forward_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: true, warning: "legacy_forward_failed" });
  }
}
