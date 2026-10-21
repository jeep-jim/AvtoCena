import {readCrmUsers} from "@/lib/crm-users";
import {hasCrmPermission} from "@/lib/crm-permissions";
import {recordCrmActivity,activityChanges,activityPerson} from "@/lib/crm-activity";
import { canSeeLead } from "@/lib/crm-visibility";
import { isCalculationOriginAllowed } from "@/lib/catalog/calculation-request-origin";
import { NextResponse } from "next/server";
import { appendChunkedDataJson, generateId, readChunkedDataJson } from "@/lib/data";
import { getCurrentUser, isCrmRole } from "@/lib/auth";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET() {
  const user = await getCurrentUser();

  if (!user || !isCrmRole(user.role) || user.status === "disabled") {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  const clients = await readChunkedDataJson<any>("clients/clients.json", []);
  return NextResponse.json({ ok: true, clients:clients.filter(client=>canSeeLead(user,client)) });
}

export async function POST(request: Request) {
  if (!isCalculationOriginAllowed(request)) return NextResponse.json({error:"origin_forbidden"},{status:403});
  const user = await getCurrentUser();

  if (!user || !hasCrmPermission(user,"editClients") || user.status === "disabled") {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const fio = clean(body.fio);
  const phone = clean(body.phone);
  const telegram = clean(body.telegram);
  const max = clean(body.max);
  const comment = clean(body.comment);

  if (!fio && !phone && !telegram && !max) {
    return NextResponse.json({ ok: false, error: "client_contact_required" }, { status: 400 });
  }

  const assignedId=hasCrmPermission(user,"assign")?clean(body.assignedManagerId)||user.id:user.id;
  if(assignedId!==user.id&&!(await readCrmUsers()).some(m=>m.id===assignedId&&m.status!=="disabled"&&isCrmRole(m.role)))return NextResponse.json({error:"manager_not_found"},{status:400});
  const createdAt = new Date().toISOString();
  const operationId = clean(body.operationId) || generateId("operation");

  try {
    const clients = await readChunkedDataJson<any>("clients/clients.json", []);
    let client = clients.find((item) => item.operationId === operationId);
    if (client && !canSeeLead(user, client)) return NextResponse.json({error:"client_forbidden"},{status:403});
    const clientId = `client_${operationId}`;

    if (!client) client = await appendChunkedDataJson("clients/clients.json", {
      id: clientId,
      operationId,
      createdAt,
      updatedAt: createdAt,
      fio,
      phone,
      telegram,
      max,
      car: clean(body.car),
      budgetRub: clean(body.budgetRub),
      city: clean(body.city),
      comment,
      createdByManagerId: user.id,
      createdByManagerName: user.displayName,
      creationSource: "manual",
      assignedManagerId: assignedId,
      source: clean(body.source) || "manual"
    });

    await recordCrmActivity(user,{id:`client_created_${client.id}`,createdAt:client.createdAt,type:"client_created",title:"Добавлен клиент",entityType:"client",entityId:client.id,clientId:client.id,entityLabel:client.fio||"Клиент",href:`/crm/clients/${encodeURIComponent(client.id)}`});
    return NextResponse.json({ ok: true, client, operationId });
  } catch {
    return NextResponse.json({ ok: false, error: "storage_write_failed" }, { status: 500 });
  }
}
