import {parseSpecialId,calculateSpecial,specialTitle,specialPath,offerAvailability} from '@/lib/dealers/showcase-model';
import {getSpecialOffer} from '@/lib/dealers/public-showcase';
import type {OfferPdfData} from '@/lib/catalog/offer-pdf';
import {withChinaCnyPrice} from "@/lib/catalog/china-cny-price";
import {convertToRub} from "@/lib/catalog/rates";
import {hasCrmPermission} from "@/lib/crm-permissions";
import { getCurrentUser, isCrmRole } from "@/lib/auth";
import { isCalculationOriginAllowed } from "@/lib/catalog/calculation-request-origin";
import { getOfferForPage } from "@/lib/catalog/offer-page-data";
import { getOfferFromCurrentShard } from "@/lib/catalog/storage";
import { validateCustomerParameters } from "@/lib/catalog/customer-parameters";
import { calculateOfferWithCustomerParametersDetailed } from "@/lib/catalog/customs-pricing";
import { getSavedOfferCalculation, saveClientCalculation, cleanSavedDraft, type SavedCalculationResult } from "@/lib/catalog/saved-offer-calculation";
import { offerPdfData, renderOfferPdf } from "@/lib/catalog/offer-pdf";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow"};
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
 if(!isCalculationOriginAllowed(request))return Response.json({error:"Недопустимый источник запроса"},{status:403,headers});
 const user=await getCurrentUser();
 if(!user || !hasCrmPermission(user,"calculations"))return Response.json({error:"Требуется вход сотрудника"},{status:403,headers});
 const body=await request.text();if(body.length>8192)return Response.json({error:"Слишком большой запрос"},{status:413,headers});
 let draft:Record<string,string>;let requestedVersion:string|undefined;
 try{const input=JSON.parse(body);requestedVersion=typeof input.version==="string"?input.version:undefined;if(!input.draft || typeof input.draft!=="object" || Array.isArray(input.draft))throw Error();draft=Object.fromEntries(Object.entries(input.draft).filter(([,v])=>typeof v==="string").map(([k,v])=>[k,String(v).slice(0,160)]));}catch{return Response.json({error:"Неверные параметры"},{status:400,headers});}
 const id=(await params).id;
 if(parseSpecialId(id)){
  const found=await getSpecialOffer(id,user.role==='owner');
  if(!found)return Response.json({error:"Объявление не найдено"},{status:404,headers});
  const {showcase:s,offer:o}=found,c=calculateSpecial(s,o),stock=offerAvailability(o)==='stock';
  const office=stock?s.offices.find(item=>item.id===o.officeId):s.offices[0];
  const rub=(n:number)=>`${n.toLocaleString('ru-RU')} ₽`;
  const data:OfferPdfData={dealerName:s.name,dealerAddress:office?[office.city,office.address].filter(Boolean).join(', '):'',title:specialTitle(o),market:s.name,marketKey:'dealer',date:new Date().toLocaleDateString('ru-RU'),specs:[o.year&&`${o.year} г.`,o.engineCc&&`${o.engineCc} см³`,o.powerHp&&`${o.powerHp} л.с.`,`${o.mileageKm.toLocaleString('ru-RU')} км`,o.transmission,o.drive].filter(Boolean).join(' · '),city:c.city||'Город уточняется',rate:stock?'Цена в рублях':`1 $ = ${c.rate.toLocaleString('ru-RU')} ₽`,photoUrl:o.photos[0]?.url,sections:[{title:'Структура цены',rows:c.lines.map(l=>({label:l.title,value:rub(l.amountRub)}))},{title:'Условия',rows:[{label:stock?'Наличие':'Доставка',value:stock?'В наличии':c.daysFrom?`${c.daysFrom}–${c.daysTo} дней`:'Срок уточняется'}]}],total:c.totalRub===null?'Цена уточняется':rub(c.totalRub),deposit:'Уточняется у дилера',warnings:c.complete?[]:['Полная стоимость требует уточнения.'],url:`https://avtocena.com${specialPath(s.dealerId,o.id)}`};
  try{const pdf=await renderOfferPdf(data);return new Response(new Uint8Array(pdf),{headers:{...headers,'Content-Type':'application/pdf','Content-Disposition':'inline; filename="AvtoCena-dealer.pdf"'}});}catch(error){console.error('dealer_offer_pdf_failed',error);return Response.json({error:'Не удалось подготовить PDF. Попробуйте ещё раз.'},{status:500,headers});}
 }
 let offer=await getOfferForPage(id) || await getOfferFromCurrentShard(id);
 if(!offer)return Response.json({error:"Объявление не найдено"},{status:404,headers});
 if(offer.market==="china"){
  offer=await withChinaCnyPrice(offer);
  const rate=await convertToRub(offer.sourcePrice,offer.sourceCurrency);
  if(rate)offer={...offer,sellerPriceRub:rate.sourcePriceRub,calculationSnapshot:{...offer.calculationSnapshot,currencyRate:rate}};
 }
 let savedVersion:string|undefined;
 let calculation:SavedCalculationResult|null=null,warning="",calculatedAt=new Date().toISOString();
 try{
  const parameters=validateCustomerParameters(draft);
  const saved=await getSavedOfferCalculation(offer,requestedVersion);
  const cleaned=cleanSavedDraft(draft);
  if(saved && Object.entries(cleaned).every(([k,v])=>v===(saved.draft[k] || ""))){calculation=saved.calculation;calculatedAt=saved.savedAt || calculatedAt;savedVersion=requestedVersion?saved.version:undefined;}
  else {const result=await calculateOfferWithCustomerParametersDetailed(offer,parameters);if(result.ok)calculation=result.calculation;else warning=result.error;}
 }catch{warning="Не все характеристики заполнены. Полная стоимость требует уточнения.";}
 try{
  if(calculation && !savedVersion){const scenario=await saveClientCalculation(offer,draft,calculation,user.id,user.displayName);savedVersion=scenario.version;calculatedAt=scenario.savedAt;}
  const data=offerPdfData(offer,draft,calculation,warning,calculatedAt);
  if(savedVersion){const url=new URL(data.url);url.searchParams.set("calculation",savedVersion);data.url=url.toString();}
  const pdf=await renderOfferPdf(data);
  return new Response(new Uint8Array(pdf),{headers:{...headers,"Content-Type":"application/pdf","Content-Disposition":`inline; filename="AvtoCena-${id.replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,80)}.pdf"`}});
 }catch(error){console.error("offer_pdf_failed",error);return Response.json({error:"Не удалось подготовить PDF. Попробуйте ещё раз."},{status:500,headers});}
}
