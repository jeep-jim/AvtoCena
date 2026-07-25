import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { appendChunkedDataJson } from "@/lib/data";

function clean(value: FormDataEntryValue | null, maxLength = 300) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function id() {
  try {
    return `dealer_application_${crypto.randomUUID()}`;
  } catch {
    return `dealer_application_${Date.now()}`;
  }
}

export async function POST(request: Request) {
  const form = await request.formData();
  const companyName = clean(form.get("companyName"), 180);
  const city = clean(form.get("city"), 140);
  const contactName = clean(form.get("contactName"), 160);
  const phone = clean(form.get("phone"), 80);
  const telegram = clean(form.get("telegram"), 120);
  const markets = clean(form.get("markets"), 1200);
  const teamSize = Math.max(0, Math.min(10000, Number(clean(form.get("teamSize"), 12)) || 0));
  const consent = clean(form.get("consent"), 12) === "yes";

  if (!companyName || !city || !contactName || !phone || !consent) {
    return NextResponse.json({ ok: false, error: "required_fields_missing" }, { status: 400 });
  }

  await appendChunkedDataJson("dealers/applications.json", {
    id: id(),
    companyName,
    city,
    contactName,
    phone,
    telegram,
    markets,
    teamSize,
    status: "new",
    source: "dealer_landing",
    consentAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });

  return NextResponse.redirect(new URL("/dealers?sent=1#connect", request.url), 303);
}
