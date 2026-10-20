import {power30OfferId} from "@/lib/power30/calculator";
import {power30FromOffer} from "@/lib/power30/offer";
import {readOfferDetailForPage} from "@/lib/catalog/offer-page-data";
import {rankedCatalogImageUrls} from "@/lib/catalog/image-quality";
import {protectedPhotoUrl} from "@/lib/catalog/photo-proxy-policy";
import {getCertifiedPowerReferences,certifiedPowerReferenceMatches} from "@/lib/catalog/power-reference";
export const runtime="nodejs";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"private, no-store","X-Robots-Tag":"noindex, nofollow, noarchive"};
const requests=new Map<string,{count:number;until:number}>();
export async function GET(request:Request){
  const now=Date.now();for(const [key,value] of requests)if(value.until<now)requests.delete(key);
  const key=request.headers.get("x-real-ip")||request.headers.get("x-forwarded-for")?.split(",")[0]||"unknown";
  const limit=requests.get(key)||{count:0,until:now+60000};
  if(++limit.count>20 || requests.size>10000)return Response.json({error:"Слишком много запросов. Повторите через минуту."},{status:429,headers:{...headers,"Retry-After":"60"}});
  requests.set(key,limit);
  let id:string;
  try{id=power30OfferId(new URL(request.url).searchParams.get("url"));}catch(error){return Response.json({error:(error as Error).message},{status:400,headers});}
  try{
    const {offer,unavailable}=await readOfferDetailForPage(id);
    if(unavailable)return Response.json({error:"Источник временно недоступен. Попробуйте позже."},{status:503,headers});
    if(!offer)return Response.json({error:"Объявление не найдено. Проверьте ссылку."},{status:404,headers});
    const result=power30FromOffer(offer);
    const image=rankedCatalogImageUrls(offer)[0];if(image)result.image=protectedPhotoUrl(image,offer.market);
    if(!result.certified && offer.market!=="uae" && result.inputs.kind!=="ICE"){
      try{
        const matches=(await getCertifiedPowerReferences()).filter(ref=>
          (ref.trimContains?.length || ref.driveContains?.length || ref.requireOfferPeakPower)
          && ref.yearFrom && ref.yearTo && certifiedPowerReferenceMatches(ref,offer));
        const powers=matches.map(ref=>ref.power30MinKw || ref.power30MinKwByMotor?.reduce((a,b)=>a+b,0));
        if(matches.length && powers.every(value=>typeof value==="number" && Number.isFinite(value) && value>0 && value<=2000 && Math.abs(value-powers[0]!)<.1)){
          const ref=matches[0];result.certified={kw:powers[0]!,source:`${ref.sourceDocumentType}: ${ref.sourceDocumentId}`,url:ref.sourceUrl?.startsWith("https://")?ref.sourceUrl:undefined};
          if(result.inputs.kind==="BEV" && !result.inputs.peak && ref.peakPowerKw){result.inputs.peak=String(ref.peakPowerKw);result.inputSources.peak="Документ для соответствующей модификации";}
        }
      }catch{result.notes.push("Справочник подтверждённых мощностей временно недоступен.");}
    }
    return Response.json(result,{headers});
  }catch{return Response.json({error:"Не удалось загрузить автомобиль. Повторите попытку позже."},{status:503,headers});}
}
