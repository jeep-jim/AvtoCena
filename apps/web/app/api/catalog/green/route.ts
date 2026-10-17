import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readGreenCornerPage, readGreenCorner, publicGreenOffer } from "@/lib/catalog/green-corner";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
 const url=new URL(request.url);
  if(!url.searchParams.has("city")){const city=(await cookies()).get("avtocena_city")?.value;if(city)url.searchParams.set("city",city);}
 const page=Number(url.searchParams.get("page")||1);
 if(!Number.isInteger(page)||page<1||page>10000)return NextResponse.json({error:"invalid_green_page"},{status:400});
 const snapshot=await readGreenCorner();
 const result=await readGreenCornerPage(snapshot.items,Object.fromEntries(url.searchParams),false);
 const items=result.items.map(publicGreenOffer);
 return NextResponse.json({items,total:result.total,page},{headers:{"Cache-Control":"private, no-store"}});
}
