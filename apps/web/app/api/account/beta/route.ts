import {readAccountJson} from '@/lib/account/request';
import {accountRateLimit,hash} from '@/lib/account/auth';
import {appendChunkedDataJson} from '@/lib/data';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export async function POST(request:Request){
 if(!isCalculationOriginAllowed(request))return new Response(null,{status:403});
 try{if(!await accountRateLimit('beta:'+(request.headers.get('x-forwarded-for')||'unknown').split(',')[0],5,3600000))return Response.json({error:'Повторите позже.'},{status:429});
 const b=await readAccountJson(request);if(!['blogger','supplier'].includes(b.role)||b.consent!==true)throw Error('Выберите роль и подтвердите согласие.');
 const name=String(b.name||'').trim(),contact=String(b.contact||'').trim(),about=String(b.about||'').trim();if(!name||name.length>100||contact.length<5||contact.length>160||about.length<10||about.length>2000)throw Error('Проверьте имя, контакт и описание.');
 await appendChunkedDataJson('accounts/beta-applications.json',{id:hash(b.role+':'+contact.toLowerCase()),role:b.role,name,contact,about,consentAt:new Date().toISOString(),createdAt:new Date().toISOString(),status:'new'},50);
 return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось отправить заявку.'},{status:400});}
}
