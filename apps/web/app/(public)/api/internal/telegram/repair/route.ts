import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getTelegramRuntimeConfig, saveTelegramRuntimeConfig, telegramWebhookUrl } from "@/lib/telegram-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function telegramRequest<T>(token: string, method: string, body: Record<string, unknown> = {}) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; result?: T; description?: string } | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(String(payload?.description || `telegram_${method}_${response.status}`).slice(0, 300));
  }
  return payload.result as T;
}

export async function POST(request: Request) {
  const expected = String(process.env.AUTH_ACCESS_KEY || "");
  const supplied = String(request.headers.get("x-auth-key") || "");
  if (!safeEqual(expected, supplied)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const config = await getTelegramRuntimeConfig();
  if (!config?.token || !config.webhookSecret) {
    return NextResponse.json({ ok: false, error: "telegram_not_configured" }, { status: 503 });
  }

  const publicWebhookUrl = telegramWebhookUrl();
  const deliveryUrl = `${publicWebhookUrl}?key=${encodeURIComponent(config.webhookSecret)}`;
  try {
    await telegramRequest<boolean>(config.token, "setWebhook", {
      url: deliveryUrl,
      secret_token: config.webhookSecret,
      allowed_updates: ["message", "callback_query", "my_chat_member", "channel_post", "edited_channel_post"],
      drop_pending_updates: false,
    });

    const info = await telegramRequest<{
      url?: string;
      pending_update_count?: number;
      last_error_date?: number;
      last_error_message?: string;
      allowed_updates?: string[];
    }>(config.token, "getWebhookInfo");

    const actualUrl = String(info?.url || "");
    const matches = actualUrl === deliveryUrl;
    if (!matches) {
      return NextResponse.json({ ok: false, error: "telegram_webhook_mismatch" }, { status: 502 });
    }

    await saveTelegramRuntimeConfig({
      token: config.token,
      clientSecret: config.clientSecret,
      username: config.username,
      botId: config.botId,
      firstName: config.firstName,
      webhookUrl: publicWebhookUrl,
      webhookConfiguredAt: new Date().toISOString(),
      pendingUpdateCount: Number(info?.pending_update_count || 0),
    });

    return NextResponse.json({
      ok: true,
      webhook: publicWebhookUrl,
      pending: Number(info?.pending_update_count || 0),
      allowedUpdates: Array.isArray(info?.allowed_updates) ? info.allowed_updates : [],
      lastError: info?.last_error_message ? String(info.last_error_message).slice(0, 240) : "",
      lastErrorAt: info?.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : "",
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: "telegram_webhook_repair_failed",
      detail: error instanceof Error ? error.message : "unknown",
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
