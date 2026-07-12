import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "avtocena_session";
const DOCS_COOKIE_NAME = "avtocena_cpa_docs";

type SessionPayload = {
  id: string;
  role: "owner" | "admin" | "manager" | "partner";
  exp: number;
  partnerCode?: string;
};

function authSecret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "avtocena-dev-secret-change-me";
}

function base64url(bytes: ArrayBuffer | Uint8Array) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  array.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return atob(padded);
}

async function signPayload(encodedPayload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(authSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(encodedPayload));
  return base64url(signature);
}

async function getSession(request: NextRequest): Promise<SessionPayload | null> {
  const raw = request.cookies.get(COOKIE_NAME)?.value;
  if (!raw || !raw.includes(".")) return null;

  const [encodedPayload, signature] = raw.split(".");
  if (!encodedPayload || !signature) return null;

  const expected = await signPayload(encodedPayload);
  if (expected !== signature) return null;

  try {
    const payload = JSON.parse(decodeBase64url(encodedPayload)) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function isCrmRole(role?: string | null) {
  return role === "owner" || role === "admin" || role === "manager";
}

function isAdminRole(role?: string | null) {
  return role === "owner" || role === "admin";
}

function isPartnerRole(role?: string | null) {
  return role === "owner" || role === "admin" || role === "partner";
}

function wantsJson(pathname: string) {
  return pathname.startsWith("/api/");
}

function denyOrRedirect(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (wantsJson(pathname)) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(url);
}

function hasValidCpaDocsKey(request: NextRequest) {
  const expected = process.env.CPA_DOCS_KEY || process.env.CPA_API_SECRET || "";
  if (!expected) return false;

  const queryKey = request.nextUrl.searchParams.get("key") || request.nextUrl.searchParams.get("secret");
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const saved = request.cookies.get(DOCS_COOKIE_NAME)?.value;

  return queryKey === expected || bearer === expected || saved === expected;
}

function allowWithDocsCookie(request: NextRequest) {
  const response = NextResponse.next();
  const expected = process.env.CPA_DOCS_KEY || process.env.CPA_API_SECRET || "";
  const queryKey = request.nextUrl.searchParams.get("key") || request.nextUrl.searchParams.get("secret");

  if (expected && queryKey === expected) {
    response.cookies.set(DOCS_COOKIE_NAME, expected, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 14
    });
  }

  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/manifest") ||
    pathname.startsWith("/brands") ||
    pathname.startsWith("/icons") ||
    pathname.startsWith("/logo") ||
    pathname === "/login" ||
    pathname.startsWith("/api/auth") ||
    pathname === "/api/health" ||
    pathname === "/api/avtocena" ||
    pathname.startsWith("/auto") ||
    pathname === "/" ||
    pathname === "/results" ||
    pathname === "/partner/landing"
  ) {
    return NextResponse.next();
  }

  if (pathname === "/api/cpa" && request.method === "POST") {
    return NextResponse.next();
  }

  const session = await getSession(request);

  if (pathname === "/partner/api" || pathname.startsWith("/partner/api/")) {
    if (isAdminRole(session?.role) || hasValidCpaDocsKey(request)) return allowWithDocsCookie(request);
    return denyOrRedirect(request);
  }

  if (pathname === "/crm" || pathname.startsWith("/crm/") || pathname.startsWith("/api/crm")) {
    if (isCrmRole(session?.role)) return NextResponse.next();
    return denyOrRedirect(request);
  }

  if (pathname === "/partner" || pathname.startsWith("/partner/")) {
    if (isPartnerRole(session?.role)) return NextResponse.next();
    return denyOrRedirect(request);
  }

  if (pathname === "/api/leads" && request.method === "GET") {
    if (isCrmRole(session?.role)) return NextResponse.next();
    return denyOrRedirect(request);
  }

  if (pathname === "/api/partners") {
    if (isCrmRole(session?.role)) return NextResponse.next();
    return denyOrRedirect(request);
  }

  if (pathname === "/api/cpa") {
    if (isAdminRole(session?.role) || hasValidCpaDocsKey(request)) return allowWithDocsCookie(request);
    return denyOrRedirect(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!.*\\..*).*)"]
};
