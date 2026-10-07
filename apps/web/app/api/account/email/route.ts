import {wakeRecoveryWorker} from '@/lib/account/recovery-worker';
import {issueTemporaryPassword} from '@/lib/account/temporary-password';
import {sendAccountMail} from '@/lib/account/mail';
import {createCustomerChallenge,approvedCustomerChallenge,consumeCustomerChallenge} from '@/lib/account/telegram';
import {getTelegramPublicConfig} from '@/lib/telegram-config';
import {currentAccount,accountRateLimit,accountPath,phoneAccountId,normalizeAccountPhone,passwordDigest,publicAccount,type CustomerAccount} from '@/lib/account/auth';
import {accountMailConfigured,normalizeAccountEmail,createEmailChallenge,consumeEmailChallenge} from '@/lib/account/email';
import {readAccountJson} from '@/lib/account/request';
import {readDataJson,mutateDataJson} from '@/lib/data';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
const headers={'Cache-Control':'private, no-store'};
export async function GET(){return Response.json({available:accountMailConfigured()},{headers});}
export async function POST(request:Request){if(!isCalculationOriginAllowed(request))return new Response(null,{status:403});try{
 const b=await readAccountJson(request),a=await currentAccount();
 if(!await accountRateLimit('email-ip:'+(request.headers.get('x-forwarded-for')||'unknown').split(',')[0],8))return Response.json({error:'Повторите через 15 минут.'},{status:429,headers});
 if(b.action==='complete'){const token=String(b.token||''),c=await approvedCustomerChallenge(token);const result=await issueTemporaryPassword(c.accountId,c.version!,c.hash);await sendAccountMail(c.email!,'Временный пароль АвтоЦены',`Ваш временный пароль: ${result.password}. Он действует 10 минут и подходит для одного входа на https://avtocena.com/account. После входа измените пароль в профиле. Никому не сообщайте пароль.`);await consumeCustomerChallenge(token,'reset');return Response.json({ok:true},{headers});}
 if(b.action==='bind'||b.action==='verify'){
  if(!a)return new Response(null,{status:401});
  if(b.action==='bind'){const email=normalizeAccountEmail(b.email);if(!await accountRateLimit('mailbox:'+email,4))throw Error('Повторите через 15 минут.');return Response.json({token:await createEmailChallenge(a,email,'bind')},{headers});}
  const c=await consumeEmailChallenge(String(b.token||''),String(b.code||''),'bind',a.id);let updated=a;
  await mutateDataJson<CustomerAccount|null>(accountPath(a.id),null,current=>{if(!current||current.disabled||current.sessionVersion!==c.version)throw Error('Запрос устарел. Войдите снова.');updated={...current,email:c.email,emailVerifiedAt:new Date().toISOString()};return updated;});return Response.json({ok:true,account:publicAccount(updated)},{headers});
 }
 if(b.action==='recover'){const email=normalizeAccountEmail(b.email),phone=normalizeAccountPhone(b.phone);if(!await accountRateLimit('email-recover:'+phone,4))throw Error('Повторите через 15 минут.');const account=await readDataJson<CustomerAccount|null>(accountPath(phoneAccountId(phone)),null);if(!accountMailConfigured())throw Error('Отправка писем временно недоступна. Выберите Telegram.');if(!account?.emailVerifiedAt||account.email!==email){const config=await getTelegramPublicConfig();if(!config.configured)throw Error('Для новой почты необходимо подтвердить номер. Обратитесь в поддержку.');const token=await createCustomerChallenge(account,'reset',email);await wakeRecoveryWorker().catch(()=>{});return Response.json({token,url:`https://t.me/${config.username}?start=account_${token}`},{headers});}return Response.json({token:await createEmailChallenge(account,email,'reset')},{headers});}
 if(b.action==='reset'){const passwordHash=await passwordDigest(String(b.password||''));const c=await consumeEmailChallenge(String(b.token||''),String(b.code||''),'reset');await mutateDataJson<CustomerAccount|null>(accountPath(c.accountId),null,current=>{if(!current||current.disabled||current.sessionVersion!==c.version||current.email!==c.email||!current.emailVerifiedAt)throw Error('Запрос устарел. Начните восстановление заново.');const {passwordTemporaryUntil,passwordTemporaryUsed,passwordRecoveryProof,...rest}=current;return {...rest,passwordHash,sessionVersion:current.sessionVersion+1};});return Response.json({ok:true},{headers});}
 throw Error('Неизвестное действие.');
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось подтвердить почту.'},{status:400,headers});}}
