import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getContractTemplatesSettings } from "@/lib/business-settings";
import { canEditBusinessSettings } from "@/lib/settings-validation";

export async function GET() {
  const user = getCurrentUser();
  if (!user || !canEditBusinessSettings(user.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  return NextResponse.json({ ok: true, contracts: getContractTemplatesSettings(), pending: "Реальная генерация будет подключена после получения файла шаблона договора." });
}
