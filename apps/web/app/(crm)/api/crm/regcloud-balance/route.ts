import {NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {readRegcloudBalance,connectRegcloudBalance,validRegcloudToken} from '@/lib/regcloud-balance';
export const dynamic='force-dynamic';
const reply=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(){
 if(!isPlatformOwner(await getCurrentUser()))return reply({error:'Доступ запрещён'},403);
 try{return reply(await readRegcloudBalance());}catch{return reply({error:'Не удалось обновить баланс. Проверьте его в кабинете REG.'},503);}
}
export async function PUT(req:Request){
 if(!isPlatformOwner(await getCurrentUser())||!req.headers.get('origin')||!isCalculationOriginAllowed(req))return reply({error:'Доступ запрещён'},403);
 let token:unknown;
 try{const raw=await req.text();if(Buffer.byteLength(raw)>4096)return reply({error:'Слишком большой запрос'},413);token=JSON.parse(raw).token;}catch{return reply({error:'Проверьте API-ключ REG'},400);}
 if(!validRegcloudToken(token))return reply({error:'Проверьте API-ключ REG'},400);
 try{return reply(await connectRegcloudBalance(token));}catch{return reply({error:'Подключение не подтверждено. Проверьте API-ключ REG и повторите.'},503);}
}
