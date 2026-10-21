import { NextResponse } from "next/server";
import {canManageDealer} from '@/lib/dealers/access';
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ ok: false, user: null }, { status: 401, headers:{"Cache-Control":"no-store"} });
  }

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      telegramUsername: user.telegramUsername,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl || null,
      role: user.role,
      partnerCode: user.partnerCode || null,
      canCreateSelection: await canManageDealer(user,"dealer_topavto")
    }
  }, {headers:{"Cache-Control":"no-store"}});
}
