import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = getCurrentUser();

  if (!user) {
    return NextResponse.json({ ok: false, user: null }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      telegramUsername: user.telegramUsername,
      displayName: user.displayName,
      role: user.role,
      partnerCode: user.partnerCode || null
    }
  });
}
