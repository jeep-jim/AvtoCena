import Link from 'next/link';
import {List,LayoutGrid,ChevronLeft,ChevronRight} from 'lucide-react';
import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {canReadRegisteredCustomers,registeredCustomersPage,registeredCustomerHref} from '@/lib/account/crm-accounts';
import {customerAvatar} from '@/lib/account/avatars';
import {CrmShell} from '@/components/crm/CrmShell';
import {crmDateTime} from '@/lib/crm-time';
export const dynamic='force-dynamic';
export default async function RegisteredCustomers({searchParams}:{searchParams:Promise<Record<string,string|undefined>>}){
 const user=await getCurrentUser();if(!user)redirect('/login');if(!canReadRegisteredCustomers(user))return <CrmShell activeHref="/crm/clients" title="Зарегистрированные пользователи" subtitle="Личные кабинеты"><p>Для просмотра нужен доступ ко всей клиентской базе. Обратитесь к владельцу.</p></CrmShell>;
 const p=await searchParams,phone=String(p.q||p.phone||'').slice(0,80),page=Math.min(100000,Math.max(1,Number(p.page)||1)),{accounts,total}=await registeredCustomersPage(phone,page);
 const grid=p.view==='grid',pages=Math.max(1,Math.ceil(total/40));
 const href=(n:number,view=grid?'grid':'list')=>`?${new URLSearchParams({q:phone,page:String(n),view})}`;
 const numbers=Array.from({length:Math.min(5,pages)},(_,i)=>Math.max(1,Math.min(page-2,pages-4))+i);
 return <CrmShell activeHref="/crm/clients" title="Клиенты" subtitle="Личные кабинеты пользователей и их обращения.">
 <div className="mb-5 flex flex-wrap items-center gap-3">
 <nav className="flex flex-wrap gap-3"><Link className="rounded-xl border border-[var(--ac-border)] px-4 py-2" href="/crm/clients">Клиентская база</Link><Link className="avto-button rounded-xl px-4 py-2" href="/crm/clients/registered" aria-current="page">Зарегистрированные</Link><Link href="/crm/clients/recovery" className="rounded-xl border border-[var(--ac-border)] px-4 py-2">Восстановление доступа</Link></nav>
 <form className="flex min-w-0 flex-wrap gap-2 lg:ml-auto"><input type="hidden" name="view" value={grid?'grid':'list'}/><input className="soft-input min-w-0 rounded-xl p-3" name="q" defaultValue={phone} placeholder="Имя или телефон" aria-label="Поиск по имени или телефону" maxLength={80}/><button className="avto-button rounded-xl px-4">Найти</button>{phone&&<Link className="self-center" href={`?view=${grid?'grid':'list'}`}>Сбросить</Link>}</form>
 <nav className="flex gap-2" aria-label="Вид пользователей">{[['list','Список',List],['grid','Плитка',LayoutGrid]].map(([view,label,Icon]:any)=><Link key={view} href={href(page,view)} aria-label={label} aria-current={(grid?'grid':'list')===view?'true':undefined} className={`rounded-xl p-3 ${(grid?'grid':'list')===view?'avto-button':'border border-[var(--ac-border)]'}`}><Icon size={20}/></Link>)}</nav>
 </div><p className="mb-3">Всего: {total}</p>
 <div className={grid?'grid gap-3 sm:grid-cols-2 xl:grid-cols-3':'grid gap-2'}>{accounts.map(a=><Link key={a.id} href={registeredCustomerHref(a.id)} className={`flex gap-3 rounded-xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-3 ${grid?'flex-wrap':'items-center flex-wrap sm:flex-nowrap'}`}><img className="h-11 w-11 shrink-0 rounded-xl object-cover" alt="" src={a.avatarVersion?`/api/crm/registered-customers/${a.id}?avatar=1`:customerAvatar(a.id,a.avatarId)}/><span className="min-w-0 flex-1"><strong className="block truncate">{['Покупатель','Пользователь'].includes(a.name)?'Имя не указано':a.name}</strong><span>{a.phone}</span></span><span className={`text-xs text-[var(--ac-muted)] ${grid?'w-full':'sm:ml-auto sm:text-right'}`}>{crmDateTime(a.createdAt)}<br/>{a.disabled?'Доступ отключён':'Есть личный кабинет'}</span></Link>)}</div>
 {!accounts.length&&<p>Пользователи не найдены.</p>}
 {pages>1&&<nav className="mt-5 flex flex-wrap items-center justify-center gap-2" aria-label="Страницы пользователей">{page>1&&<Link className="rounded-xl border p-3" aria-label="Предыдущая страница" href={href(page-1)}><ChevronLeft size={20}/></Link>}{numbers.map(n=><Link key={n} className={`rounded-xl px-4 py-3 ${n===page?'avto-button':'border border-[var(--ac-border)]'}`} aria-current={n===page?'page':undefined} href={href(n)}>{n}</Link>)}{page<pages&&<Link className="rounded-xl border p-3" aria-label="Следующая страница" href={href(page+1)}><ChevronRight size={20}/></Link>}</nav>}
 </CrmShell>;
}
