import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, AUTH_MAX_AGE_SECONDS, createSessionCookie } from "@/lib/auth";
import { findCrmUserByTelegram, updateCrmUser } from "@/lib/crm-users";
import { getTelegramRuntimeConfig } from "@/lib/telegram-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TELEGRAM_ISSUER = "https://oauth.telegram.org";
const TELEGRAM_JWKS_URL = "https://oauth.telegram.org/.well-known/jwks.json";
const MAX_AUTH_AGE_SECONDS = 10 * 60;

type TelegramJwtHeader = {
  alg?: string;
  kid?: string;
};

type TelegramJwtClaims = {
  iss?: string;
  aud?: string | string[];
  sub?: string;
  iat?: number;
  exp?: number;
  id?: string | number;
  name?: string;
  given_name?: string;
  family_name?: string;
  preferred_username?: string;
  picture?: string;
};

type TelegramJwks = {
  keys?: Array<Record<string, unknown> & { kid?: string; kty?: string; alg?: string }>;
};

function safeNext(value: unknown) {
  const next = typeof value === "string" ? value : "";
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/crm";
  return next;
}

function decodeJwtJson<T>(segment: string): T | null {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function audienceMatches(audience: TelegramJwtClaims["aud"], expected: string) {
  if (typeof audience === "string") return audience === expected;
  return Array.isArray(audience) && audience.some((value) => String(value) === expected);
}

async function verifyTelegramIdToken(idToken: string, expectedAudience: string) {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJwtJson<TelegramJwtHeader>(encodedHeader);
  const claims = decodeJwtJson<TelegramJwtClaims>(encodedPayload);
  if (!header || !claims || header.alg !== "RS256" || !header.kid) return null;

  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== TELEGRAM_ISSUER) return null;
  if (!audienceMatches(claims.aud, expectedAudience)) return null;
  if (!claims.exp || claims.exp <= now) return null;
  if (!claims.iat || claims.iat > now + 60 || now - claims.iat > MAX_AUTH_AGE_SECONDS) return null;

  const response = await fetch(TELEGRAM_JWKS_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  }).catch(() => null);
  if (!response?.ok) return null;
  const jwks = await response.json().catch(() => null) as TelegramJwks | null;
  const jwk = jwks?.keys?.find((candidate) => candidate.kid === header.kid && candidate.kty === "RSA");
  if (!jwk) return null;

  try {
    const publicKey = crypto.createPublicKey({ key: jwk as any, format: "jwk" });
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = Buffer.from(encodedSignature, "base64url");
    const valid = crypto.verify("RSA-SHA256", Buffer.from(signingInput, "utf8"), publicKey, signature);
    return valid ? claims : null;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  return NextResponse.redirect(new URL("/login?error=telegram_deprecated", url.origin));
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const idToken = typeof body.idToken === "string" ? body.idToken.trim() : "";
  const nextPath = safeNext(body.next);

  const telegramConfig = await getTelegramRuntimeConfig();
  const botId = String(telegramConfig?.botId || "");
  if (!telegramConfig?.token || !botId) {
    return NextResponse.json({ ok: false, error: "telegram_not_configured" }, { status: 503 });
  }
  if (!idToken) {
    return NextResponse.json({ ok: false, error: "telegram_invalid" }, { status: 400 });
  }

  const claims = await verifyTelegramIdToken(idToken, botId);
  if (!claims) {
    return NextResponse.json({ ok: false, error: "telegram_invalid" }, { status: 401 });
  }

  const telegramId = String(claims.id ?? claims.sub ?? "").trim();
  const username = String(claims.preferred_username || "").trim();
  if (!telegramId) {
    return NextResponse.json({ ok: false, error: "telegram_invalid" }, { status: 401 });
  }

  const user = await findCrmUserByTelegram({ id: telegramId, username });
  if (!user) {
    return NextResponse.json({ ok: false, error: "telegram_not_allowed" }, { status: 403 });
  }

  const displayName = String(claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(" ") || user.displayName).trim();
  const avatarUrl = String(claims.picture || user.avatarUrl || "").trim();
  const updated = await updateCrmUser(user.id, {
    telegramId,
    telegramUsername: username || user.telegramUsername,
    displayName,
    avatarUrl,
    lastLoginAt: new Date().toISOString(),
  }) || { ...user, telegramId, displayName, avatarUrl };

  const response = NextResponse.json({ ok: true, next: nextPath });
  response.cookies.set(AUTH_COOKIE_NAME, createSessionCookie(updated), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_MAX_AGE_SECONDS,
  });
  return response;
}
