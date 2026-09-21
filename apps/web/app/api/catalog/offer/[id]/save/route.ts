import { NextResponse } from "next/server";
import { getCurrentUser, isCrmRole } from "@/lib/auth";
import { isCalculationOriginAllowed } from "@/lib/catalog/calculation-request-origin";
import { getOfferFromCurrentShard } from "@/lib/catalog/storage";
import { validateCustomerParameters } from "@/lib/catalog/customer-parameters";
import { calculateOfferWithCustomerParametersDetailed } from "@/lib/catalog/customs-pricing";
import { cleanSavedDraft, saveOfferCalculation, SavedCalculationConflict } from "@/lib/catalog/saved-offer-calculation";

export const dynamic = "force-dynamic";
export async function POST(request:Request,{params}:{params:{id:string}}) {
  const headers={"Cache-Control":"no-store"};
  if(!isCalculationOriginAllowed(request))return NextResponse.json({error:"Недопустимый источник запроса"},{status:403,headers});
  const user=await getCurrentUser();
  if(!user || !isCrmRole(user.role))return NextResponse.json({error:"Требуется вход сотрудника"},{status:403,headers});
  const body=await request.text();
  if(body.length>4096)return NextResponse.json({error:"Слишком большой запрос"},{status:413,headers});
  let draft, expectedVersion;
  try { const input=JSON.parse(body); draft=cleanSavedDraft(input.draft); expectedVersion=typeof input.version==="string"?input.version:null; }
  catch(error){return NextResponse.json({error:error instanceof Error?error.message:"Проверьте параметры"},{status:400,headers});}
  // Authoritative current inventory: never save or resurrect an expired offer from a cached page.
  const offer=await getOfferFromCurrentShard(params.id);
  if(!offer)return NextResponse.json({error:"Объявление больше недоступно"},{status:404,headers});
  const result=await calculateOfferWithCustomerParametersDetailed(offer,validateCustomerParameters(draft));
  if(!result.ok)return NextResponse.json({error:result.error},{status:422,headers});
  try {
    const saved=await saveOfferCalculation(offer,draft,result.calculation,user.id,expectedVersion,user.displayName);
    return NextResponse.json({version:saved.version,savedAt:saved.savedAt,savedByName:user.displayName,draft:saved.draft,calculation:saved.calculation},{headers});
  } catch(error) {
    if(error instanceof SavedCalculationConflict)return NextResponse.json({error:error.message},{status:409,headers});
    console.error("offer_calculation_save_failed",error);
    return NextResponse.json({error:"Не удалось сохранить. Попробуйте ещё раз."},{status:503,headers});
  }
}
