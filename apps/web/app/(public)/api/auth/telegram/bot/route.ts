import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, AUTH_MAX_AGE_SECONDS, createSessionCookie, isCrmRole } from "@/lib/auth";
import { readCrmUsers } from "@/lib/crm-users";
import { mutateDataJson, readDataJson } from "@/lib/data";
import { getTelegramRuntimeConfig } from "@/lib/telegram-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHALLENGES_PATH = "auth/telegram-login-challenges.json";
const CHALLENGE_COOKIE = "avtocena_tg_bot_login";
const CANONICAL_WEBHOOK_URL = "https://avtocena.com/api/telegram/webhook";
const MAX_AGE_SECONDS = 5 * 60;
const MAX_STORED_CHALLENGES = 200;

type LoginChallenge = {
  tokenHash: string;
  status: "pending" | "approved" | "denied";
  nextPath: string;
  createdAt: string;
  expiresAt: string;
  approvedAt?: string;
  userId?: string;
};

type WebhookInfo = {
  url?: string;
  pending_update_count?: number;
  last_error_date?: number;
  last_error_message?: string;
  allowed_updates?: string[];
};

function safeNext(value: unknown) {
  const next = typeof value === "string" ? value : "";
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/crm";
  return next;
}

function tokenHash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function parseCookie(request: Request, name: string) {
  const raw = request.headers.get("cookie") || "";
  for (const chunk of raw.split(";")) {
    const index = chunk.indexOf("=");
    if (index < 0) continue;
    if (chunk.slice(0, index).trim() === name) return decodeURIComponent(chunk.slice(index + 1).trim());
  }
  return "";
}

function cleanChallenges(challenges: LoginChallenge[], now = Date.now()) {
  return challenges
    .filter((challenge) => Date.parse(challenge.expiresAt) > now)
    .slice(-MAX_STORED_CHALLENGES);
}

function clearChallengeCookie(response: NextResponse) {
  response.cookies.set(CHALLENGE_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

async function telegramRequest<T>(token: string, method: string, body?: Record<string, unknown>) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; result?: T; description?: string } | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(String(payload?.description || `telegram_${method}_${response.status}`).slice(0, 300));
  }
  return payload.result as T;
}

