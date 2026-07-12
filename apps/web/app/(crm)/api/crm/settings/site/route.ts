import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createSiteBusinessVersion } from "@/lib/business-settings";
import { canEditBusinessSettings, cleanText } from "@/lib/settings-validation";

export async function POST(request: Request) {
  const user = getCurrentUser();
  if (!user || !canEditBusinessSettings(user.role)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const form = await request.formData();
  createSiteBusinessVersion(Object.fromEntries(form.entries()), user, cleanText(form.get("comment"), 1000));
  return NextResponse.redirect(new URL("/crm/settings#site", request.url));
}
