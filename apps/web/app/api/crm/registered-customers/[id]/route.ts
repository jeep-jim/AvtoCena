import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {canReadRegisteredCustomers,registeredCustomerHref} from '@/lib/account/crm-accounts';
import {accountPath,accountRateLimit,type CustomerAccount} from '@/lib/account/auth';
import {readDataJson,getJsonStorage} from '@/lib/data';
import {issueTemporaryPassword} from '@/lib/account/temporary-password';
import {recordCrmActivity} from '@/lib/crm-activity';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
export async function GET(req:Request,{params}:{params:Promise<{id:string}>}){if(!canReadRegisteredCustomers(await getCurrentUser()))return new Response(null,{status:403,headers});const {id}=await params;if(!/^[a-f0-9]{64}$/.test(id))return new Response(null,{status:404,headers});const a=await readDataJson<CustomerAccount|null>(accountPath(id),null);if(!a?.avatarVersion||new URL(req.url).searchParams.get('avatar')!=='1')return new Response(null,{status:404,headers});const file=await getJsonStorage().getBinary?.(`accounts/avatars/${id}.webp`);return file?new Response(new Uint8Array(file.data),{headers:{...headers,'Content-Type':'image/webp'}}):new Response(null,{status:404,headers});}
export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){
 const user=await getCurrentUser();if(!isPlatformOwner(user)||!isCalculationOriginAllowed(req))return new Response(null,{status:403,headers});
 if(!await accountRateLimit('manual-account-reset:'+user!.id,5))return Response.json({error:'Повторите через 15 минут.'},{status:429,headers});
 try{const {id}=await params;const raw=await req.text();if(raw.length>2048)return new Response(null,{status:413,headers});const b=JSON.parse(raw),reason=String(b.reason||'').trim();if(b.identityConfirmed!==true||reason.length<15||reason.length>500)throw Error('Укажите, как проверена личность владельца номера.');const a=await readDataJson<CustomerAccount|null>(accountPath(id),null);if(!a||a.disabled)throw Error('Кабинет недоступен.');
 await recordCrmActivity(user,{type:'customer_manual_recovery_requested',title:'Запрошено ручное восстановление доступа',entityType:'account',entityId:a.id,entityLabel:a.name,text:reason,href:registeredCustomerHref(a.id),visibility:'team'});
 const result=await issueTemporaryPassword(a.id,a.sessionVersion);
 await recordCrmActivity(user,{type:'customer_manual_recovery_issued',title:'Выдан временный пароль',entityType:'account',entityId:a.id,entityLabel:a.name,href:registeredCustomerHref(a.id),visibility:'team'});
 return Response.json(result,{headers});}catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось восстановить доступ.'},{status:400,headers});}
}
