import {getOfferForPage} from '@/lib/catalog/offer-page-data';
import {offerPath} from '@/lib/catalog/offer-url';
export const dynamic='force-dynamic';
// Resolve legacy URLs before React starts streaming, so crawlers receive a real
// HTTP 308 rather than a redirect embedded in a streamed 200 response.
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params;
 const offer=await getOfferForPage(id);
 if(!offer)return new Response('Автомобиль больше недоступен',{status:404,headers:{'content-type':'text/plain; charset=utf-8','x-robots-tag':'noindex'}});
 return new Response(null,{status:308,headers:{location:offerPath(offer)+new URL(request.url).search,'cache-control':'no-store'}});
}
