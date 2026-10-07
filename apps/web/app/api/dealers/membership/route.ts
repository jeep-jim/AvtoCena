import {createHash} from 'node:crypto';
import {getCurrentUser} from '@/lib/auth';
import {canManageDealer} from '@/lib/dealers/access';
import {readShowcase} from '@/lib/dealers/showcase-store';
import {EMPTY_MEMBERSHIP,type Membership} from '@/lib/dealers/program-model';
import {DEALER_AGREEMENT,DEALER_AGREEMENT_VERSION} from '@/lib/dealers/agreement';
import {mutateDataJson} from '@/lib/data';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
const headers={'Cache-Control':'private, no-store'};
export async function POST(request:Request){
 const user=await getCurrentUser();if(!user||!user.companyId||!await canManageDealer(user,user.companyId)||!isCalculationOriginAllowed(request))return Response.json({error:'Нет доступа'},{status:403,headers});
 try{
 const raw=await request.text();if(raw.length>5000)throw Error('Слишком большой запрос');const b=JSON.parse(raw);
 const showcase=await readShowcase(user.companyId);const r=showcase?.requisites;
 await mutateDataJson<Membership>(`dealers/memberships/${user.companyId}.json`,EMPTY_MEMBERSHIP,m=>{
 if(m.version!==b.version)throw Error('Условия изменились. Обновите страницу');
 if(b.action==='accept'){
 if(m.agreement)throw Error('Заявление уже сохранено. Обратитесь к команде АвтоЦены для уточнения');
 if(b.agreementVersion!==DEALER_AGREEMENT_VERSION||b.confirmed!==true)throw Error('Ознакомьтесь с актуальной офертой');
 const representative=String(b.representative||'').trim(),authority=String(b.authority||'').trim();
 if(representative.length<5||representative.length>200||authority.length<3||authority.length>500)throw Error('Укажите ФИО и основание полномочий');
 if(!r?.legalName||!r.inn||!r.ogrn||!r.legalAddress)throw Error('Сначала заполните реквизиты компании в настройках');
 return {...m,version:m.version+1,agreement:{version:DEALER_AGREEMENT_VERSION,text:DEALER_AGREEMENT,digest:createHash('sha256').update(DEALER_AGREEMENT).digest('hex'),submittedAt:new Date().toISOString(),actorId:user.id,representative,authority,legalName:r.legalName,inn:r.inn,ogrn:r.ogrn,address:r.legalAddress}};
 }
 if(b.action==='commission'){
 if(!m.agreement?.approvedAt||b.confirmed!==true)throw Error('Сначала подтвердите подключение и выбор режима');
 if(Date.parse(m.paidUntil)>Date.now()||Date.parse(m.trialEndsAt)>Date.now())throw Error('До окончания текущего периода действует комиссия 10%. Выберите новый режим после его окончания');
 return {...m,version:m.version+1,plan:'commission'};
 }throw Error('Неизвестное действие');
 });return Response.json({ok:true},{headers});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось сохранить'},{status:400,headers});}
}
