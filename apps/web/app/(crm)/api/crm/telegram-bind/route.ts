import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
export async function POST() {
  if (!await getCurrentUser()) return NextResponse.json({ ok: false }, { status: 401 });
  return NextResponse.json({ ok: false, error: "Привязка не требуется: заявки направляются в закрытую группу команды." }, { status: 410 });
}
