import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { getAuthUsers, getCurrentUser, isCrmRole } from "@/lib/auth";
import {
  appendChunkedDataJson,
  readChunkedDataJson,
  updateChunkedDataJson
} from "@/lib/data";
import { isLeadStatus } from "@/lib/crm";
import { deliverCpaEvent } from "@/lib/cpa-gateway";
import { handleLeadPartnerStatusChange } from "@/lib/business-settings";

function clean(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function makeId(prefix: string) {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export async function PATCH(
  request: Request,
  context: { params: { id: string } }
) {
  const user = getCurrentUser();

  if (!user || !isCrmRole(user.role)) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  const leadId = clean(context.params.id, 160);
  const body = await request.json().catch(() => ({}));
  const requestedStatus = clean(body.status, 80);
  const requestedManagerId = clean(body.assignedManagerId, 160);
  const note = clean(body.note, 2000);

  if (requestedStatus && !isLeadStatus(requestedStatus)) {
    return NextResponse.json({ ok: false, error: "wrong_status" }, { status: 400 });
  }

  const managers = getAuthUsers().filter((candidate) => isCrmRole(candidate.role));
  const manager = requestedManagerId
    ? managers.find((candidate) => candidate.id === requestedManagerId)
    : null;

  if (requestedManagerId && !manager) {
    return NextResponse.json({ ok: false, error: "manager_not_found" }, { status: 400 });
  }

  const existingLead = (await readChunkedDataJson<any>("leads/leads.json", [])).find(
    (lead) => lead.id === leadId
  );

  if (!existingLead) {
    return NextResponse.json({ ok: false, error: "lead_not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const nextStatus = requestedStatus || existingLead.status || "new";
  const nextManagerId = requestedManagerId || existingLead.assignedManagerId || null;
  const statusChanged = nextStatus !== (existingLead.status || "new");
  const managerChanged = nextManagerId !== (existingLead.assignedManagerId || null);
  const reasonRequired = statusChanged && (nextStatus === "rejected" || nextStatus === "duplicate");

  if (reasonRequired && !note) {
    return NextResponse.json({ ok: false, error: "reason_required" }, { status: 400 });
  }

  if (!statusChanged && !managerChanged && !note) {
    return NextResponse.json({ ok: true, lead: existingLead, unchanged: true });
  }

  const updatedLead = await updateChunkedDataJson<any>("leads/leads.json", leadId, (lead) => ({
    ...lead,
    updatedAt: now,
    status: nextStatus,
    assignedManagerId: nextManagerId,
    rejectionReason: nextStatus === "rejected" || nextStatus === "duplicate"
      ? note || lead.rejectionReason || ""
      : lead.rejectionReason,
    rejectedAt: nextStatus === "rejected" || nextStatus === "duplicate"
      ? now
      : lead.rejectedAt,
    rejectedByUserId: nextStatus === "rejected" || nextStatus === "duplicate"
      ? user.id
      : lead.rejectedByUserId,
    statusHistory: statusChanged
      ? [
          ...(Array.isArray(lead.statusHistory) ? lead.statusHistory : []),
          {
            status: nextStatus,
            changedAt: now,
            changedByUserId: user.id,
            changedByName: user.displayName,
            note
          }
        ]
      : lead.statusHistory,
    managerHistory: managerChanged
      ? [
          ...(Array.isArray(lead.managerHistory) ? lead.managerHistory : []),
          {
            assignedManagerId: nextManagerId,
            changedAt: now,
            changedByUserId: user.id,
            changedByName: user.displayName
          }
        ]
      : lead.managerHistory,
    internalNotes: note
      ? [
          ...(Array.isArray(lead.internalNotes) ? lead.internalNotes : []),
          {
            id: makeId("note"),
            text: note,
            createdAt: now,
            createdByUserId: user.id,
            createdByName: user.displayName
          }
        ]
      : lead.internalNotes
  }));

  if (!updatedLead) {
    return NextResponse.json({ ok: false, error: "lead_update_failed" }, { status: 500 });
  }

  if (managerChanged && updatedLead.clientId) {
    await updateChunkedDataJson<any>("clients/clients.json", updatedLead.clientId, (client) => ({
      ...client,
      updatedAt: now,
      assignedManagerId: nextManagerId
    }));
  }

  await appendChunkedDataJson("activity/feed.json", {
    id: makeId("event"),
    createdAt: now,
    type: statusChanged ? "lead_status_changed" : managerChanged ? "lead_assigned" : "lead_note_added",
    title: statusChanged
      ? "Изменён статус заявки"
      : managerChanged
        ? "Назначен менеджер"
        : "Добавлен комментарий",
    leadId,
    clientId: updatedLead.clientId,
    managerId: user.id,
    managerName: user.displayName,
    assignedManagerId: nextManagerId,
    status: nextStatus,
    text: note || manager?.displayName || nextStatus
  });

  if (statusChanged) {
    const partnerEffects = await handleLeadPartnerStatusChange({
      leadId,
      clientId: updatedLead.clientId,
      partnerRef: updatedLead.partnerRef || updatedLead.attribution?.partnerRef || "",
      clickId: updatedLead.clickId || updatedLead.attribution?.clickId || "",
      externalClickId: updatedLead.externalClickId || updatedLead.attribution?.externalClickId || "",
      sub1: updatedLead.sub1 || updatedLead.attribution?.sub1 || "",
      sub2: updatedLead.sub2 || updatedLead.attribution?.sub2 || "",
      sub3: updatedLead.sub3 || updatedLead.attribution?.sub3 || "",
      sub4: updatedLead.sub4 || updatedLead.attribution?.sub4 || "",
      sub5: updatedLead.sub5 || updatedLead.attribution?.sub5 || "",
      status: nextStatus,
      eventType: nextStatus === "contract_signed" ? "contract_signed" : "lead_status_changed",
      rejectionReason: nextStatus === "rejected" || nextStatus === "duplicate" ? note : "",
      changedByUserId: user.id,
      createdAt: now,
    });

    if (partnerEffects.cpaEvent?.deliveryStatus === "pending") {
      await deliverCpaEvent(partnerEffects.cpaEvent);
    }
  }

  return NextResponse.json({ ok: true, lead: updatedLead });
}
