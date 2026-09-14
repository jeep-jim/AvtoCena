import { NextResponse } from "next/server";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import {
  readChunkedDataJson,
  mutateDataJson,
  readDataJson,
  updateChunkedDataJson,
} from "@/lib/data";

type PayoutStatus = "pending" | "approved" | "paid" | "rejected";

type PayoutRequest = {
  id: string;
  partnerCode: string;
  amountRub: number;
  status: PayoutStatus;
  updatedAt?: string;
  reviewedAt?: string | null;
  reviewedByUserId?: string | null;
  reviewComment?: string | null;
};

function clean(value: unknown, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function PATCH(
  request: Request,
  context: { params: { id: string } },
) {
  const user = await getCurrentUser();
  if (!user || !isAdminRole(user.role)) {
    return NextResponse.json({ ok: false, error: "admin_required" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const status = clean(body.status, 40) as PayoutStatus;
  const comment = clean(body.comment, 1000);

  if (!["pending", "approved", "paid", "rejected"].includes(status)) {
    return NextResponse.json({ ok: false, error: "wrong_status" }, { status: 400 });
  }

  const requestId = clean(context.params.id, 200);
  const existing = (await readChunkedDataJson<PayoutRequest>(
    "partners/payout-requests.json",
    [],
  )).find((item) => item.id === requestId);

  if (!existing) {
    return NextResponse.json({ ok: false, error: "request_not_found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const updated = updateChunkedDataJson<PayoutRequest>(
    "partners/payout-requests.json",
    requestId,
    (item) => ({
      ...item,
      status,
      updatedAt: now,
      reviewedAt: now,
      reviewedByUserId: user.id,
      reviewComment: comment || null,
    }),
  );

  if (!updated) {
    return NextResponse.json({ ok: false, error: "update_failed" }, { status: 500 });
  }

  if (status === "paid" && existing.status !== "paid") {
    await mutateDataJson<any[]>("partners/partners.json", [], (partners) => partners.map((partner) => {
      if (partner.code !== existing.partnerCode) return partner;

      const currentBalance = Math.max(0, Number(partner.balanceRub || 0));
      const amount = Math.max(0, Number(existing.amountRub || 0));

      return {
        ...partner,
        balanceRub: Math.max(0, currentBalance - amount),
        paidOutRub: Number(partner.paidOutRub || 0) + amount,
        updatedAt: now,
      };
    }));
  }

  return NextResponse.json({ ok: true, request: updated });
}
