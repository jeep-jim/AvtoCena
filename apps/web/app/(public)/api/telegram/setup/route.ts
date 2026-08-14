import { NextResponse } from "next/server";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import {
  deriveTelegramWebhookSecret,
  expectedTelegramBotUsername,
  getTelegramPublicConfig,
  saveTelegramRuntimeConfig,
  telegramWebhookUrl,
} from "@/lib/telegram-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeUsername(value: unknown) {
  return String(value || "").trim().replace(/^@+/, "").toLowerCase();
}

function adminAllowed() {
  const user = getCurrentUser();
  return Boolean(user && isAdminRole(user.role));
}

async function telegramRequest<T>(token: string, method: string, body?: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!response?.ok) throw new Error(`telegram_${method}_failed`);
  const payload = await response.json().catch(() => null) as { ok?: boolean; result?: T } | null;
  if (!payload?.ok) throw new Error(`telegram_${method}_failed`);
  return payload.result as T;
}

export async function GET() {
  if (!adminAllowed()) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const config = await getTelegramPublicConfig();
  return NextResponse.json({ ok: true, ...config }, {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!adminAllowed()) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const token = String(body.token || "").trim();
  const requestedUsername = normalizeUsername(body.username) || expectedTelegramBotUsername();
  if (!token) return NextResponse.json({ ok: false, error: "token_required" }, { status: 400 });
  if (requestedUsername !== expectedTelegramBotUsername()) {
    return NextResponse.json({ ok: false, error: "wrong_bot_username" }, { status: 400 });
  }

  try {
    const me = await telegramRequest<{ id: number; is_bot?: boolean; first_name?: string; username?: string }>(token, "getMe");
    const actualUsername = normalizeUsername(me?.username);
    if (!me?.id || me.is_bot === false || actualUsername !== expectedTelegramBotUsername()) {
      return NextResponse.json({ ok: false, error: "wrong_bot" }, { status: 403 });
    }

    const existing = await getTelegramPublicConfig();
    if (existing.configured && existing.botId && String(existing.botId) !== String(me.id)) {
      return NextResponse.json({ ok: false, error: "different_bot_already_configured" }, { status: 409 });
    }

    const webhookUrl = telegramWebhookUrl();
    const webhookSecret = deriveTelegramWebhookSecret(actualUsername);

    // Persist first, so the webhook can authenticate/decrypt immediately if Telegram delivers an update.
    await saveTelegramRuntimeConfig({
      token,
      username: actualUsername,
      botId: String(me.id),
      firstName: me.first_name || "АвтоЦена",
      webhookUrl,
    });

    await telegramRequest<boolean>(token, "setWebhook", {
      url: webhookUrl,
      secret_token: webhookSecret,
      allowed_updates: ["message", "my_chat_member", "channel_post", "edited_channel_post"],
      drop_pending_updates: false,
    });

    const webhook = await telegramRequest<{
      url?: string;
      pending_update_count?: number;
      last_error_date?: number;
      last_error_message?: string;
    }>(token, "getWebhookInfo");

    const webhookConfiguredAt = webhook?.url === webhookUrl ? new Date().toISOString() : "";
    const publicConfig = await saveTelegramRuntimeConfig({
      token,
      username: actualUsername,
      botId: String(me.id),
      firstName: me.first_name || "АвтоЦена",
      webhookUrl,
      webhookConfiguredAt,
      pendingUpdateCount: Number(webhook?.pending_update_count || 0),
    });

    return NextResponse.json({
      ok: Boolean(webhookConfiguredAt),
      ...publicConfig,
      webhookMatches: webhook?.url === webhookUrl,
      telegramLastErrorAt: webhook?.last_error_date ? new Date(webhook.last_error_date * 1000).toISOString() : "",
      telegramLastError: webhook?.last_error_message ? String(webhook.last_error_message).slice(0, 300) : "",
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    console.error("telegram_setup_failed", error instanceof Error ? error.message : "setup_failed");
    return NextResponse.json({ ok: false, error: "telegram_setup_failed" }, { status: 502 });
  }
}
