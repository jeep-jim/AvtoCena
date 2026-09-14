import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { issueStaffKey } from "@/lib/crm-access";
export async function POST(request: Request) {
  const actor = await getCurrentUser();
  if (!actor) return NextResponse.json({ ok: false }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  try {
    const key = await issueStaffKey(
      actor,
      String(body.userId || ""),
      body.action === "revoke",
    );
    return NextResponse.json(
      { ok: true, key },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "Действие недоступно. Нельзя отключить собственный доступ.",
      },
      { status: 403 },
    );
  }
}
