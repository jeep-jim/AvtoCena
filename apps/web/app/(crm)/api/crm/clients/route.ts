import { NextResponse } from "next/server";
import { appendChunkedDataJson, generateId, readChunkedDataJson } from "@/lib/data";
import { getCurrentUser, isCrmRole } from "@/lib/auth";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberOrNull(value: unknown) {
  const num = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(num) && num > 0 ? num : null;
}

export async function GET() {
  const user = getCurrentUser();

  if (!user || !isCrmRole(user.role)) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  const clients = await readChunkedDataJson<any>("clients/clients.json", []);
  return NextResponse.json({ ok: true, clients });
}

export async function POST(request: Request) {
  const user = getCurrentUser();

  if (!user || !isCrmRole(user.role)) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const fio = clean(body.fio);
  const phone = clean(body.phone);
  const telegram = clean(body.telegram);
  const comment = clean(body.comment);

  if (!fio && !phone && !telegram) {
    return NextResponse.json({ ok: false, error: "client_contact_required" }, { status: 400 });
  }

  const createdAt = new Date().toISOString();
  const clientId = generateId("client");

  try {
    const client = await appendChunkedDataJson("clients/clients.json", {
      id: clientId,
      createdAt,
      updatedAt: createdAt,
      fio,
      phone,
      telegram,
      city: clean(body.city),
      comment,
      createdByManagerId: user.id,
      assignedManagerId: clean(body.assignedManagerId) || user.id,
      source: clean(body.source) || "manual"
    });

    const lead = await appendChunkedDataJson("leads/leads.json", {
      id: generateId("lead"),
      createdAt,
      updatedAt: createdAt,
      clientId,
      status: "new",
      name: fio,
      phone,
      telegram,
      comment,
      car: clean(body.car),
      brand: clean(body.brand),
      model: clean(body.model),
      market: clean(body.market),
      budgetRub: numberOrNull(body.budgetRub),
      totalRub: numberOrNull(body.totalRub),
      source: clean(body.source) || "manual",
      partnerRef: clean(body.partnerRef),
      createdByManagerId: user.id,
      assignedManagerId: clean(body.assignedManagerId) || user.id
    });

    await appendChunkedDataJson("activity/feed.json", {
      id: generateId("event"),
      createdAt,
      type: "client_created",
      title: "Добавлен клиент",
      managerId: user.id,
      managerName: user.displayName,
      clientId,
      leadId: lead.id,
      text: fio || phone || telegram || "Новый клиент"
    });
    return NextResponse.json({ ok: true, client, lead });
  } catch {
    return NextResponse.json({ ok: false, error: "storage_write_failed" }, { status: 500 });
  }
}
