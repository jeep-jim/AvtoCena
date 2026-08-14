import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getTelegramRuntimeConfig } from "@/lib/telegram-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE_NAME = "avtocena_tg_oidc";
const CALLBACK_URL = "https://avtocena.com/api/auth/telegram";
const MAX_AGE_SECONDS = 10 * 60;

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/crm";
  return value;
}

function authSecret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "avtocena-dev-secret-change-me";
}

function sign(value: string) {
  return crypto.createHmac("sha256", authSecret()).update(value).digest("base64url");
}

function encodeStateCookie(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const nextPath = safeNext(url.searchParams.get("next"));
  const config = await getTelegramRuntimeConfig();
  const clientId = String(config?.botId || "");
  if (!config?.token || !config?.clientSecret || !clientId) {
    return NextResponse.redirect(new URL("/login?error=telegram_not_configured", url.origin));
  }

  const state = crypto.randomBytes(24).toString("base64url");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const issuedAt = Math.floor(Date.now() / 1000);

  const authorize = new URL("https://oauth.telegram.org/auth");
  authorize.searchParams.set("client_id", clientId);
  authorize.searchParams.set("redirect_uri", CALLBACK_URL);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("scope", "openid profile telegram:bot_access");
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  const response = NextResponse.redirect(authorize);
  response.cookies.set(COOKIE_NAME, encodeStateCookie({ state, verifier, nextPath, issuedAt }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
  return response;
}
