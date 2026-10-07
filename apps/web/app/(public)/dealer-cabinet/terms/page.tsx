import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {canManageDealer} from '@/lib/dealers/access';
import {isPlatformOwner} from '@/lib/platform-access';
import {readMembership} from '@/lib/dealers/program-store';
import {dealerAccessLevel} from '@/lib/dealers/program-model';
import {DEALER_AGREEMENT,DEALER_AGREEMENT_VERSION} from '@/lib/dealers/agreement';
import {DealerAgreementForm} from '@/components/dealers/DealerAgreementForm';
import {DealerWorkspaceStyles} from '@/components/dealers/DealerWorkspaceStyles';
export const dynamic='force-dynamic';
export const metadata={title:'Тариф и документы — кабинет дилера',robots:{index:false,follow:false}};
export default async function Page(){
 const user=await getCurrentUser();if(!user)redirect('/login?next=/dealer-cabinet/terms');if(!user.companyId||!await canManageDealer(user,user.companyId))redirect('/dealer-cabinet');
 const m=await readMembership(user.companyId),a=m.agreement,level=dealerAccessLevel(user.companyId,m);
 return <main className="dealer-workspace mx-auto max-w-4xl px-4 py-8"><DealerWorkspaceStyles/><Link href="/dealer-cabinet">← Кабинет дилера</Link><Link className="block my-3 underline" href="/dealer-cabinet/billing">Взаиморасчёты и оплата →</Link><h1 className="my-5 text-3xl font-bold">Тариф и документы</h1><div className="dw-card mb-5"><p>Пробный месяц — без абонентской платы, комиссия 10% от согласованной базы сделки.</p><p>Подписка: 10 000 ₽ / месяц · 50 000 ₽ / 6 месяцев · 100 000 ₽ / год. Комиссия 10%.</p><p>Без абонентской платы — комиссия 15%. Покупатель оплачивает автомобиль непосредственно дилеру.</p>{level.level==='expired'&&<p className="mt-3 font-bold">Истёк тариф или ещё не подтверждено подключение. Ваши данные сохранены. Продлите подписку или выберите режим без абонентской платы.</p>}</div><details className="dw-card" open><summary className="cursor-pointer font-bold">Оферта · {DEALER_AGREEMENT_VERSION}</summary><article className="mt-5 whitespace-pre-wrap text-sm leading-7">{a?.version===DEALER_AGREEMENT_VERSION?a.text:DEALER_AGREEMENT}</article></details>{a&&a.version!==DEALER_AGREEMENT_VERSION&&<details className="dw-card mt-4"><summary>Ранее принятые условия · {a.version}</summary><article className="whitespace-pre-wrap text-sm">{a.text}</article></details>}{a&&<section className="dw-card mt-4"><p>{a.legalName} · ИНН {a.inn}</p><p>Представитель: {a.representative} · {a.authority}</p><p>Принято: {new Date(a.submittedAt).toLocaleString('ru-RU',{timeZone:'Asia/Krasnoyarsk'})}</p><p>{a.approvedAt?'Подключение подтверждено':'Ожидает подтверждения'}</p></section>}{!isPlatformOwner(user)&&<DealerAgreementForm version={m.version} agreementVersion={DEALER_AGREEMENT_VERSION} accepted={a?.version===DEALER_AGREEMENT_VERSION} approved={!!a?.approvedAt} canChoose={level.level==='expired'}/>}</main>;
}
