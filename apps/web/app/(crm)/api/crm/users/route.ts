import { NextResponse } from "next/server";
import { getAuthUsers, getCurrentUser, isAdminRole, normalizeTelegramUsername, type AuthUser, type UserRole } from "@/lib/auth";
import { generateId, mutateDataJson } from "@/lib/data";

function clean(value: FormDataEntryValue | null, max = 200) {
  return String(value || "").trim().slice(0, max);
}

export async function POST(request: Request) {
  const actor = getCurrentUser();
  if (!actor || !isAdminRole(actor.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });

  const form = await request.formData();
  const userId = clean(form.get("userId"), 120);
  const displayName = clean(form.get("displayName"), 160);
  const telegramUsername = normalizeTelegramUsername(clean(form.get("telegramUsername"), 160));
  const requestedRole = clean(form.get("role"), 40) as UserRole;
  const role: UserRole = ["owner", "admin", "manager"].includes(requestedRole) ? requestedRole : "manager";
  const status = clean(form.get("status"), 30) === "disabled" ? "disabled" : "active";
  const companyId = clean(form.get("companyId"), 160) || "dealer_topavto";
  if (!displayName || !telegramUsername) return NextResponse.json({ ok: false, error: "required_fields" }, { status: 400 });
  if (role === "owner" && actor.role !== "owner") return NextResponse.json({ ok: false, error: "owner_role_forbidden" }, { status: 403 });

  const seed = getAuthUsers();
  let savedId = userId;
  await mutateDataJson<AuthUser[]>("auth/users.json", seed, (stored) => {
    const users = Array.isArray(stored) && stored.length ? stored : seed;
    const duplicate = users.find((item) => normalizeTelegramUsername(item.telegramUsername) === telegramUsername && item.id !== userId);
    if (duplicate) throw new Error("telegram_username_exists");

    if (!userId) {
      savedId = generateId("user");
      return [{ id: savedId, displayName, telegramUsername, role, status, companyId, updatedAt: new Date().toISOString() }, ...users];
    }

    const current = users.find((item) => item.id === userId);
    if (!current) throw new Error("user_not_found");
    if (current.role === "owner" && actor.role !== "owner") throw new Error("owner_edit_forbidden");
    return users.map((item) => item.id === userId ? { ...item, displayName, telegramUsername, role, status, companyId, updatedAt: new Date().toISOString() } : item);
  });

  return NextResponse.redirect(new URL(`/crm/managers/${encodeURIComponent(savedId)}`, request.url));
}
