import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, AUTH_MAX_AGE_SECONDS, createSessionCookie, isCrmRole } from "@/lib/auth";
import { readCrmUsers } from "@/lib/crm-users";
import { mutateDataJson, readDataJson } from "@/lib/data";
import { getTelegramRuntimeConfig, type TelegramRuntimeConfig } from "@/lib/telegram-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHALLENGES_PATH = "auth/telegram-login-challenges.json";
const CHALLENGE_COOKIE = "avtocena_tg_bot_login";
const LOGIN_WEBHOOK_URL = "https://avtocena.com/api/telegram/webhook-v2";
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

async function ensureLoginWebhook(config: TelegramRuntimeConfig) {
  const apiBase = `https://api.telegram.org/bot${config.token}`;
  const infoResponse = await fetch(`${apiBase}/getWebhookInfo`, {
    method: "POST",
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const info = await infoResponse.json().catch(() => null) as { ok?: boolean; result?: { url?: string } } | null;
  if (!infoResponse.ok || !info?.ok) throw new Error("telegram_getWebhookInfo_failed");
  if (String(info.result?.url || "") === LOGIN_WEBHOOK_URL) return;

  const setResponse = await fetch(`${apiBase}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: LOGIN_WEBHOOK_URL,
      secret_token: config.webhookSecret,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  const setResult = await setResponse.json().catch(() => null) as { ok?: boolean; description?: string } | null;
  if (!setResponse.ok || !setResult?.ok) {
    throw new Error(String(setResult?.description || "telegram_setWebhook_failed").slice(0, 200));
  }
}

export async function POST(request: Request) {
  const config = await getTelegramRuntimeConfig();
  const username = String(config?.username || "").replace(/^@+/, "").trim();
  if (!config?.token || !username) {
    return NextResponse.json({ ok: false, error: "telegram_not_configured" }, { status: 503 });
  }

  try {
    await ensureLoginWebhook(config);
  } catch (error) {
    console.error("telegram_login_webhook_switch_failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ ok: false, error: "telegram_webhook_switch_failed" }, { status: 502 });
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

  await mutateDataJson<LoginChallenge[]>(CHALLENGES_PATH, [], (stored) => [
    ...cleanChallenges(Array.isArray(stored) ? stored : [], now),
    challenge,
  ].slice(-MAX_STORED_CHALLENGES));

  const response = NextResponse.json({
    ok: true,
    status: "pending",
    telegramUrl: `https://t.me/${encodeURIComponent(username)}?start=login_${rawToken}`,
    expiresIn: MAX_AGE_SECONDS,
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
