import { NextResponse } from "next/server";
import { getCurrentUser, isAdminRole } from "@/lib/auth";
import { deliverPendingCpaEvents } from "@/lib/cpa-gateway";

function hasDeliverySecret(request: Request) {
  const expected = process.env.CPA_DELIVERY_SECRET?.trim();
  if (!expected) return false;

  const url = new URL(request.url);
  const querySecret = url.searchParams.get("secret") || "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
  return querySecret === expected || bearer === expected;
}

export async function POST(request: Request) {
  const user = getCurrentUser();
  if (!isAdminRole(user?.role) && !hasDeliverySecret(request)) {
    return NextResponse.json({ ok: false, error: "auth_required" }, { status: 401 });
  }

  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 25);
  const results = await deliverPendingCpaEvents(limit);

  return NextResponse.json({
    ok: true,
    processed: results.length,
    sent: results.filter((result) => result.ok).length,
    skipped: results.filter((result) => result.skipped).length,
    failed: results.filter((result) => !result.ok && !result.skipped).length,
    results,
  });
}
