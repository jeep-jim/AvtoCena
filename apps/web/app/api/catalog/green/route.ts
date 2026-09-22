import { NextResponse } from "next/server";
import { currentGreenCornerPrices, readGreenCorner, publicGreenOffer } from "@/lib/catalog/green-corner";
import { filterGreenCorner } from "@/lib/catalog/green-corner-search";
import { applyActiveBusinessPricingBatch } from "@/lib/catalog/live-business-pricing";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
 const url=new URL(request.url);
 const page=Number(url.searchParams.get("page")||1);
 if(!Number.isInteger(page)||page<1||page>10000)return NextResponse.json({error:"invalid_green_page"},{status:400});
 const snapshot=await readGreenCorner();
 const matched=filterGreenCorner(await currentGreenCornerPrices(snapshot.items),Object.fromEntries(url.searchParams));
 const items=await applyActiveBusinessPricingBatch(matched.slice((page-1)*24,page*24).map(publicGreenOffer));
 return NextResponse.json({items,total:matched.length,page},{headers:{"Cache-Control":"private, no-store"}});
}
