import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME } from "@/lib/auth";

function publicOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_SITE_URL || process.env.SITE_URL || process.env.PUBLIC_SITE_URL;
  if (configured) {
    try { return new URL(configured).origin; } catch { /* fall through */ }
  }
  const requestUrl = new URL(request.url);
  if (!["0.0.0.0", "127.0.0.1", "localhost"].includes(requestUrl.hostname)) return requestUrl.origin;
  return process.env.NODE_ENV === "production" ? "https://avtocena.com" : "http://localhost:3000";
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const requested = url.searchParams.get("redirect") || "/";
  const redirectPath = requested.startsWith("/") && !requested.startsWith("//") ? requested : "/";
  const response = NextResponse.redirect(new URL(redirectPath, publicOrigin(request)), { status: 303 });

  response.cookies.set(AUTH_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });

  return response;
}
