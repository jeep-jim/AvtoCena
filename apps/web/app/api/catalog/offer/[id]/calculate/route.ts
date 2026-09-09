import { isCalculationOriginAllowed } from "@/lib/catalog/calculation-request-origin";
import { getOfferForPage } from "@/lib/catalog/offer-page-data";
import { NextResponse } from "next/server";
import { getOfferFromCurrentShard } from "@/lib/catalog/storage";
import { validateCustomerParameters } from "@/lib/catalog/customer-parameters";
import { calculateOfferWithCustomerParameters } from "@/lib/catalog/customs-pricing";
export async function POST(request: Request, {params}:{params:{id:string}}) {
  const headers = {"Cache-Control":"no-store"};
  if (!isCalculationOriginAllowed(request)) return NextResponse.json({error:"Недопустимый источник запроса"},{status:403,headers});
  const body = await request.text();
  if (body.length > 4096) return NextResponse.json({error:"Слишком большой запрос"},{status:413,headers});
  let parameters;
  try { parameters = validateCustomerParameters(JSON.parse(body)); }
  catch(error) { return NextResponse.json({error:error instanceof Error?error.message:"Проверьте параметры"},{status:400,headers}); }
  const offer = await getOfferForPage(params.id) || await getOfferFromCurrentShard(params.id);
  if (!offer) return NextResponse.json({error:"Объявление не найдено"},{status:404,headers});
  const calculation = await calculateOfferWithCustomerParameters(offer,parameters);
  if (!calculation?.totalRub) return NextResponse.json({error:"Для полного расчёта нужны дополнительные данные. Обратитесь к менеджеру."},{status:422,headers});
  return NextResponse.json({...calculation,label:"Расчёт по вашим данным",requiresConfirmation:true},{headers});
}
