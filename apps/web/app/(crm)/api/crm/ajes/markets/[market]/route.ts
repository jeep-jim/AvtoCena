import {NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export const dynamic='force-dynamic';
const response=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
type Context={params:Promise<{market:string}>};
/** Keep stale admin clients from making a paid request through the removed integration. */
async function retiredMarket(context:Context){
 const {market}=await context.params;
 return market==='china'||market==='korea'
  ?response({error:'AJ System используется только для Японии.',code:'ajes_market_retired'},410)
  :response({error:'Подключение не найдено'},404);
}
export async function GET(_req:Request,context:Context){
 if(!isPlatformOwner(await getCurrentUser()))return response({error:'Доступ запрещён'},403);
 return retiredMarket(context);
}
export async function POST(req:Request,context:Context){
 if(!isPlatformOwner(await getCurrentUser())||!isCalculationOriginAllowed(req))return response({error:'Доступ запрещён'},403);
 return retiredMarket(context);
}
