import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {canReadRegisteredCustomers} from '@/lib/account/crm-accounts';
import {recoveryRequests} from '@/lib/account/manual-recovery';
import {CrmShell} from '@/components/crm/CrmShell';
import {RecoveryRequestCard} from '@/components/account/RecoveryRequestCard';
export const dynamic='force-dynamic';
export default async function RecoveryQueue({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const user=await getCurrentUser();if(!user)redirect('/login');
 if(!canReadRegisteredCustomers(user))return <CrmShell activeHref="/crm/clients" title="Восстановление доступа" subtitle="Обращения пользователей"><p>Для просмотра нужен доступ ко всей клиентской базе.</p></CrmShell>;
 const params=await searchParams,archive=params.view==='archive',page=Math.max(1,Math.floor(Number(params.page)||1));
 const rows=(await recoveryRequests()).filter(r=>archive?['completed','rejected'].includes(r.status):!['completed','rejected'].includes(r.status));
 return <CrmShell activeHref="/crm/clients" title="Восстановление доступа" subtitle="Ручные обращения пользователей. Проверьте владельца кабинета перед отправкой временного пароля.">
  <nav className="mb-5 flex flex-wrap gap-3"><Link className="rounded-xl border border-[var(--ac-border)] px-4 py-2" href="/crm/clients">Клиентская база</Link><Link className="rounded-xl border border-[var(--ac-border)] px-4 py-2" href="/crm/clients/registered">Зарегистрированные</Link><Link className="avto-button rounded-xl px-4 py-2" href="/crm/clients/recovery">Восстановление доступа</Link></nav>
  <nav className="mb-4 flex gap-4"><Link href="/crm/clients/recovery" aria-current={!archive?'page':undefined}>Ожидают обработки</Link><Link href="?view=archive" aria-current={archive?'page':undefined}>Завершённые</Link></nav>
  <p>Обращений: {rows.length}</p>{rows.slice((page-1)*40,page*40).map(request=><RecoveryRequestCard key={request.id} request={request} canManage={isPlatformOwner(user)} showProfile/>)}{!rows.length&&<p className="mt-4">Обращений пока нет.</p>}
  <nav className="mt-5 flex gap-4">{page>1&&<Link href={`?view=${archive?'archive':'open'}&page=${page-1}`}>← Назад</Link>}{page*40<rows.length&&<Link href={`?view=${archive?'archive':'open'}&page=${page+1}`}>Далее →</Link>}</nav>
 </CrmShell>;
}
