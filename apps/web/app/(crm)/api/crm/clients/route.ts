import { NextResponse } from "next/server";
import { appendChunkedDataJson, generateId, readChunkedDataJson, updateChunkedDataJson } from "@/lib/data";
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
  const operationId = clean(body.operationId) || generateId("operation");

  try {
    const clients = await readChunkedDataJson<any>("clients/clients.json", []);
    const leads = await readChunkedDataJson<any>("leads/leads.json", []);
    const events = await readChunkedDataJson<any>("activity/feed.json", []);
    let client = clients.find((item) => item.operationId === operationId);
    let lead = leads.find((item) => item.operationId === operationId);
    let event = events.find((item) => item.operationId === operationId);
    const clientId = `client_${operationId}`;

    if (!client) client = await appendChunkedDataJson("clients/clients.json", {
      id: clientId,
      operationId,
      createdAt,
      updatedAt: createdAt,
      fio,
      phone,
      telegram,
      city: clean(body.city),
      comment,
      comments: comment,
      status: "active",
      interestedCar: clean(body.car),
      market: clean(body.market),
      budgetRub: numberOrNull(body.budgetRub),
      phones: phone ? [phone] : [],
      passport: clean(body.passport),
      address: clean(body.address),
      birthDate: clean(body.birthDate),
      documents: [],
      contracts: [],
      history: [{ at: createdAt, by: user.id, type: "created", operationId }],
      createdByManagerId: user.id,
      assignedManagerId: clean(body.assignedManagerId) || user.id,
      source: clean(body.source) || "manual"
    });

    if (!lead) lead = await appendChunkedDataJson("leads/leads.json", {
      id: `lead_${operationId}`,
      operationId,
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

    if (!event) event = await appendChunkedDataJson("activity/feed.json", {
      id: `event_${operationId}`,
      operationId,
      createdAt,
      type: "client_created",
      title: "Добавлен клиент",
      managerId: user.id,
      managerName: user.displayName,
      clientId,
      leadId: lead.id,
      text: fio || phone || telegram || "Новый клиент"
    });
    return NextResponse.json({ ok: true, client, lead, event, operationId });
  } catch {
    return NextResponse.json({ ok: false, error: "storage_write_failed" }, { status: 500 });
  }
}


export async function PUT(request: Request) {
  const user = getCurrentUser();
  if (!user || !isCrmRole(user.role)) return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const id = clean(body.id);
  if (!id) return NextResponse.json({ ok: false, error: "client_id_required" }, { status: 400 });
  const operationId = clean(body.operationId) || generateId("operation");
  const updatedAt = new Date().toISOString();
  const updated = await updateChunkedDataJson<any>("clients/clients.json", id, (client) => ({
    ...client,
    fio: clean(body.fio) || client.fio,
    phone: clean(body.phone) || client.phone,
    telegram: clean(body.telegram) || client.telegram,
    city: clean(body.city) || client.city,
    birthDate: clean(body.birthDate) || client.birthDate,
    passport: clean(body.passport) || client.passport,
    address: clean(body.address) || client.address,
    interestedCar: clean(body.interestedCar || body.car) || client.interestedCar,
    market: clean(body.market) || client.market,
    budgetRub: numberOrNull(body.budgetRub) ?? client.budgetRub,
    comments: clean(body.comments || body.comment) || client.comments,
    assignedManagerId: clean(body.assignedManagerId) || client.assignedManagerId,
    source: clean(body.source) || client.source,
    status: body.archive ? "archived" : body.restore ? "active" : (clean(body.status) || client.status || "active"),
    updatedAt,
    history: [...(client.history || []), { at: updatedAt, by: user.id, type: body.archive ? "archived" : body.restore ? "restored" : "updated", operationId }]
  }));
  if (!updated) return NextResponse.json({ ok: false, error: "client_not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, client: updated, operationId });
}
