import crypto from "node:crypto";
import {
  type AuthUser,
  getAuthUsers,
  isAdminRole,
  normalizeTelegramUsername,
} from "./auth";
import { mutateDataJson, readDataJson } from "./data";

export type StaffUser = AuthUser & {
  accessKeyHash?: string;
  keyIssuedAt?: string;
  botBindHash?: string;
  botBindExpiresAt?: string;
};
export const digest = (value: string) =>
  crypto.createHash("sha256").update(value).digest("hex");
export function keyMatches(key: string, hash?: string) {
  if (!hash || !/^[a-f0-9]{64}$/.test(hash) || key.length > 200) return false;
  return crypto.timingSafeEqual(
    Buffer.from(digest(key), "hex"),
    Buffer.from(hash, "hex"),
  );
}
export function canManageStaff(actor: AuthUser, target: AuthUser) {
  return (
    isAdminRole(actor.role) &&
    (target.role !== "owner" || actor.role === "owner")
  );
}
export async function issueStaffKey(
  actor: AuthUser,
  id: string,
  revoke = false,
) {
  const key = revoke ? "" : crypto.randomBytes(32).toString("base64url");
  await mutateDataJson<StaffUser[]>(
    "auth/users.json",
    getAuthUsers(),
    (users) => {
      const target = users.find((user) => user.id === id);
      const currentActor = users.find(
        (user) => user.id === actor.id && user.status !== "disabled",
      );
      if (!target || !currentActor || !canManageStaff(currentActor, target))
        throw new Error("staff_forbidden");
      if (revoke && id === actor.id) throw new Error("cannot_revoke_self");
      return users.map((user) =>
        user.id === id
          ? {
              ...user,
              accessKeyHash: key ? digest(key) : "",
              keyIssuedAt: new Date().toISOString(),
              sessionVersion: (user.sessionVersion || 0) + 1,
              ...(revoke ? { status: "disabled" as const } : {}),
            }
          : user,
      );
    },
  );
  return key;
}
export async function bindLink(user: AuthUser, botUsername: string) {
  const token = crypto.randomBytes(24).toString("base64url");
  await mutateDataJson<StaffUser[]>(
    "auth/users.json",
    getAuthUsers(),
    (users) =>
      users.map((stored) =>
        stored.id === user.id
          ? {
              ...stored,
              botBindHash: digest(token),
              botBindExpiresAt: new Date(
                Date.now() + 15 * 60_000,
              ).toISOString(),
            }
          : stored,
      ),
  );
  return `https://t.me/${botUsername}?start=staff_${token}`;
}
export async function bindStaff(
  token: string,
  telegramId: string,
  username: string,
) {
  let result: AuthUser | null = null;
  await mutateDataJson<StaffUser[]>(
    "auth/users.json",
    getAuthUsers(),
    (users) => {
      result = null;
      return users.map((user) => {
        if (
          user.status === "disabled" ||
          !user.botBindHash ||
          !keyMatches(token, user.botBindHash) ||
          !(Date.parse(user.botBindExpiresAt || "") > Date.now())
        )
          return user;
        if (
          normalizeTelegramUsername(username) !==
            normalizeTelegramUsername(user.telegramUsername) ||
          (user.telegramId && String(user.telegramId) !== telegramId)
        )
          return user;
        result = {
          ...user,
          telegramId,
          botBindHash: "",
          botBindExpiresAt: "",
        } as StaffUser;
        return result;
      });
    },
  );
  return result;
}
export async function botAdmin(telegramId: string) {
  const users = await readDataJson<StaffUser[]>(
    "auth/users.json",
    getAuthUsers(),
  );
  return (
    users.find(
      (user) =>
        user.status !== "disabled" &&
        isAdminRole(user.role) &&
        String(user.telegramId || "") === telegramId,
    ) || null
  );
}
export async function loginAttempt(username: string) {
  const path = `auth/login-attempts/${digest(username)}.json`;
  let allowed = false;
  await mutateDataJson(path, { startedAt: 0, count: 0 }, (stored) => {
    const current =
      Date.now() - stored.startedAt > 15 * 60_000
        ? { startedAt: Date.now(), count: 0 }
        : stored;
    allowed = current.count < 15;
    return { ...current, count: current.count + 1 };
  });
  return allowed;
}
