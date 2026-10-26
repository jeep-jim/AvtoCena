import {readManagementKnowledge} from '../../../../lib/catalog/management-knowledge';
import {attachManagementPreviews} from '../../../../lib/catalog/management-previews';
import {NextResponse} from "next/server";
import {getGreenCornerOffer} from "../../../../lib/catalog/green-corner";
import {getSavedOfferCalculation} from "../../../../lib/catalog/saved-offer-calculation";
import {savedPreviewEntry,readSavedPreviewIndex} from "../../../../lib/catalog/saved-calculation-previews";
export const dynamic="force-dynamic";
export async function GET(request:Request) {
 const ids=new URL(request.url).searchParams.get("ids")||"";
 const keys=[...new Set(ids.split(",").filter(Boolean))];
 if(ids.length>6000||keys.length>50||keys.some(id=>!/^[a-zA-Z0-9_-]{1,120}$/.test(id)))return NextResponse.json({error:"invalid_ids"},{status:400});
 const index=keys.length?await readSavedPreviewIndex(keys):null;
 const knowledge=keys.length?await readManagementKnowledge().catch(()=>null):null;
 const learned=new Map<string,any>();
 if(knowledge&&Object.keys(knowledge.models).length){
  const {getOfferForPage}=await import('../../../../lib/catalog/offer-page-data');
  let cursor=0;
  await Promise.all(Array.from({length:Math.min(4,keys.length)},async()=>{while(cursor<keys.length){const id=keys[cursor++];if(index?.entries[id])continue;try{const offer=await getOfferForPage(id);if(!offer)continue;const [enriched]=await attachManagementPreviews([offer],null);const preview=(enriched as any).savedCalculationPreview;if(preview)learned.set(id,{market:offer.market,sourceGroup:offer.sourceId,preview});}catch{}}}));
 }
 const previews=Object.fromEntries(await Promise.all(keys.map(async id=>{
  let e=index?.entries[id];
  if(e && /^green-\d+$/.test(id)){
   const offer=await getGreenCornerOffer(id);
   const saved=offer?await getSavedOfferCalculation(offer):null;
   e=offer&&saved?savedPreviewEntry(saved,offer)||undefined:undefined;
  }
  return [id,e?{market:e.market,sourceGroup:e.sourceId,preview:e.preview}:learned.get(id)||null];
 })));
 return NextResponse.json({previews},{headers:{"Cache-Control":"no-store"}});
}
