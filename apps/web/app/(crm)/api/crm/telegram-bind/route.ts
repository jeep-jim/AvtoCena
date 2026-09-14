import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { bindLink } from "@/lib/crm-access";
import { getTelegramRuntimeConfig } from "@/lib/telegram-config";
export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const config = await getTelegramRuntimeConfig();
  if (!config?.token)
    return NextResponse.json(
      { ok: false, error: "Бот не настроен" },
      { status: 503 },
    );
  return NextResponse.json(
    { ok: true, url: await bindLink(user, config.username) },
    { headers: { "cache-control": "no-store" } },
  );
}
