import {currentAccount,passwordMatches,passwordDigest,accountPath,accountRateLimit,type CustomerAccount} from '@/lib/account/auth';
import {readAccountJson} from '@/lib/account/request';
import {mutateDataJson} from '@/lib/data';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export async function POST(request:Request){
 if(!isCalculationOriginAllowed(request))return new Response(null,{status:403});const a=await currentAccount();if(!a)return new Response(null,{status:401});
 if(!await accountRateLimit('change-password:'+a.id,6))return Response.json({error:'Повторите через 15 минут.'},{status:429});
 try{const b=await readAccountJson(request);if(!await passwordMatches(String(b.currentPassword||''),a.passwordHash))throw Error('Текущий пароль не совпадает.');const passwordHash=await passwordDigest(String(b.password||''));
 await mutateDataJson<CustomerAccount|null>(accountPath(a.id),null,c=>{if(!c||c.disabled||c.sessionVersion!==a.sessionVersion||c.passwordHash!==a.passwordHash)throw Error('Данные доступа изменились. Повторите вход.');const {passwordTemporaryUntil,passwordTemporaryUsed,passwordRecoveryProof,...rest}=c;return {...rest,passwordHash};});
 return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось изменить пароль.'},{status:400});}
}
