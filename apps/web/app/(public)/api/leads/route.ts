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
  const name = clean(body.name);
  const comment = clean(body.comment);

  if (!phone && !telegram) {
    return NextResponse.json(
      { ok: false, error: "phone_or_telegram_required" },
      { status: 400 }
    );
  }

  const createdAt = new Date().toISOString();
  const clientId = `client_${Date.now()}`;

  const client = appendDataJson("clients/clients.json", {
    id: clientId,
    createdAt,
    updatedAt: createdAt,
    fio: name,
    phone,
    telegram,
    comment,
    source: clean(body.source) || "site",
    partnerRef: clean(body.partnerRef),
    createdByManagerId: null,
    assignedManagerId: null
  });

  const lead = appendDataJson("leads/leads.json", {
    id: `lead_${Date.now()}`,
    createdAt,
    updatedAt: createdAt,
    status: "new",

    clientId,
    name,
    phone,
    telegram,
    comment,

    carId: clean(body.carId),
    car: clean(body.car),
    brand: clean(body.brand),
    model: clean(body.model),
    market: clean(body.market),
    marketName: clean(body.marketName),
    year: numberOrNull(body.year),

    budgetRub: numberOrNull(body.budgetRub),
    totalRub: numberOrNull(body.totalRub),

    source: clean(body.source) || "site",
    partnerRef: clean(body.partnerRef),
    createdByManagerId: null,
    assignedManagerId: null
  });

  appendDataJson("activity/feed.json", {
    id: `event_${Date.now()}`,
    createdAt,
    type: "lead_created",
    title: "Заявка с сайта",
    clientId: client.id,
    leadId: lead.id,
    source: lead.source,
    partnerRef: lead.partnerRef,
    text: lead.car || lead.comment || lead.name || lead.phone || lead.telegram
  });

  return NextResponse.json({ ok: true, lead });
}
