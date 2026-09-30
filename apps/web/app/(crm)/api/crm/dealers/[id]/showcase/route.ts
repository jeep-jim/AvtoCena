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
  if ((await getCurrentUser())?.role !== "owner")
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
    (await getCurrentUser())?.role !== "owner" ||
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
    return NextResponse.json(
      await saveShowcase((await params).id, await withDealerRate(JSON.parse(body),true)),
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
