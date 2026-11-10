import {readOfferDetailForPage} from '@/lib/catalog/offer-page-data';
import {resolveOfferDisplay} from '@/lib/catalog/offer-display-data';
import {resolveDealerBrowsingContext} from '@/lib/dealers/resolve-browsing-context';
import {validDealerId} from '@/lib/dealers/showcase-store';
import {PUBLIC_CATALOG_MARKETS} from '@/lib/catalog/runtime-config';
import {readRelatedOffers} from '@/lib/catalog/related-offers-data';
import {runRelatedOfferOperation} from '@/lib/catalog/related-offers-scheduler';

export const dynamic='force-dynamic';
export const runtime='nodejs';
export const revalidate=0;
const responseHeaders={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow, noarchive'};
const failed=(status:number)=>Response.json({error:'related_offers_unavailable'},{status,headers:responseHeaders});

export async function GET(request:Request){
  const params=new URL(request.url).searchParams;
  const id=params.get('id')||'',dealerId=params.get('dealer')||'',preview=params.get('preview');
  if([...params.keys()].some(key=>!['id','dealer','preview'].includes(key)||params.getAll(key).length!==1)
    ||!/^[A-Za-z0-9_-]{1,160}$/.test(id)||id.startsWith('special_')
    ||params.has('dealer')&&!validDealerId(dealerId)
    ||preview!==null&&(preview!=='1'||!dealerId))return failed(400);
  try{
    const dealer=dealerId?await runRelatedOfferOperation(()=>resolveDealerBrowsingContext(dealerId,preview==='1')):null;
    if(dealerId&&!dealer)return failed(404);
    const detail=await runRelatedOfferOperation(()=>readOfferDetailForPage(id));
    if(detail.unavailable)return failed(503);
    const stored=detail.offer;
    if(!stored||!PUBLIC_CATALOG_MARKETS.includes(stored.market)
      ||stored.market==='korea'&&stored.sourceId!=='ajes_korea_feed'
      ||dealer&&!dealer.markets.includes(stored.market as any))return failed(404);
    // Reuse the authoritative display mapping, without accepting a client's
    // calculation scenario or specification/price fields as search inputs.
    const display=await runRelatedOfferOperation(()=>resolveOfferDisplay(stored));
    const payload=await readRelatedOffers({...display.raw,sourceId:display.offer.sourceId,offerType:display.offer.offerType},{markets:dealer?.markets});
    return Response.json(payload,{headers:responseHeaders});
  }catch{return failed(503);}
}
