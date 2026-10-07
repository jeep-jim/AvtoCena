import {SESSION_COOKIE_MAX_AGE} from "@/lib/session-policy";
import {readAccountJson} from '@/lib/account/request';
import {NextResponse} from 'next/server';
import {ACCOUNT_COOKIE,accountSession,currentAccount,publicAccount,accountRateLimit,normalizeAccountPhone,registerAccount,phoneAccountId,accountPath,passwordMatches,type CustomerAccount} from '@/lib/account/auth';
import {readDataJson} from '@/lib/data';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export const dynamic='force-dynamic';
export async function GET(){const a=await currentAccount();return NextResponse.json({account:a?publicAccount(a):null},{headers:{'Cache-Control':'private, no-store'}});}
export async function POST(request:Request){
 if(!isCalculationOriginAllowed(request))return NextResponse.json({error:'Нет доступа.'},{status:403});
 if(Number(request.headers.get('content-length'))>4096)return new Response(null,{status:413});
 try{const b=await readAccountJson(request);if(b.action==='logout'){const r=NextResponse.json({ok:true});r.cookies.set(ACCOUNT_COOKIE,'',{httpOnly:true,path:'/',maxAge:0,sameSite:'lax',secure:process.env.NODE_ENV==='production'});return r;}
 const phone=normalizeAccountPhone(b.phone);
 if(!await accountRateLimit('phone:'+phone)||!await accountRateLimit('ip:'+(request.headers.get('x-forwarded-for')||'unknown').split(',')[0]))return NextResponse.json({error:'Слишком много попыток. Повторите через 15 минут.'},{status:429});
 let a:CustomerAccount|null=null;
 if(b.action==='register'){if(b.consent!==true)throw Error('Подтвердите согласие на обработку данных.');a=await registerAccount(phone,String(b.password||''),String(b.name||''));}
 else if(b.action==='login'){a=await readDataJson<CustomerAccount|null>(accountPath(phoneAccountId(phone)),null);const match=await passwordMatches(String(b.password||''),a?.passwordHash||'0'.repeat(32)+':'+ '0'.repeat(128));if(!a||a.disabled||!match)throw Error('Телефон или пароль не совпадают.');}
 else throw Error('Неизвестное действие.');
 const r=NextResponse.json({ok:true,account:publicAccount(a)},{headers:{'Cache-Control':'private, no-store'}});r.cookies.set(ACCOUNT_COOKIE,accountSession(a),{httpOnly:true,path:'/',sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:SESSION_COOKIE_MAX_AGE});return r;
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:'Не удалось войти.'},{status:400,headers:{'Cache-Control':'no-store'}});}
}
