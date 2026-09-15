import { NextResponse } from "next/server";
import { getAuthUsers, getCurrentUser, isAdminRole, normalizeTelegramUsername, type AuthUser, type UserRole } from "@/lib/auth";
import { generateId, mutateDataJson } from "@/lib/data";
import { staffIdentityChanged, staffRedirect } from "@/lib/crm-staff-save";

function clean(value: FormDataEntryValue | null, max = 200) {
  return String(value || "").trim().slice(0, max);
}

function redirectWithState(request: Request, path: string, state: "saved" | "error", message = "") {
  const url = new URL(path, request.url);
  url.searchParams.set("state", state);
  if (message) url.searchParams.set("message", message.slice(0, 180));
  return staffRedirect(url.pathname + url.search);
}

export async function POST(request: Request) {
  const actor = await getCurrentUser();
  if (!actor || !isAdminRole(actor.role)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", "/crm/managers");
    login.searchParams.set("error", "auth_required");
    return staffRedirect(login.pathname + login.search);
  }

  let returnPath = "/crm/managers";
  try {
    const form = await request.formData();
    const userId = clean(form.get("userId"), 120);
    const displayName = clean(form.get("displayName"), 160);
    const telegramUsername = normalizeTelegramUsername(clean(form.get("telegramUsername"), 160));
    const requestedRole = clean(form.get("role"), 40) as UserRole;
    const role: UserRole = ["owner", "admin", "manager"].includes(requestedRole) ? requestedRole : "manager";
    const status = clean(form.get("status"), 30) === "disabled" ? "disabled" : "active";
    const companyId = clean(form.get("companyId"), 160) || "dealer_topavto";
    returnPath = userId ? `/crm/managers/${encodeURIComponent(userId)}` : "/crm/managers/new";

    if (!displayName || !telegramUsername) throw new Error("Укажите имя и Telegram username");
    if (role === "owner" && actor.role !== "owner") throw new Error("Назначить владельца может только владелец");

    const seed = getAuthUsers();
    let savedId = userId;
    await mutateDataJson<AuthUser[]>("auth/users.json", seed, (stored) => {
      const users = Array.isArray(stored) && stored.length ? stored : seed;
      const duplicate = users.find((item) => normalizeTelegramUsername(item.telegramUsername) === telegramUsername && item.id !== userId);
      if (duplicate) throw new Error("Этот Telegram username уже добавлен");

      if (!userId) {
        savedId = generateId("user");
        return [{ id: savedId, displayName, telegramUsername, role, status, companyId, updatedAt: new Date().toISOString() }, ...users];
      }

      const current = users.find((item) => item.id === userId);
      if (!current) throw new Error("Сотрудник не найден");
      if (current.role === "owner" && actor.role !== "owner") throw new Error("Изменить владельца может только владелец");
      if (actor.id === userId && (status === "disabled" || role !== current.role)) throw new Error("Нельзя отключить или понизить собственный доступ");
      const identityChanged = staffIdentityChanged(current.telegramUsername, telegramUsername);
      return users.map((item) => item.id === userId ? { ...item, displayName, telegramUsername, role, status, companyId,
        sessionVersion: (item.sessionVersion || 0) + (identityChanged || item.role !== role || item.status !== status ? 1 : 0),
        ...(identityChanged ? {telegramId:"",botBindHash:"",botBindExpiresAt:""} : {}),
        updatedAt: new Date().toISOString() } : item);
    });

    return redirectWithState(request, `/crm/managers/${encodeURIComponent(savedId)}`, "saved");
  } catch (error) {
    console.error("crm_user_save_failed", error);
    return redirectWithState(request, returnPath, "error", error instanceof Error ? error.message : "Не удалось сохранить сотрудника");
  }
}
