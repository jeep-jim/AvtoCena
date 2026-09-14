import { NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  AUTH_MAX_AGE_SECONDS,
  createSessionCookie,
  getAuthUsers,
  normalizeTelegramUsername,
} from "@/lib/auth";
import { readDataJson } from "@/lib/data";
import {
  type StaffUser,
  digest,
  keyMatches,
  loginAttempt,
} from "@/lib/crm-access";
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const username = normalizeTelegramUsername(String(body.username || "")).slice(
    0,
    80,
  );
  const key = String(body.accessKey || "").trim();
  if (!/^[a-z][a-z0-9_]{4,31}$/.test(username) || !key || key.length > 200)
    return NextResponse.json(
      { ok: false, error: "access_denied" },
      { status: 401 },
    );
  if (!(await loginAttempt(username)))
    return NextResponse.json(
      { ok: false, error: "try_later" },
      { status: 429 },
    );
  const users = await readDataJson<StaffUser[]>(
    "auth/users.json",
    getAuthUsers(),
  );
  const user = users.find(
    (user) =>
      user.status !== "disabled" &&
      normalizeTelegramUsername(user.telegramUsername) === username,
  );
  // One-time migration: only the existing owner can use the deployment key,
  // and only before any personal credential has been issued to that owner.
  const bootstrap =
    user?.role === "owner" &&
    !user.keyIssuedAt &&
    Boolean(process.env.AUTH_ACCESS_KEY) &&
    keyMatches(key, digest(process.env.AUTH_ACCESS_KEY || ""));
  if (!user || (!keyMatches(key, user.accessKeyHash) && !bootstrap))
    return NextResponse.json(
      { ok: false, error: "access_denied" },
      { status: 401 },
    );
  const response = NextResponse.json(
    { ok: true },
    { headers: { "cache-control": "no-store" } },
  );
  response.cookies.set(AUTH_COOKIE_NAME, createSessionCookie(user), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: AUTH_MAX_AGE_SECONDS,
  });
  return response;
}
