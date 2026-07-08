import { NextResponse } from "next/server";
import { appendDataJson, readDataJson } from "@/lib/data";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export async function GET() {
  const leads = readDataJson<any[]>("leads/leads.json", []);
  return NextResponse.json({ ok: true, leads });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  const phone = clean(body.phone);
  const telegram = clean(body.telegram);

  if (!phone && !telegram) {
    return NextResponse.json(
      { ok: false, error: "phone_or_telegram_required" },
      { status: 400 }
    );
  }

  const lead = appendDataJson("leads/leads.json", {
    id: `lead_${Date.now()}`,
    createdAt: new Date().toISOString(),
    status: "new",

    name: clean(body.name),
    phone,
    telegram,
    comment: clean(body.comment),

    carId: clean(body.carId),
    car: clean(body.car),
    market: clean(body.market),
    marketName: clean(body.marketName),
    year: numberOrNull(body.year),

    budgetRub: numberOrNull(body.budgetRub),
    totalRub: numberOrNull(body.totalRub),

    source: clean(body.source) || "site",
    partnerRef: clean(body.partnerRef)
  });

  return NextResponse.json({ ok: true, lead });
}
