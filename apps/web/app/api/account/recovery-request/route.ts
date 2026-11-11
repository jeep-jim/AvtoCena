import {accountRateLimit,normalizeAccountPhone} from '@/lib/account/auth';
import {normalizeAccountEmail} from '@/lib/account/email';
import {createRecoveryRequest} from '@/lib/account/manual-recovery';
import {readAccountJson} from '@/lib/account/request';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request){
 if(!isCalculationOriginAllowed(request))return new Response(null,{status:403,headers});
 try{
  const ip=(request.headers.get('x-forwarded-for')||'unknown').split(',')[0];
  if(!await accountRateLimit('support-recovery-ip:'+ip,8))return Response.json({error:'Слишком много обращений. Повторите через 15 минут.'},{status:429,headers});
  const body=await readAccountJson(request),phone=normalizeAccountPhone(body.phone),email=normalizeAccountEmail(body.email);
  if(body.consent!==true)throw Error('Подтвердите согласие на обработку данных обращения.');
  if(!await accountRateLimit('support-recovery-phone:'+phone,3))return Response.json({error:'Заявка уже могла быть отправлена. Повторите через 15 минут.'},{status:429,headers});
  await createRecoveryRequest(phone,email);
  // Identical public response, including when the phone is unknown or disabled.
  return Response.json({ok:true},{headers});
 }catch(e){return Response.json({error:e instanceof Error&&/телефон|номер|почт|адрес|согласие|форм|запрос/i.test(e.message)?e.message:'Не удалось отправить заявку. Попробуйте ещё раз.'},{status:400,headers});}
}
