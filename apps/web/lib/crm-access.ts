import {hasCrmPermission} from "./crm-permissions";
import {recordCrmActivity} from "./crm-activity";
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
    hasCrmPermission(actor,"staff") &&
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
  await recordCrmActivity(actor,{type:revoke?"staff_access_revoked":"staff_key_issued",title:revoke?"Отключён доступ сотрудника":"Выдан новый ключ доступа",visibility:"management",entityType:"staff",entityId:id,href:`/crm/managers/${encodeURIComponent(id)}`,text:"Предыдущие сеансы сотрудника завершены. Значение ключа в журнале не хранится."});
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
                Date.now() + 24 * 60 * 60_000,
              ).toISOString(),
            }
          : stored,
      ),
  );
  return `https://t.me/${botUsername}?start=staff_${token}`;
}
export type StaffBindReason = "invalid_link" | "expired" | "disabled" | "username_mismatch" | "different_account";
export const staffBindMessages: Record<StaffBindReason, string> = {
  invalid_link: "Эта ссылка больше не действует: она заменена, уже использована или не найдена. Откройте свою карточку в CRM и создайте одну новую ссылку. До ответа бота не создавайте следующую.",
  expired: "Срок ссылки истёк. Создайте новую ссылку в своей карточке CRM и откройте бота по ней.",
  disabled: "Доступ сотрудника отключён. Обратитесь к владельцу CRM.",
  username_mismatch: "Telegram username этого аккаунта не совпадает с вашей карточкой CRM. Проверьте username в настройках Telegram и в своей карточке; затем создайте новую ссылку.",
  different_account: "Сотрудник уже подключён к другому Telegram-аккаунту. Обратитесь к владельцу CRM; эта ссылка не может заменить подключённый аккаунт.",
};
export async function bindStaffResult(token: string, telegramId: string, username: string) {
  let user: AuthUser | null = null;
  let reason: StaffBindReason = "invalid_link";
  await mutateDataJson<StaffUser[]>("auth/users.json", getAuthUsers(), users => {
    user = null;
    reason = "invalid_link";
    return users.map(stored => {
      if (!stored.botBindHash || !keyMatches(token, stored.botBindHash)) return stored;
      if (stored.status === "disabled") { reason = "disabled"; return stored; }
      if (!(Date.parse(stored.botBindExpiresAt || "") > Date.now())) { reason = "expired"; return stored; }
      if (normalizeTelegramUsername(username) !== normalizeTelegramUsername(stored.telegramUsername)) {
        reason = "username_mismatch"; return stored;
      }
      if (stored.telegramId && String(stored.telegramId) !== telegramId) {
        reason = "different_account"; return stored;
      }
      user = { ...stored, telegramId, botBindHash: "", botBindExpiresAt: "" } as StaffUser;
      return user;
    });
  });
  return { user, reason };
}
export async function bindStaff(token: string, telegramId: string, username: string) {
  return (await bindStaffResult(token, telegramId, username)).user;
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
