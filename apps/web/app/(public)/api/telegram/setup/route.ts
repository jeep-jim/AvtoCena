import { NextResponse } from "next/server";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import {
  deriveTelegramWebhookSecret,
  expectedTelegramBotUsername,
  getTelegramPublicConfig,
  getTelegramRuntimeConfig,
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

class TelegramApiError extends Error {
  status: number;
  description: string;
  constructor(method: string, status: number, description: string) {
    super(`telegram_${method}_failed`);
    this.name = "TelegramApiError";
    this.status = status;
    this.description = description;
  }
}

async function telegramRequest<T>(token: string, method: string, body?: Record<string, unknown>) {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body || {}),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new TelegramApiError(method, 0, "Не удалось связаться с Telegram API");
  }

  const payload = await response.json().catch(() => null) as {
    ok?: boolean;
    result?: T;
    description?: string;
  } | null;

  if (!response.ok || !payload?.ok) {
    throw new TelegramApiError(
      method,
      response.status,
      String(payload?.description || `Telegram API HTTP ${response.status}`).slice(0, 300),
    );
  }
  return payload.result as T;
}

function failure(error: string, detail = "", stage = "", status = 502) {
  return NextResponse.json({ ok: false, error, detail, stage }, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function deliveryWebhookUrl(publicUrl: string, webhookSecret: string) {
  return `${publicUrl}?key=${encodeURIComponent(webhookSecret)}`;
}

function publicWebhookUrl(value: unknown) {
  const raw = String(value || "");
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return raw.split("?")[0];
  }
}

export async function GET() {
  if (!adminAllowed()) return failure("forbidden", "", "auth", 403);
  const config = await getTelegramPublicConfig();
  return NextResponse.json({ ok: true, ...config }, {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  if (!adminAllowed()) return failure("forbidden", "", "auth", 403);

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const incomingToken = String(body.token || "").trim();
  const clientSecret = String(body.clientSecret || "").trim();
  const requestedUsername = normalizeUsername(body.username) || expectedTelegramBotUsername();
  if (requestedUsername !== expectedTelegramBotUsername()) {
    return failure("wrong_bot_username", "", "token", 400);
  }
  if (clientSecret.length > 500) {
    return failure("client_secret_invalid", "Client Secret слишком длинный", "oidc", 400);
  }

  const runtimeConfig = await getTelegramRuntimeConfig().catch(() => null);
  const token = incomingToken || runtimeConfig?.token || "";
  if (!token) return failure("token_required", "", "token", 400);

  let me: { id: number; is_bot?: boolean; first_name?: string; username?: string };
  try {
    me = await telegramRequest(token, "getMe");
  } catch (error) {
    const telegramError = error instanceof TelegramApiError ? error : null;
    console.error("telegram_setup_getme_failed", telegramError?.status || 0, telegramError?.description || "unknown");
    return failure(
      telegramError?.status === 401 ? "token_invalid" : "telegram_getme_failed",
      telegramError?.description || "Не удалось проверить токен через Telegram getMe",
      "getMe",
      telegramError?.status === 401 ? 401 : 502,
    );
  }

  const actualUsername = normalizeUsername(me?.username);
  if (!me?.id || me.is_bot === false || actualUsername !== expectedTelegramBotUsername()) {
    return failure("wrong_bot", `Токен принадлежит @${actualUsername || "unknown"}`, "getMe", 403);
  }

  const existing = await getTelegramPublicConfig();
  if (existing.configured && existing.botId && String(existing.botId) !== String(me.id)) {
    return failure("different_bot_already_configured", "", "storage", 409);
  }

  const webhookUrl = telegramWebhookUrl();
  let webhookSecret = "";
  try {
    webhookSecret = deriveTelegramWebhookSecret(actualUsername);
    await saveTelegramRuntimeConfig({
      token,
      clientSecret: clientSecret || undefined,
      username: actualUsername,
      botId: String(me.id),
      firstName: me.first_name || "АвтоЦена",
      webhookUrl,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "telegram_storage_failed";
    console.error("telegram_setup_storage_failed", detail);
    return failure("telegram_storage_failed", detail, "storage", 500);
  }

  const webhookDeliveryUrl = deliveryWebhookUrl(webhookUrl, webhookSecret);
  try {
    await telegramRequest<boolean>(token, "setWebhook", {
      url: webhookDeliveryUrl,
      secret_token: webhookSecret,
      allowed_updates: ["message", "callback_query", "my_chat_member", "channel_post", "edited_channel_post"],
      drop_pending_updates: false,
    });
  } catch (error) {
    const telegramError = error instanceof TelegramApiError ? error : null;
    console.error("telegram_setup_webhook_failed", telegramError?.status || 0, telegramError?.description || "unknown");
    return failure(
      "telegram_webhook_failed",
      telegramError?.description || "Telegram не принял webhook",
      "setWebhook",
      502,
    );
  }

  let webhook: {
    url?: string;
    pending_update_count?: number;
    last_error_date?: number;
    last_error_message?: string;
  };
  try {
    webhook = await telegramRequest(token, "getWebhookInfo");
  } catch (error) {
    const telegramError = error instanceof TelegramApiError ? error : null;
    return failure(
      "telegram_webhook_status_failed",
      telegramError?.description || "Не удалось проверить установленный webhook",
      "getWebhookInfo",
      502,
    );
  }

  const webhookConfiguredAt = webhook?.url === webhookDeliveryUrl ? new Date().toISOString() : "";
  if (!webhookConfiguredAt) {
    return failure(
      "telegram_webhook_mismatch",
      webhook?.url ? `Telegram сохранил другой URL: ${publicWebhookUrl(webhook.url)}` : "Telegram не сохранил URL webhook",
      "getWebhookInfo",
      502,
    );
  }

  try {
    const publicConfig = await saveTelegramRuntimeConfig({
      token,
      clientSecret: clientSecret || undefined,
      username: actualUsername,
      botId: String(me.id),
      firstName: me.first_name || "АвтоЦена",
      webhookUrl,
      webhookConfiguredAt,
      pendingUpdateCount: Number(webhook?.pending_update_count || 0),
    });

    return NextResponse.json({
      ok: true,
      ...publicConfig,
      webhookMatches: true,
      telegramLastErrorAt: webhook?.last_error_date ? new Date(webhook.last_error_date * 1000).toISOString() : "",
      telegramLastError: webhook?.last_error_message ? String(webhook.last_error_message).slice(0, 300) : "",
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "telegram_storage_failed";
    return failure("telegram_storage_failed", detail, "final-storage", 500);
  }
}