function deliveryWebhookUrl(webhookSecret: string) {
  return `${CANONICAL_WEBHOOK_URL}?key=${encodeURIComponent(webhookSecret)}`;
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

function safeWebhookStatus(info?: WebhookInfo | null) {
  return {
    url: publicWebhookUrl(info?.url),
    pending: Number(info?.pending_update_count || 0),
    lastError: String(info?.last_error_message || "").slice(0, 240),
    lastErrorAt: info?.last_error_date ? new Date(info.last_error_date * 1000).toISOString() : "",
    allowedUpdates: Array.isArray(info?.allowed_updates) ? info.allowed_updates : [],
  };
}

async function verifyAndRepairWebhook(token: string, webhookSecret: string) {
  const expectedUrl = deliveryWebhookUrl(webhookSecret);
  let before: WebhookInfo | null = null;
  let repairError = "";
  try {
    before = await telegramRequest<WebhookInfo>(token, "getWebhookInfo");
  } catch (error) {
    repairError = error instanceof Error ? error.message : "getWebhookInfo_failed";
  }

  const allowed = Array.isArray(before?.allowed_updates) ? before!.allowed_updates! : [];
  const needsRepair = !before
    || String(before.url || "") !== expectedUrl
    || !allowed.includes("message")
    || !allowed.includes("callback_query");

  if (needsRepair) {
    try {
      await telegramRequest<boolean>(token, "setWebhook", {
        url: expectedUrl,
        secret_token: webhookSecret,
        allowed_updates: ["message", "callback_query", "my_chat_member", "channel_post", "edited_channel_post"],
        drop_pending_updates: false,
      });
      repairError = "";
    } catch (error) {
      repairError = error instanceof Error ? error.message : "setWebhook_failed";
    }
  }

  let after = before;
  try {
    after = await telegramRequest<WebhookInfo>(token, "getWebhookInfo");
  } catch (error) {
    if (!repairError) repairError = error instanceof Error ? error.message : "getWebhookInfo_failed";
  }

  return {
    ok: String(after?.url || "") === expectedUrl,
    repaired: needsRepair && !repairError,
    error: repairError,
    status: safeWebhookStatus(after),
  };
}

export async function POST(request: Request) {
  const config = await getTelegramRuntimeConfig();
  const username = String(config?.username || "").replace(/^@+/, "").trim();
  if (!config?.token || !username) {
    return NextResponse.json({ ok: false, error: "telegram_not_configured" }, { status: 503 });
  }

  const webhook = await verifyAndRepairWebhook(config.token, config.webhookSecret);
  if (!webhook.ok) {
    return NextResponse.json({
      ok: false,
      error: "telegram_webhook_unavailable",
      detail: webhook.error || webhook.status.lastError || "Telegram webhook не активен",
      webhook: webhook.status,
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }

  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const nextPath = safeNext(body.next);
  const rawToken = crypto.randomBytes(24).toString("base64url");
  const now = Date.now();
  const challenge: LoginChallenge = {
    tokenHash: tokenHash(rawToken),
    status: "pending",
    nextPath,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + MAX_AGE_SECONDS * 1000).toISOString(),
  };

  await mutateDataJson<LoginChallenge[]>(CHALLENGES_PATH, [], (stored) => {
    const cleaned = cleanChallenges(Array.isArray(stored) ? stored : [], now);
    const withoutOlderPending = cleaned.filter((item) => item.status !== "pending");
    return [...withoutOlderPending, challenge].slice(-MAX_STORED_CHALLENGES);
  });

  const response = NextResponse.json({
    ok: true,
    status: "pending",
    telegramUrl: `https://t.me/${encodeURIComponent(username)}?start=login_${rawToken}`,
    expiresIn: MAX_AGE_SECONDS,
    webhook: webhook.status,
    webhookRepaired: webhook.repaired,
  });
  response.headers.set("cache-control", "no-store");
  response.cookies.set(CHALLENGE_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return response;
}

export async function GET(request: Request) {
  const rawToken = parseCookie(request, CHALLENGE_COOKIE);
  if (!rawToken) {
    return NextResponse.json({ ok: false, status: "missing", error: "telegram_login_missing" }, { status: 404 });
  }

  const hash = tokenHash(rawToken);
  const challenges = await readDataJson<LoginChallenge[]>(CHALLENGES_PATH, []);
  const challenge = (Array.isArray(challenges) ? challenges : []).find((item) => item.tokenHash === hash);
  const now = Date.now();

  if (!challenge || Date.parse(challenge.expiresAt) <= now) {
    await mutateDataJson<LoginChallenge[]>(CHALLENGES_PATH, [], (stored) => cleanChallenges(Array.isArray(stored) ? stored : [], now));
    const response = NextResponse.json({ ok: false, status: "expired", error: "telegram_login_expired" }, { status: 410 });
    clearChallengeCookie(response);
    return response;
  }

  if (challenge.status === "pending") {
    const response = NextResponse.json({ ok: true, status: "pending" });
    response.headers.set("cache-control", "no-store");
    return response;
  }

  if (challenge.status === "denied" || !challenge.userId) {
    const response = NextResponse.json({ ok: false, status: "denied", error: "telegram_not_allowed" }, { status: 403 });
    clearChallengeCookie(response);
    return response;
  }

  const users = await readCrmUsers();
  const user = users.find((candidate) => candidate.id === challenge.userId && candidate.status !== "disabled" && isCrmRole(candidate.role));
  if (!user) {
    const response = NextResponse.json({ ok: false, status: "denied", error: "telegram_not_allowed" }, { status: 403 });
    clearChallengeCookie(response);
    return response;
  }

  await mutateDataJson<LoginChallenge[]>(CHALLENGES_PATH, [], (stored) =>
    cleanChallenges((Array.isArray(stored) ? stored : []).filter((item) => item.tokenHash !== hash), now));

  const response = NextResponse.json({ ok: true, status: "approved", next: safeNext(challenge.nextPath) });
  response.headers.set("cache-control", "no-store");
  response.cookies.set(AUTH_COOKIE_NAME, createSessionCookie(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_MAX_AGE_SECONDS,
  });
  clearChallengeCookie(response);
  return response;
}
