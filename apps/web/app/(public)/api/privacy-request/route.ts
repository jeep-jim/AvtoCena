import {createHash} from 'node:crypto';
import {NextResponse,after} from 'next/server';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {appendChunkedDataJson} from '@/lib/data';
import {guardLead,leadVisitor} from '@/lib/lead-antispam';
import {normalizeRuPhone} from '@/lib/ru-phone';
import {requestCrmDelivery} from '@/lib/crm-dispatch';
import {PRIVACY_VERSION} from '@/lib/privacy-documents';
export async function POST(request:Request){
 if(!isCalculationOriginAllowed(request))return NextResponse.json({error:'Недопустимый источник запроса.'},{status:403});
 const body=await request.json().catch(()=>null),name=typeof body?.name==='string'?body.name.trim().slice(0,300):'',contact=String(body?.contact||body?.phone||'').trim().slice(0,180),email=/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)?contact:'',phone=email?'':normalizeRuPhone(contact),message=typeof body?.message==='string'?body.message.trim().slice(0,3000):'';
 if(!name||(!phone&&!email)||message.length<5||!/^[a-zA-Z0-9-]{16,100}$/.test(body?.operationId||''))return NextResponse.json({error:'Укажите имя, телефон или email и суть обращения.'},{status:400});
 const visitor=leadVisitor(request),headers=new Headers(request.headers);headers.set('cookie',`${(headers.get('cookie')||'').split(';').filter(c=>!c.trim().startsWith('ac_lead_visitor=')).join(';')}; ac_lead_visitor=${visitor.cookie}`);
 const blocked=await guardLead(new Request(request.url,{headers}),body,[],[phone||email]);if(blocked)return blocked;
 const id='privacy_'+createHash('sha256').update(`${body.operationId}:${name}:${phone||email}:${message}`).digest('hex').slice(0,32),now=new Date().toISOString();
 try{
  await appendChunkedDataJson('leads/leads.json',{id,source:'privacy_request',name,phone,email,car:'Обращение по персональным данным',comment:email?`Контакт для ответа: ${email}\n${message}`:message,status:'new',contactPreference:'call',createdAt:now,updatedAt:now,notificationRequestedAt:now,legalBasis:'152-FZ:14,20,21',privacyPolicyVersion:PRIVACY_VERSION,analyticsConsent:false});
  after(()=>requestCrmDelivery().catch(()=>undefined));
  const response=NextResponse.json({ok:true,id});response.cookies.set('ac_lead_visitor',visitor.cookie,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:86400*30});response.headers.set('cache-control','no-store');return response;
 }catch{return NextResponse.json({error:'Не удалось сохранить обращение. Повторите отправку.'},{status:503});}
}
