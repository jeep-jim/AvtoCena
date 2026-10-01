import {readMembership} from '@/lib/dealers/program-store';
import {dealerAccessLevel} from '@/lib/dealers/program-model';
import {isPlatformOwner} from '@/lib/platform-access';
import {canManageDealer} from "@/lib/dealers/access";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getJsonStorage } from "@/lib/data";
import { findDealer } from "@/lib/dealers/showcase-store";
import { downloadDealerImage, prepareDealerImage } from "@/lib/dealers/media";
import { isCalculationOriginAllowed } from "@/lib/catalog/calculation-request-origin";
export const runtime = "nodejs";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (
    !(await canManageDealer(await getCurrentUser(),(await params).id)) ||
    !isCalculationOriginAllowed(req)
  )
    return NextResponse.json({ error: "Доступ запрещён" }, { status: 403 });
  try {
    const { id } = await params;
    if(!isPlatformOwner(await getCurrentUser())&&!dealerAccessLevel(id,await readMembership(id)).full)return NextResponse.json({error:"Загрузка фото доступна во время пробного или оплаченного периода"},{status:403});
    if (!(await findDealer(id)))
      return NextResponse.json(
        { error: "Компания не найдена" },
        { status: 404 },
      );
    if (Number(req.headers.get("content-length")) > 9 * 1024 * 1024)
      throw Error("Размер изображения — до 8 МБ");
    const form = await req.formData();
    const file = form.get("file");
    if (file instanceof File && file.size > 8 * 1024 * 1024)
      throw Error("Размер изображения — до 8 МБ");
    const bytes =
      file instanceof File
        ? Buffer.from(await file.arrayBuffer())
        : await downloadDealerImage(String(form.get("url") || ""));
    const image = await prepareDealerImage(bytes);
    const storage = getJsonStorage();
    if (!storage.putBinary) throw Error("Загрузка временно недоступна");
    const mediaId = randomUUID();
    await storage.putBinary(
      `dealers/showcase-media/${id}/${mediaId}.webp`,
      image,
      "image/webp",
    );
    return NextResponse.json({
      id: mediaId,
      url: `/api/dealers/${id}/media/${mediaId}`,
      caption: "",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Не удалось загрузить фото" },
      { status: 400 },
    );
  }
}
