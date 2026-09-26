import { cache } from "react";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import fs from "node:fs";
import path from "node:path";
import { getDataRoot, readDataJson } from "./data";

export const AUTH_COOKIE_NAME = "avtocena_session";
export const AUTH_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export type UserRole = "owner" | "admin" | "manager" | "partner";

export type AuthUser = {
  id: string;
  telegramUsername: string;
  telegramId?: string;
  displayName: string;
  avatarUrl?: string;
  companyId?: string;
  role: UserRole;
  status?: "active" | "disabled";
  partnerCode?: string;
  updatedAt?: string;
  lastLoginAt?: string;
  sessionVersion?: number;
  permissions?: import("./crm-permissions").CrmPermissions;
};

type SessionPayload = AuthUser & { exp: number };

function authSecret() {
  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") throw new Error("auth_secret_required");
  return secret || "avtocena-dev-secret-change-me";
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

export function getAuthUsers() {
  try {
    const filePath = path.join(getDataRoot(), "auth/users.json");
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as AuthUser[];
  } catch {
    return [];
  }
}

export function findAuthUserByTelegram(username: string) {
  const normalized = normalizeTelegramUsername(username);
  return getAuthUsers().find((user) => normalizeTelegramUsername(user.telegramUsername) === normalized && user.status !== "disabled") || null;
}

export function createSessionCookie(user: AuthUser) {
  const payload: SessionPayload = {
    id: user.id,
    telegramUsername: normalizeTelegramUsername(user.telegramUsername),
    telegramId: user.telegramId,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    companyId: user.companyId,
    role: user.role,
    status: user.status,
    partnerCode: user.partnerCode,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
    sessionVersion: user.sessionVersion || 0,
    exp: Math.floor(Date.now() / 1000) + AUTH_MAX_AGE_SECONDS,
  };

  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifySessionCookie(raw?: string | null): AuthUser | null {
  if (!raw || !raw.includes(".")) return null;

  const [encodedPayload, signature] = raw.split(".");
  if (!encodedPayload || !signature) return null;

  const expected = signPayload(encodedPayload);
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) return null;

  try {
    const payload = JSON.parse(fromBase64url(encodedPayload)) as SessionPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000) || payload.status === "disabled") return null;

    const { exp: _exp, ...signedUser } = payload;
    return signedUser;
  } catch {
    return null;
  }
}

async function readCurrentUser(): Promise<AuthUser | null> {
  const signed = verifySessionCookie((await cookies()).get(AUTH_COOKIE_NAME)?.value);
  if (!signed) return null;
  const users = await readDataJson<AuthUser[]>("auth/users.json", getAuthUsers());
  return resolveSessionUser(signed, users);
}

export const getCurrentUser = typeof cache === "function" ? cache(readCurrentUser) : readCurrentUser;

export function resolveSessionUser(signed: AuthUser, users: AuthUser[]): AuthUser | null {
  const current = users.find((user) => user.id === signed.id);
  if (!current || current.status === "disabled" || (current.sessionVersion || 0) !== (signed.sessionVersion || 0)) return null;
  const { accessKeyHash: _key, botBindHash: _bind, botBindExpiresAt: _expires, ...safe } = current as AuthUser & {accessKeyHash?:string;botBindHash?:string;botBindExpiresAt?:string};
  return safe;
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
