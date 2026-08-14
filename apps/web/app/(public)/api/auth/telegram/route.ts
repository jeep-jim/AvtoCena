import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, AUTH_MAX_AGE_SECONDS, createSessionCookie } from "@/lib/auth";
import { findCrmUserByTelegram, updateCrmUser } from "@/lib/crm-users";
import { getTelegramRuntimeConfig } from "@/lib/telegram-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TELEGRAM_ISSUER = "https://oauth.telegram.org";
const TELEGRAM_JWKS_URL = "https://oauth.telegram.org/.well-known/jwks.json";
const TELEGRAM_TOKEN_URL = "https://oauth.telegram.org/token";
const OIDC_COOKIE_NAME = "avtocena_tg_oidc";
const PUBLIC_ORIGIN = "https://avtocena.com";
const CALLBACK_URL = `${PUBLIC_ORIGIN}/api/auth/telegram`;
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

type OidcState = {
  state?: string;
  verifier?: string;
  nextPath?: string;
  issuedAt?: number;
};

function safeNext(value: unknown) {
  const next = typeof value === "string" ? value : "";
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/crm";
  return next;
}

function authSecret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "avtocena-dev-secret-change-me";
}

function sign(value: string) {
  return crypto.createHmac("sha256", authSecret()).update(value).digest("base64url");
}

function equalText(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookie(request: Request, name: string) {
  const raw = request.headers.get("cookie") || "";
  for (const chunk of raw.split(";")) {
    const index = chunk.indexOf("=");
    if (index < 0) continue;
    const key = chunk.slice(0, index).trim();
    if (key === name) return decodeURIComponent(chunk.slice(index + 1).trim());
  }
  return "";
}

function decodeOidcState(raw: string): OidcState | null {
  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature || !equalText(signature, sign(encoded))) return null;
  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as OidcState;
  } catch {
    return null;
  }
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

async function resolveCrmUser(claims: TelegramJwtClaims) {
  const telegramId = String(claims.id ?? claims.sub ?? "").trim();
  const username = String(claims.preferred_username || "").trim();
  if (!telegramId) return null;

  const user = await findCrmUserByTelegram({ id: telegramId, username });
  if (!user) return null;

  const displayName = String(claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(" ") || user.displayName).trim();
  const avatarUrl = String(claims.picture || user.avatarUrl || "").trim();
  return await updateCrmUser(user.id, {
    telegramId,
    telegramUsername: username || user.telegramUsername,
    displayName,
    avatarUrl,
    lastLoginAt: new Date().toISOString(),
  }) || { ...user, telegramId, displayName, avatarUrl };
}

function clearOidcCookie(response: NextResponse) {
  response.cookies.set(OIDC_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

function redirectLogin(error: string) {
  return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(error)}`, PUBLIC_ORIGIN));
}

function tokenExchangeErrorCode(error: unknown) {
  const code = String(error || "").trim().toLowerCase();
  if (code === "invalid_client") return "telegram_token_invalid_client";
  if (code === "invalid_grant") return "telegram_token_invalid_grant";
  if (code === "invalid_request") return "telegram_token_invalid_request";
  if (code === "unauthorized_client") return "telegram_token_unauthorized_client";
  return "telegram_token_exchange_failed";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const telegramError = String(url.searchParams.get("error") || "").trim();
  if (telegramError) {
    console.error("telegram_oidc_authorization_error", telegramError.slice(0, 120));
    return redirectLogin("telegram_oauth_error");
  }

  const code = String(url.searchParams.get("code") || "").trim();
  const returnedState = String(url.searchParams.get("state") || "").trim();
  const storedState = decodeOidcState(parseCookie(request, OIDC_COOKIE_NAME));
  const now = Math.floor(Date.now() / 1000);

  if (
    !code ||
    !returnedState ||
    !storedState?.state ||
    !storedState.verifier ||
    !storedState.issuedAt ||
    !equalText(returnedState, storedState.state) ||
    storedState.issuedAt > now + 60 ||
    now - storedState.issuedAt > MAX_AUTH_AGE_SECONDS
  ) {
    const response = redirectLogin("telegram_state_invalid");
    clearOidcCookie(response);
    return response;
  }

  const telegramConfig = await getTelegramRuntimeConfig();
  const botId = String(telegramConfig?.botId || "");
  const clientSecret = String(telegramConfig?.clientSecret || "");
  if (!telegramConfig?.token || !botId || !clientSecret) {
    const response = redirectLogin("telegram_not_configured");
    clearOidcCookie(response);
    return response;
  }

  let idToken = "";
  try {
    const tokenResponse = await fetch(TELEGRAM_TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${Buffer.from(`${botId}:${clientSecret}`, "utf8").toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: CALLBACK_URL,
        client_id: botId,
        code_verifier: storedState.verifier,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const tokenPayload = await tokenResponse.json().catch(() => null) as { id_token?: string; error?: string; error_description?: string } | null;
    if (!tokenResponse.ok || !tokenPayload?.id_token) {
      const telegramCode = String(tokenPayload?.error || "").trim();
      console.error(
        "telegram_oidc_token_exchange_failed",
        tokenResponse.status,
        telegramCode.slice(0, 120) || "unknown",
        String(tokenPayload?.error_description || "").slice(0, 180),
      );
      const response = redirectLogin(tokenExchangeErrorCode(telegramCode));
      clearOidcCookie(response);
      return response;
    }
    idToken = tokenPayload.id_token;
  } catch (error) {
    console.error("telegram_oidc_token_exchange_error", error instanceof Error ? error.message : "unknown");
    const response = redirectLogin("telegram_token_exchange_failed");
    clearOidcCookie(response);
    return response;
  }

  const claims = await verifyTelegramIdToken(idToken, botId);
  if (!claims) {
    console.error("telegram_oidc_id_token_invalid", botId);
    const response = redirectLogin("telegram_id_token_invalid");
    clearOidcCookie(response);
    return response;
  }

  const user = await resolveCrmUser(claims);
  if (!user) {
    const response = redirectLogin("telegram_not_allowed");
    clearOidcCookie(response);
    return response;
  }

  const nextPath = safeNext(storedState.nextPath);
  const response = NextResponse.redirect(new URL(nextPath, PUBLIC_ORIGIN));
  response.cookies.set(AUTH_COOKIE_NAME, createSessionCookie(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_MAX_AGE_SECONDS,
  });
  clearOidcCookie(response);
  return response;
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

  const user = await resolveCrmUser(claims);
  if (!user) {
    return NextResponse.json({ ok: false, error: "telegram_not_allowed" }, { status: 403 });
  }

  const response = NextResponse.json({ ok: true, next: nextPath });
  response.cookies.set(AUTH_COOKIE_NAME, createSessionCookie(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_MAX_AGE_SECONDS,
  });
  return response;
}
