import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { appendChunkedDataJson, readChunkedDataJson } from "@/lib/data";
import { getCurrentUser, isCrmRole } from "@/lib/auth";

function clean(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function numberOrNull(value: unknown) {
  const num = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(num) && num > 0 ? num : null;
}

function makeId(prefix: string) {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export async function GET() {
  const user = getCurrentUser();

  if (!user || !isCrmRole(user.role)) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  const clients = readChunkedDataJson<any>("clients/clients.json", []);
  return NextResponse.json({ ok: true, clients });
}

export async function POST(request: Request) {
  const user = getCurrentUser();

  if (!user || !isCrmRole(user.role)) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const fio = clean(body.fio, 255);
  const phone = clean(body.phone, 80);
  const telegram = clean(body.telegram, 120);
  const comment = clean(body.comment, 2000);

  if (!fio && !phone && !telegram) {
    return NextResponse.json({ ok: false, error: "client_contact_required" }, { status: 400 });
  }

  const createdAt = new Date().toISOString();
  const clientId = makeId("client");
  const leadId = makeId("lead");
  const assignedManagerId = clean(body.assignedManagerId, 120) || user.id;
  const source = clean(body.source, 120) || "manual";

  const client = appendChunkedDataJson("clients/clients.json", {
    id: clientId,
    createdAt,
    updatedAt: createdAt,
    fio,
    phone,
    telegram,
    email: clean(body.email, 255),
    city: clean(body.city, 255),
    birthDate: clean(body.birthDate, 32),
    passport: {
      series: clean(body.passportSeries, 20),
      number: clean(body.passportNumber, 30),
      issuedBy: clean(body.passportIssuedBy, 1000),
      issuedAt: clean(body.passportIssuedAt, 32),
      departmentCode: clean(body.passportDepartmentCode, 30)
    },
    registrationAddress: clean(body.registrationAddress, 1000),
    residenceAddress: clean(body.residenceAddress, 1000),
    inn: clean(body.inn, 20),
    comment,
    createdByManagerId: user.id,
    assignedManagerId,
    source,
    partnerRef: clean(body.partnerRef, 120),
    attribution: null
  });

  const lead = appendChunkedDataJson("leads/leads.json", {
    id: leadId,
    createdAt,
    updatedAt: createdAt,
    clientId,
    status: "assigned",
    statusHistory: [
      {
        status: "assigned",
        changedAt: createdAt,
        changedByUserId: user.id,
        changedByName: user.displayName
      }
    ],
    name: fio,
    phone,
    telegram,
    comment,
    car: clean(body.car, 255),
    brand: clean(body.brand, 120),
    model: clean(body.model, 120),
    market: clean(body.market, 80),
    budgetRub: numberOrNull(body.budgetRub),
    totalRub: numberOrNull(body.totalRub),
    searchRequest: null,
    source,
    partnerRef: clean(body.partnerRef, 120),
    clickId: "",
    externalClickId: "",
    attribution: null,
    createdByManagerId: user.id,
    assignedManagerId
  });

  appendChunkedDataJson("activity/feed.json", {
    id: makeId("event"),
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
}
