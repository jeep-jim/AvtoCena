import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { flushCrmNotifications } from "@/lib/crm-notifications";
export async function POST(request: Request) {
  const expected = process.env.AUTH_ACCESS_KEY || "";
  const supplied = request.headers.get("x-auth-key") || "";
  if (
    !expected ||
    expected.length !== supplied.length ||
    !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
  )
    return NextResponse.json({ ok: false }, { status: 403 });
  return NextResponse.json(
    { ok: true, ...(await flushCrmNotifications(3)) },
    { headers: { "cache-control": "no-store" } },
  );
}
