import Link from 'next/link';
import {notFound,redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {canReadRegisteredCustomers} from '@/lib/account/crm-accounts';
import {accountPath,type CustomerAccount} from '@/lib/account/auth';
import {customerAvatar} from '@/lib/account/avatars';
import {readDataJson,readChunkedDataJson,readRecentChunkedDataJson} from '@/lib/data';
import {canSeeLead} from '@/lib/crm-visibility';
import {normalizeAccountPhone} from '@/lib/account/phone';
import {CrmShell} from '@/components/crm/CrmShell';
import {CustomerManualRecovery} from '@/components/account/CustomerManualRecovery';
import {crmDateTime} from '@/lib/crm-time';
export const dynamic='force-dynamic';
export default async function RegisteredCustomer({params}:{params:Promise<{id:string}>}){
 const user=await getCurrentUser();if(!user)redirect('/login');if(!canReadRegisteredCustomers(user))return <CrmShell activeHref="/crm/clients" title="Профиль пользователя" subtitle="Личный кабинет"><p>Для просмотра нужен доступ ко всей клиентской базе.</p></CrmShell>;
 const {id}=await params;if(!/^[a-f0-9]{64}$/.test(id))notFound();const a=await readDataJson<CustomerAccount|null>(accountPath(id),null);if(!a)notFound();
 const matches=(c:any)=>{if(c.portalAccountId)return c.portalAccountId===a.id;try{return normalizeAccountPhone(c.phone)===a.phone;}catch{return false;}};
 const clients=(await readChunkedDataJson<any>('clients/clients.json',[])).filter(c=>!c.deletedAt&&canSeeLead(user,c)&&matches(c)),ids=new Set(clients.map(c=>c.id));
 const leads=(await readChunkedDataJson<any>('leads/leads.json',[])).filter(l=>!l.deletedAt&&canSeeLead(user,l)&&(ids.has(l.clientId)||matches(l)));
 const events=await readRecentChunkedDataJson<any>('activity/feed.json',50,e=>e.entityType==='account'&&e.entityId===id||e.clientId&&ids.has(e.clientId));
 return <CrmShell activeHref="/crm/clients" title="Профиль пользователя" subtitle="Регистрация, обращения и восстановление доступа."><Link href="/crm/clients/registered">← Зарегистрированные</Link><section className="mt-4 rounded-2xl border border-[var(--ac-border)] bg-[var(--ac-surface)] p-5"><div className="flex items-center gap-4"><img className="h-16 w-16 rounded-xl object-cover" alt="Аватар пользователя" src={a.avatarVersion?`/api/crm/registered-customers/${a.id}?avatar=1`:customerAvatar(a.id,a.avatarId)}/><div><h2 className="text-xl font-bold">{a.name}</h2><p>{a.phone}</p></div></div><dl className="mt-4 grid gap-2 sm:grid-cols-2"><div><dt>Регистрация</dt><dd>{crmDateTime(a.createdAt)}</dd></div><div><dt>Доступ</dt><dd>{a.disabled?'Отключён':'Активен'}</dd></div><div><dt>Почта</dt><dd>{a.email||'Не указана'}{a.emailVerifiedAt?' · подтверждена':''}</dd></div><div><dt>Telegram</dt><dd>{a.telegramId?'Подключён по желанию пользователя':'Не подключён — восстановление по телефону доступно'}</dd></div></dl></section><section className="mt-5"><h2 className="text-xl font-bold">Карточки клиента</h2>{clients.map(c=><Link className="mt-2 block rounded-xl border border-[var(--ac-border)] p-3" key={c.id} href={`/crm/clients/${encodeURIComponent(c.id)}`}>{c.fio||c.phone} →</Link>)}{!clients.length&&<p>В доступной клиентской базе карточек пока нет.</p>}</section><section className="mt-5"><h2 className="text-xl font-bold">Заявки</h2>{leads.map(l=><Link className="mt-2 block rounded-xl border border-[var(--ac-border)] p-3" key={l.id} href={`/crm/leads?id=${encodeURIComponent(l.id)}`}>{l.offerTitle||l.car||'Подбор автомобиля'} →</Link>)}{!leads.length&&<p>Доступных заявок пока нет.</p>}</section><section className="mt-5"><h2 className="text-xl font-bold">История</h2>{events.map(e=><p className="mt-2" key={e.id}>{crmDateTime(e.createdAt)} · {e.title}</p>)}{!events.length&&<p>{crmDateTime(a.createdAt)} · Регистрация пользователя</p>}</section>{isPlatformOwner(user)&&!a.disabled&&<CustomerManualRecovery accountId={a.id}/>}</CrmShell>;
}
