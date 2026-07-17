import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, AUTH_MAX_AGE_SECONDS, createSessionCookie, findAuthUserByTelegram, normalizeTelegramUsername } from "@/lib/auth";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const username = normalizeTelegramUsername(clean(body.username));
  const accessKey = clean(body.accessKey);
  const expectedAccessKey = process.env.AUTH_ACCESS_KEY || "";

  if (!username) {
    return NextResponse.json({ ok: false, error: "access_denied" }, { status: 401 });
  }

  if (expectedAccessKey && accessKey !== expectedAccessKey) {
    return NextResponse.json({ ok: false, error: "access_denied" }, { status: 401 });
  }

  const user = await findAuthUserByTelegram(username);

  if (!user) {
    return NextResponse.json({ ok: false, error: "access_denied" }, { status: 401 });
  }

  const response = NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      telegramUsername: user.telegramUsername,
      displayName: user.displayName,
      role: user.role,
      partnerCode: user.partnerCode || null
    }
  });

  response.cookies.set(AUTH_COOKIE_NAME, createSessionCookie(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_MAX_AGE_SECONDS
  });

  return response;
}
