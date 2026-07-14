import crypto from "node:crypto";
import { cookies } from "next/headers";
import { readDataJson } from "./data";

export const AUTH_COOKIE_NAME = "avtocena_session";
export const AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export type UserRole = "owner" | "admin" | "manager" | "partner";

export type AuthUser = {
  id: string;
  telegramUsername: string;
  displayName: string;
  role: UserRole;
  status?: "active" | "disabled";
  partnerCode?: string;
  telegramId?: string;
  avatarObjectKey?: string;
  createdAt?: string;
  invitedByUserId?: string;
  lastLoginAt?: string;
  sessionVersion?: number;
  updatedAt?: string;
};

type SessionPayload = {
  id: string;
  telegramUsername: string;
  displayName: string;
  role: UserRole;
  partnerCode?: string;
  exp: number;
  sessionVersion?: number;
};

function authSecret() {
  return process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "avtocena-dev-secret-change-me";
}

function base64url(input: string | Buffer) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, "utf-8");
  return buffer.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64url(input: string) {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf-8");
}

function signPayload(encodedPayload: string) {
  return base64url(crypto.createHmac("sha256", authSecret()).update(encodedPayload).digest());
}

export function normalizeTelegramUsername(value: string) {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

export async function getAuthUsers() {
  return readDataJson<AuthUser[]>("auth/users.json", []);
}

export async function findAuthUserByTelegram(username: string) {
  const normalized = normalizeTelegramUsername(username);
  return (await getAuthUsers()).find((user) => normalizeTelegramUsername(user.telegramUsername) === normalized && user.status !== "disabled") || null;
}

export function createSessionCookie(user: AuthUser) {
  const payload: SessionPayload = {
    id: user.id,
    telegramUsername: normalizeTelegramUsername(user.telegramUsername),
    displayName: user.displayName,
    role: user.role,
    partnerCode: user.partnerCode,
    sessionVersion: Number(user.sessionVersion || 0),
    exp: Math.floor(Date.now() / 1000) + AUTH_MAX_AGE_SECONDS
  };

  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionCookie(raw?: string | null): Promise<AuthUser | null> {
  if (!raw || !raw.includes(".")) return null;

  const [encodedPayload, signature] = raw.split(".");
  if (!encodedPayload || !signature) return null;

  const expected = signPayload(encodedPayload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64url(encodedPayload)) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;

    const storedUser = (await getAuthUsers()).find((user) => user.id === payload.id && user.status !== "disabled");
    if (!storedUser) return null;
    if (Number(storedUser.sessionVersion || 0) !== Number(payload.sessionVersion || 0)) return null;

    return storedUser;
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const raw = cookies().get(AUTH_COOKIE_NAME)?.value;
  return verifySessionCookie(raw);
}

export function isCrmRole(role?: string | null) {
  return role === "owner" || role === "admin" || role === "manager";
}

export function isAdminRole(role?: string | null) {
  return role === "owner" || role === "admin";
}

export function isPartnerRole(role?: string | null) {
  return role === "owner" || role === "admin" || role === "partner";
}
