import { NextResponse } from "next/server";
import { getOfferDetailRecord } from "@/lib/catalog/offer-page-data";
import { rankedCatalogImageUrls, catalogAuctionSheetUrls } from "@/lib/catalog/image-quality";
import { protectedPhotoUrl } from "@/lib/catalog/photo-proxy-policy";

export async function GET(_request: Request, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  if (!id || id.length > 200) return NextResponse.json({images:[]}, {status:400});
  // Same publication/editorial guards as the detail page. Return only image URLs,
  // without recalculating prices, fetching source sites or exposing the raw record.
  const offer = await getOfferDetailRecord(id);
  if (!offer) return NextResponse.json({images:[]}, {status:404});
  const sheets = new Set(catalogAuctionSheetUrls(offer));
  const images = rankedCatalogImageUrls(offer).filter(url => !sheets.has(url)).slice(0,5)
    .map(url => protectedPhotoUrl(url, offer.market));
  return NextResponse.json({images}, {headers:{"Cache-Control":"private, max-age=60"}});
}
