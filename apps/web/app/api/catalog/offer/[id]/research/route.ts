import { NextResponse } from "next/server";
import { getOfferForPage } from "@/lib/catalog/offer-page-data";
import { getOfferFromCurrentShard } from "@/lib/catalog/storage";
import { searchSpecificationSuggestions } from "@/lib/catalog/specification-research";
export const runtime = "nodejs";
// Bounded per-instance protection for the opt-in prototype. No Object Storage writes.
let nextRequest = 0;
let hourStart = Date.now();
let requests = 0;
export async function POST(request: Request, {params}:{params:{id:string}}) {
 const headers={"Cache-Control":"no-store"};
 if(request.headers.get("origin")!==new URL(request.url).origin)
  return NextResponse.json({error:"Недопустимый источник запроса"},{status:403,headers});
 if(!process.env.YANDEX_SEARCH_API_KEY || !process.env.YANDEX_SEARCH_FOLDER_ID)
  return NextResponse.json({candidates:[],searchStatus:"not_configured"},{headers});
 const now=Date.now();
 if(now-hourStart>=3600000){hourStart=now;requests=0;}
 if(now<nextRequest || requests>=30)
  return NextResponse.json({error:"Поиск занят. Попробуйте позднее."},{status:429,headers:{...headers,"Retry-After":"60"}});
 nextRequest=now+60000;requests++;
 try {
  const offer=await getOfferForPage(params.id)||await getOfferFromCurrentShard(params.id);
  if(!offer)return NextResponse.json({error:"Объявление не найдено"},{status:404,headers});
  return NextResponse.json(await searchSpecificationSuggestions(offer),{headers});
 }catch{return NextResponse.json({error:"Поиск временно недоступен"},{status:503,headers});}
}
