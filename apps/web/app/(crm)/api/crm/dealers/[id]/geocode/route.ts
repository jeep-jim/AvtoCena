import {isPlatformOwner} from "@/lib/platform-access";
import { getCurrentUser } from "@/lib/auth";
import { isCalculationOriginAllowed } from "@/lib/catalog/calculation-request-origin";
export const runtime = "nodejs";
// Older editor tabs must not continue calling the retired address provider.
export async function POST(req: Request) {
  if (!isPlatformOwner(await getCurrentUser()) || !isCalculationOriginAllowed(req))
    return Response.json({ error: "Доступ запрещён" }, { status: 403 });
  return Response.json({ error: "Обновите страницу. Карта офиса теперь отображается в Яндекс Картах по указанному адресу; отдельный поиск координат не требуется." }, { status: 410 });
}
