import {getCurrentUser} from '@/lib/auth';
import {canManageDealer} from '@/lib/dealers/access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {quoteMarketOffer} from '@/lib/dealers/market-offer-server';
export const runtime='nodejs';
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 if(!isCalculationOriginAllowed(req)||!await canManageDealer(await getCurrentUser(),(await params).id))return Response.json({error:'Доступ запрещён'},{status:403});
 try{const text=await req.text();if(text.length>50000)return Response.json({error:'Слишком много данных'},{status:413});const {offer,city}=JSON.parse(text);return Response.json(await quoteMarketOffer(offer,city),{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Проверьте параметры автомобиля'},{status:400});}
}
