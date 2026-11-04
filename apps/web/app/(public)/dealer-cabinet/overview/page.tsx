import Link from 'next/link';
import {cabinetUser} from '@/lib/dealers/cabinet-user';
import {readChunkedDataJson} from '@/lib/data';
import {readCrmUsers} from '@/lib/crm-users';
import {leadDealerId} from '@/lib/dealers/lead-routing';
import {dealerLeadView} from '@/lib/dealers/lead-workflow';
import {CrmPageHeading,CrmMetricCards} from '@/components/crm/CrmWorkspaceFrame';
import {StaffPresence} from '@/components/crm/StaffPresence';
import {workspaceClientsPath,canAccessDocumentClient} from '@/lib/document-workspace';
import {readyDealerClients} from '@/lib/dealers/client-workflow';
export const dynamic='force-dynamic';
export default async function Page(){
 const user=await cabinetUser(),company=user.companyId!;
 const [stored,users,storedClients]=await Promise.all([readChunkedDataJson<any>('leads/leads.json',[]),readCrmUsers(),readChunkedDataJson<any>(workspaceClientsPath(user),[])]);
 const leads=stored.filter(l=>leadDealerId(l)===company&&!l.archivedAt),unassigned=leads.filter(l=>!l.assignedManagerId),mine=leads.filter(l=>l.assignedManagerId===user.id);
 const staff=users.filter(u=>u.companyId===company&&u.status!=='disabled'),clients=await readyDealerClients(user,storedClients.filter(c=>canAccessDocumentClient(user,c)));
 const recent=leads.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,8).map(l=>dealerLeadView(l,company)).filter(Boolean);
 return <section className="dealer-cabinet-content"><CrmPageHeading title="Панель управления" help="Заявки, клиенты и сотрудники вашей компании."/><CrmMetricCards items={[{label:'Все лиды',value:leads.length},{label:'Мои заявки',value:mine.length},{label:'Клиенты',value:clients.length},{label:'Сотрудники',value:staff.length}]}/><StaffPresence endpoint="/api/dealers/presence" profileBase="/dealer-cabinet/team#"/><div className="crm-overview-columns mt-5 grid gap-5 lg:grid-cols-[1fr_340px]"><div className="glass rounded-[2rem] p-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl font-black">Последние заявки</h2><Link href="/dealer-cabinet/leads" className="rounded-full bg-white/10 px-4 py-2 text-sm font-black text-white/70">Открыть заявки</Link></div><div className="crm-overview-feed mt-5 space-y-3">{recent.map(l=>l&&<Link key={l.id} href={`/dealer-cabinet/leads?id=${encodeURIComponent(l.id)}`} className="block rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface-2)] p-4"><strong>{l.open?l.name:'Новая заявка'}</strong><p className="mt-2 text-sm">{l.title}</p><time className="text-xs text-[var(--ac-muted)]">{new Date(l.createdAt).toLocaleString('ru-RU',{timeZone:'Asia/Krasnoyarsk'})}</time></Link>)}{!recent.length&&<p>Заявок пока нет.</p>}</div></div><div className="crm-overview-aside grid gap-5"><div className="glass rounded-[2rem] p-6"><h2 className="text-2xl font-black">Быстрые действия</h2><div className="crm-quick-actions mt-5 grid grid-cols-2 gap-3"><Link href="/dealer-cabinet/documents#new-client" className="avto-button col-span-2 rounded-2xl px-5 py-4 text-center font-black">Добавить клиента</Link><Link href="/dealer-cabinet/leads?manager=me" className="rounded-2xl bg-white/10 px-5 py-4 text-center font-black text-white/70">Мои заявки</Link><Link href="/dealer-cabinet/team" className="rounded-2xl bg-white/10 px-5 py-4 text-center font-black text-white/70">Сотрудники</Link></div></div><div className="glass rounded-[2rem] p-6"><h2 className="text-2xl font-black">Сводка</h2><div className="mt-4 space-y-3 text-sm font-bold"><p>Новые заявки: {leads.filter(l=>(l.status||'new')==='new').length}</p><p>Без ответственного: {unassigned.length}</p></div></div></div></div></section>;
}
