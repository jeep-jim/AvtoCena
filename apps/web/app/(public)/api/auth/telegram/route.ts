import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, AUTH_MAX_AGE_SECONDS, createSessionCookie } from "@/lib/auth";
import { findCrmUserByTelegram, updateCrmUser } from "@/lib/crm-users";

const MAX_AUTH_AGE_SECONDS = 10 * 60;

function safeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/crm";
  return value;
}

function equalHex(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  return crypto.timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const nextPath = safeNext(url.searchParams.get("next"));
  const botToken = process.env.TELEGRAM_BOT_TOKEN || "";
  if (!botToken) return NextResponse.redirect(new URL("/login?error=telegram_not_configured", url.origin));

  const hash = url.searchParams.get("hash") || "";
  const authDate = Number(url.searchParams.get("auth_date") || 0);
  const now = Math.floor(Date.now() / 1000);
  if (!hash || !authDate || authDate > now + 60 || now - authDate > MAX_AUTH_AGE_SECONDS) {
    return NextResponse.redirect(new URL("/login?error=telegram_expired", url.origin));
  }

  const entries = [...url.searchParams.entries()]
    .filter(([key]) => key !== "hash" && key !== "next")
    .sort(([left], [right]) => left.localeCompare(right));
  const dataCheckString = entries.map(([key, value]) => `${key}=${value}`).join("\n");
  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const expectedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (!equalHex(hash, expectedHash)) {
    return NextResponse.redirect(new URL("/login?error=telegram_invalid", url.origin));
  }

  const telegramId = url.searchParams.get("id") || "";
  const username = url.searchParams.get("username") || "";
  const user = await findCrmUserByTelegram({ id: telegramId, username });
  if (!user) return NextResponse.redirect(new URL("/login?error=telegram_not_allowed", url.origin));

  const firstName = url.searchParams.get("first_name") || "";
  const lastName = url.searchParams.get("last_name") || "";
  const displayName = `${firstName} ${lastName}`.trim() || user.displayName;
  const avatarUrl = url.searchParams.get("photo_url") || user.avatarUrl || "";
  const updated = await updateCrmUser(user.id, {
    telegramId,
    telegramUsername: username || user.telegramUsername,
    displayName,
    avatarUrl,
    lastLoginAt: new Date().toISOString(),
  }) || { ...user, telegramId, displayName, avatarUrl };

  const response = NextResponse.redirect(new URL(nextPath, url.origin));
  response.cookies.set(AUTH_COOKIE_NAME, createSessionCookie(updated), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_MAX_AGE_SECONDS,
  });
  return response;
}
