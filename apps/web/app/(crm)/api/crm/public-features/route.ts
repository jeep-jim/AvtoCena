import {recordCrmActivity} from '@/lib/crm-activity';
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
    const saved=await savePublicFeatures(await req.json());
    await recordCrmActivity(user,{type:'site_updated',title:'Изменены страницы и блоки сайта',visibility:'management',entityType:'site',entityId:'public-features',href:'/crm/site'});
    return NextResponse.json(saved);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Не удалось сохранить" },
      { status: 400 },
    );
  }
}
