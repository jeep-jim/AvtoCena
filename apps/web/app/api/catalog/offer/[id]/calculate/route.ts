import { isCalculationOriginAllowed } from "@/lib/catalog/calculation-request-origin";
import { readOfferDetailForPage } from "@/lib/catalog/offer-page-data";
import { NextResponse } from "next/server";
import { validateCustomerParameters } from "@/lib/catalog/customer-parameters";
import { calculateOfferWithCustomerParametersDetailed } from "@/lib/catalog/customs-pricing";
export async function POST(request: Request, {params}:{params: Promise<{id:string}>}) {
  const headers = {"Cache-Control":"no-store"};
  if (!isCalculationOriginAllowed(request)) return NextResponse.json({error:"Недопустимый источник запроса"},{status:403,headers});
  const body = await request.text();
  if (body.length > 4096) return NextResponse.json({error:"Слишком большой запрос"},{status:413,headers});
  let parameters;
  try { parameters = validateCustomerParameters(JSON.parse(body)); }
  catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Проверьте параметры"},{status:400,headers}); }
  const detail = await readOfferDetailForPage((await params).id);
  if (detail.unavailable) return NextResponse.json({error:'disabled' in detail ? "Карточка недоступна. Выберите автомобиль в каталоге." : "Не удалось получить данные автомобиля. Попробуйте позже."},{status:'disabled' in detail?410:503,headers});
  const offer = detail.offer;
  if (!offer) return NextResponse.json({error:"Объявление не найдено"},{status:404,headers});
  const result = await calculateOfferWithCustomerParametersDetailed(offer,parameters);
  if (!result.ok) return NextResponse.json({error:result.error,missing:result.missing},{status:422,headers});
  return NextResponse.json({...result.calculation,label:result.calculation.power30Precedent?"Предварительный расчёт по близкой версии":"Расчёт по вашим данным",requiresConfirmation:true},{headers});
}
