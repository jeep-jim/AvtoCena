import { getAuthUsers, normalizeTelegramUsername, type AuthUser } from "./auth";
import { mutateDataJson, readDataJson } from "./data";

export async function readCrmUsers(): Promise<AuthUser[]> {
  const seed = getAuthUsers();
  const stored = await readDataJson<AuthUser[]>("auth/users.json", seed);
  return Array.isArray(stored) ? stored : seed;
}

export async function findCrmUserByTelegram(input: { id?: string | number; username?: string }) {
  const telegramId = String(input.id || "").trim();
  const username = normalizeTelegramUsername(input.username || "");
  const users = await readCrmUsers();
  return users.find((user) => {
    if (user.status === "disabled") return false;
    if (telegramId && String(user.telegramId || "") === telegramId) return true;
    return Boolean(username) && normalizeTelegramUsername(user.telegramUsername || "") === username;
  }) || null;
}

export async function updateCrmUser(userId: string, patch: Partial<AuthUser>) {
  const seed = getAuthUsers();
  let updated: AuthUser | null = null;
  await mutateDataJson<AuthUser[]>("auth/users.json", seed, (users) => {
    const source = Array.isArray(users) && users.length ? users : seed;
    const next = source.map((user) => {
      if (user.id !== userId) return user;
      updated = {
        ...user,
        ...patch,
        id: user.id,
        telegramUsername: normalizeTelegramUsername(patch.telegramUsername ?? user.telegramUsername),
        updatedAt: new Date().toISOString(),
      };
      return updated;
    });
    return next;
  });
  return updated;
}
