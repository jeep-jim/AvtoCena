import {readAccountJson} from '@/lib/account/request';
import {createCustomerChallenge,consumeCustomerChallenge} from '@/lib/account/telegram';
import {currentAccount,accountRateLimit,normalizeAccountPhone,phoneAccountId,accountPath,passwordDigest,type CustomerAccount} from '@/lib/account/auth';
import {readDataJson,mutateDataJson} from '@/lib/data';
import {getTelegramPublicConfig} from '@/lib/telegram-config';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export async function POST(request:Request){if(!isCalculationOriginAllowed(request))return new Response(null,{status:403});try{const b=await readAccountJson(request);let a=await currentAccount();
 if(!await accountRateLimit('telegram:'+(a?.id||(request.headers.get('x-forwarded-for')||'unknown').split(',')[0])))return Response.json({error:'Повторите через 15 минут.'},{status:429});
 if(b.action==='reset'){const passwordHash=await passwordDigest(String(b.password||''));const c=await consumeCustomerChallenge(String(b.token||''),'reset');await mutateDataJson<CustomerAccount|null>(accountPath(c.accountId),null,current=>{if(!current||current.disabled||current.telegramId!==c.telegramId)throw Error('Нет доступа.');return {...current,passwordHash,sessionVersion:current.sessionVersion+1};});return Response.json({ok:true});}
 if(b.action!=='bind'&&b.action!=='recover')throw Error('Неизвестное действие.');
 const config=await getTelegramPublicConfig();if(!config.configured)throw Error('Telegram временно недоступен.');
 if(b.action==='bind'&&!a)return new Response(null,{status:401});
 if(b.action==='recover')a=await readDataJson<CustomerAccount|null>(accountPath(phoneAccountId(normalizeAccountPhone(b.phone))),null);
 const token=await createCustomerChallenge(a,b.action==='bind'?'bind':'reset');return Response.json({token,url:`https://t.me/${config.username}?start=account_${token}`},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось подтвердить.'},{status:400});}}
