import Link from 'next/link';
import {cabinetUser} from '@/lib/dealers/cabinet-user';
import {readChunkedDataJson} from '@/lib/data';
import {readCrmUsers} from '@/lib/crm-users';
import {leadDealerId} from '@/lib/dealers/lead-routing';
import {readShowcase} from '@/lib/dealers/showcase-store';
import {dealerProfilePath} from '@/lib/dealers/profile-url';
import {StartDealerSelection} from '@/components/dealers/StartDealerSelection';
export const dynamic='force-dynamic';
export default async function Page(){
 const user=await cabinetUser(),company=user.companyId!;
 const [stored,users,showcase]=await Promise.all([readChunkedDataJson<any>('leads/leads.json',[]),readCrmUsers(),readShowcase(company)]);
 const leads=stored.filter(l=>leadDealerId(l)===company&&!l.archivedAt),unassigned=leads.filter(l=>!l.assignedManagerId),mine=leads.filter(l=>l.assignedManagerId===user.id);
 const staff=users.filter(u=>u.companyId===company&&u.status!=='disabled');
 return <main className="dealer-cabinet-content"><h1 className="dealer-cabinet-title">Обзор · {showcase.name}</h1><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[['Заявки',leads.length,'/dealer-cabinet/leads'],['Без ответственного',unassigned.length,'/dealer-cabinet/leads?manager=unassigned'],['Мои заявки',mine.length,'/dealer-cabinet/leads?manager=me'],['Сотрудники',staff.length,'/dealer-cabinet/team']].map(([label,count,href])=><Link key={label} href={String(href)} className="rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-5"><span>{label}</span><strong className="mt-3 block text-3xl">{count}</strong></Link>)}</div><section className="my-6 rounded-2xl border border-[var(--ac-border)] p-5"><h2 className="mb-3 text-xl font-bold">Работа с обращениями</h2><p>Откройте заявку, назначьте ответственного и после звонка сохраните результат общения. Просмотр заявки не означает, что сотрудник взял её в работу.</p>{unassigned.length>0&&<Link className="mt-4 inline-block font-bold text-red-500" href="/dealer-cabinet/leads?manager=unassigned">Требуют назначения: {unassigned.length}</Link>}</section><div className="flex flex-wrap gap-3"><StartDealerSelection dealerId={company} href={dealerProfilePath(showcase)}/><Link className="rounded-xl border border-[var(--ac-border)] p-3" href="/dealer-cabinet/profile">Мой профиль</Link><Link className="rounded-xl border border-[var(--ac-border)] p-3" href="/dealer-cabinet">Настроить компанию</Link></div></main>;
}
