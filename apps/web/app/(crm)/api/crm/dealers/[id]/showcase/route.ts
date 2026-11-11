import {isPlatformOwner} from '@/lib/platform-access';
import {readMembership} from '@/lib/dealers/program-store';
import {dealerAccessLevel,restrictedShowcaseChange} from '@/lib/dealers/program-model';
import {canManageDealer} from "@/lib/dealers/access";
import {withDealerRate} from '@/lib/dealers/exchange-rate';
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { isCalculationOriginAllowed } from "@/lib/catalog/calculation-request-origin";
import { readShowcase, saveShowcase, ShowcaseConflict } from "@/lib/dealers/showcase-store";
export const runtime = "nodejs";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await canManageDealer(await getCurrentUser(),(await params).id)))
    return NextResponse.json(
      { error: "Доступ только владельцу" },
      { status: 403 },
    );
  const value = await readShowcase((await params).id);
  return NextResponse.json(value || { error: "Компания не найдена" }, {
    status: value ? 200 : 404,
    headers: { "Cache-Control": "no-store" },
  });
}
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (
    !(await canManageDealer(await getCurrentUser(),(await params).id)) ||
    !isCalculationOriginAllowed(req)
  )
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  try {
    const body = await req.text();
    if (body.length > 1000000)
      return NextResponse.json(
        { error: "Слишком много данных" },
        { status: 413 },
      );
    const raw=JSON.parse(body), id=(await params).id;
    const current=await readShowcase(id);
    if(current&&!isPlatformOwner(await getCurrentUser())&&!dealerAccessLevel(id,await readMembership(id)).full&&restrictedShowcaseChange(current,raw))return NextResponse.json({error:"Собственные автомобили и оформление доступны во время пробного или оплаченного периода"},{status:403});
    return NextResponse.json(
      await saveShowcase(id, await withDealerRate(raw,true)),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    if(e instanceof ShowcaseConflict)return NextResponse.json({error:e.message,current:e.current,proposed:e.proposed},{status:409});
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Не удалось сохранить" },
      { status: 400 },
    );
  }
}
