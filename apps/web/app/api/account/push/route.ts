import {currentAccount,accountRateLimit} from '@/lib/account/auth';
import {readAccountJson} from '@/lib/account/request';
import {pushKeys} from '@/lib/crm-push';
import {registerCustomerPush,removeCustomerPush} from '@/lib/account/push';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export const dynamic='force-dynamic';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(){const a=await currentAccount();if(!a)return json({error:'Войдите в кабинет.'},401);return json({publicKey:(await pushKeys())?.publicKey});}
async function update(request:Request,remove:boolean){if(!isCalculationOriginAllowed(request))return json({error:'Нет доступа.'},403);const a=await currentAccount();if(!a)return json({error:'Войдите в кабинет.'},401);try{if(!await accountRateLimit('push:'+a.id,40,300000))return json({error:'Повторите немного позже.'},429);const b=await readAccountJson(request);if(remove){if(typeof b.endpoint!=='string'||b.endpoint.length>2048)throw Error();await removeCustomerPush(a.id,b.endpoint);}else await registerCustomerPush(a,b as any);return json({ok:true});}catch{return json({error:'Не удалось сохранить уведомления.'},400);}}
export const POST=(r:Request)=>update(r,false);
export const DELETE=(r:Request)=>update(r,true);
