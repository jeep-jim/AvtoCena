import {hasCrmPermission} from '@/lib/crm-permissions';
import {isPlatformTeam} from "@/lib/platform-access";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isCalculationOriginAllowed } from "@/lib/catalog/calculation-request-origin";
import { savePublicFeatures } from "@/lib/dealers/showcase-store";
export async function PUT(req: Request) {
  const user=await getCurrentUser();
  if (
    (!isPlatformTeam(user)||!hasCrmPermission(user,"site")) ||
    !isCalculationOriginAllowed(req)
  )
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  try {
    return NextResponse.json(await savePublicFeatures(await req.json()));
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Не удалось сохранить" },
      { status: 400 },
    );
  }
}
