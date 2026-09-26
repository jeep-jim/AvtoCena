import {hasCrmPermission} from "@/lib/crm-permissions";
import { getCurrentUser, isCrmRole } from "@/lib/auth";
import { isCalculationOriginAllowed } from "@/lib/catalog/calculation-request-origin";
import { getOfferForPage } from "@/lib/catalog/offer-page-data";
import { getOfferFromCurrentShard } from "@/lib/catalog/storage";
import { validateCustomerParameters } from "@/lib/catalog/customer-parameters";
import { calculateOfferWithCustomerParametersDetailed } from "@/lib/catalog/customs-pricing";
import { getSavedOfferCalculation, cleanSavedDraft, type SavedCalculationResult } from "@/lib/catalog/saved-offer-calculation";
import { offerPdfData, renderOfferPdf } from "@/lib/catalog/offer-pdf";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow"};
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 if(!isCalculationOriginAllowed(request))return Response.json({error:"Недопустимый источник запроса"},{status:403,headers});
 const user=await getCurrentUser();
 if(!user || !hasCrmPermission(user,"calculations"))return Response.json({error:"Требуется вход сотрудника"},{status:403,headers});
 const body=await request.text();if(body.length>8192)return Response.json({error:"Слишком большой запрос"},{status:413,headers});
 let draft:Record<string,string>;
 try{const input=JSON.parse(body);if(!input.draft || typeof input.draft!=="object" || Array.isArray(input.draft))throw Error();draft=Object.fromEntries(Object.entries(input.draft).filter(([,v])=>typeof v==="string").map(([k,v])=>[k,String(v).slice(0,160)]));}catch{return Response.json({error:"Неверные параметры"},{status:400,headers});}
 const id=(await params).id;
 const offer=await getOfferForPage(id) || await getOfferFromCurrentShard(id);
 if(!offer)return Response.json({error:"Объявление не найдено"},{status:404,headers});
 let savedVersion:string|undefined;
 let calculation:SavedCalculationResult|null=null,warning="",calculatedAt=new Date().toISOString();
 try{
  const parameters=validateCustomerParameters(draft);
  const saved=await getSavedOfferCalculation(offer);
  const cleaned=cleanSavedDraft(draft);
  if(saved && Object.entries(cleaned).every(([k,v])=>v===(saved.draft[k] || ""))){calculation=saved.calculation;calculatedAt=saved.savedAt || calculatedAt;savedVersion=saved.version;}
  else {const result=await calculateOfferWithCustomerParametersDetailed(offer,parameters);if(result.ok)calculation=result.calculation;else warning=result.error;}
 }catch{warning="Не все характеристики заполнены. Полная стоимость требует уточнения.";}
 try{
  const data=offerPdfData(offer,draft,calculation,warning,calculatedAt);
  if(savedVersion){const url=new URL(data.url);url.searchParams.set("calculation",savedVersion);data.url=url.toString();}
  const pdf=await renderOfferPdf(data);
  return new Response(new Uint8Array(pdf),{headers:{...headers,"Content-Type":"application/pdf","Content-Disposition":`inline; filename="AvtoCena-${id.replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,80)}.pdf"`}});
 }catch(error){console.error("offer_pdf_failed",error);return Response.json({error:"Не удалось подготовить PDF. Попробуйте ещё раз."},{status:500,headers});}
}
