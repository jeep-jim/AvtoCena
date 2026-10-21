import {hasCrmPermission} from "@/lib/crm-permissions";
import {recordCrmActivity,activityChanges,activityPerson} from "@/lib/crm-activity";
import { NextResponse } from "next/server";
import { getCurrentUser, isCrmRole } from "@/lib/auth";
import { isCalculationOriginAllowed } from "@/lib/catalog/calculation-request-origin";
import { getOfferFromCurrentShard } from "@/lib/catalog/storage";
import { validateCustomerParameters } from "@/lib/catalog/customer-parameters";
import { calculateOfferWithCustomerParametersDetailed } from "@/lib/catalog/customs-pricing";
import { cleanSavedDraft, getSavedOfferCalculation, saveOfferCalculation, SavedCalculationConflict } from "@/lib/catalog/saved-offer-calculation";

export const dynamic = "force-dynamic";
export async function POST(request:Request,{params}:{params: Promise<{id:string}>}) {
  const headers={"Cache-Control":"no-store"};
  if(!isCalculationOriginAllowed(request))return NextResponse.json({error:"Недопустимый источник запроса"},{status:403,headers});
  const user=await getCurrentUser();
  if(!user || !hasCrmPermission(user,"calculations"))return NextResponse.json({error:"Требуется вход сотрудника"},{status:403,headers});
  const body=await request.text();
  if(body.length>4096)return NextResponse.json({error:"Слишком большой запрос"},{status:413,headers});
  let draft, expectedVersion;
  try { const input=JSON.parse(body); draft=cleanSavedDraft(input.draft); expectedVersion=typeof input.version==="string"?input.version:null; }
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Проверьте параметры"},{status:400,headers});}
  // Authoritative current inventory: never save or resurrect an expired offer from a cached page.
  const offer=await getOfferFromCurrentShard((await params).id);
  if(!offer)return NextResponse.json({error:"Объявление больше недоступно"},{status:404,headers});
  const result=await calculateOfferWithCustomerParametersDetailed(offer,validateCustomerParameters(draft));
  if(!result.ok)return NextResponse.json({error:result.error},{status:422,headers});
  try {
    const previous=await getSavedOfferCalculation(offer);
    const saved=await saveOfferCalculation(offer,draft,result.calculation,user.id,expectedVersion,user.displayName);
    await recordCrmActivity(user,{id:`calculation_${saved.version}`,type:"calculation_saved",title:"Изменены параметры и стоимость автомобиля",entityType:"offer",entityId:offer.id,entityLabel:[offer.make,offer.model,offer.year].filter(Boolean).join(" "),href:`/cars/offer/${encodeURIComponent(offer.id)}?calculation=${encodeURIComponent(saved.version)}`,changes:[...activityChanges(previous?.draft||{},saved.draft,{year:"Год",engineCc:"Объём, см³",powerHp:"Мощность, л.с.",powerKw:"Мощность, кВт",fuel:"Топливо",hybridKind:"Тип гибрида",power30MinKw:"30-минутная мощность",deliveryCity:"Город доставки"}),{label:"Стоимость, ₽",before:String(previous?.calculation?.totalRub||offer.totalRub||""),after:String(saved.calculation.totalRub)}]});
    return NextResponse.json({version:saved.version,savedAt:saved.savedAt,savedByName:user.displayName,draft:saved.draft,calculation:saved.calculation},{headers});
  } catch(error) {
    if(error instanceof SavedCalculationConflict)return NextResponse.json({error:error.message},{status:409,headers});
    console.error("offer_calculation_save_failed",error);
    return NextResponse.json({error:"Не удалось сохранить. Попробуйте ещё раз."},{status:503,headers});
  }
}
