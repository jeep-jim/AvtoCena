import {dealerLeadView} from '@/lib/dealers/lead-workflow';
import {readCrmUsers} from '@/lib/crm-users';
import {DealerLeadActions} from '@/components/dealers/DealerLeadActions';
import {DealerWorkspaceStyles} from '@/components/dealers/DealerWorkspaceStyles';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {canManageDealer} from '@/lib/dealers/access';
import {isPlatformTeam} from '@/lib/platform-access';
import {leadDealerId} from '@/lib/dealers/lead-routing';
import {readChunkedDataJson} from '@/lib/data';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string>>}){
 const user=await getCurrentUser();if(!user)redirect('/login?next=/dealer-cabinet/leads');if(isPlatformTeam(user))redirect('/crm/leads?view=dealers');if(!await canManageDealer(user,user.companyId||''))redirect('/dealer-cabinet');
 const managers=(await readCrmUsers()).filter(x=>x.companyId===user.companyId&&x.status!=='disabled'&&x.dealerApproved===true).map(x=>({id:x.id,name:x.displayName}));
 const q=await searchParams,leads=(await readChunkedDataJson<any>('leads/leads.json',[])).filter(l=>leadDealerId(l)===user.companyId&&!l.archivedAt).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(l=>dealerLeadView(l,user.companyId!)).filter(Boolean);
 return <main className="dealer-workspace mx-auto max-w-5xl px-4 py-8"><DealerWorkspaceStyles/><Link href="/dealer-cabinet" className="underline">← Кабинет компании</Link><h1 className="my-6 text-3xl font-black">Заявки вашей компании</h1><p className="mb-5 text-sm text-[var(--ac-muted)]">Обращения с сайта сохраняются здесь независимо от подключения Telegram.</p>{leads.map((l:any)=><details key={l.id} open={q.id===l.id} className="mb-3 rounded-xl border border-[var(--ac-border)] p-4"><summary className="cursor-pointer font-bold">{l.open?l.name:'Контакт скрыт'} · {l.title}</summary><DealerLeadActions lead={l} managers={managers}/><div className="mt-4 space-y-2 text-sm"><p>{[l.phone,l.telegram,l.max].filter(Boolean).join(' · ')}</p><p>{l.city}</p><p className="whitespace-pre-wrap">{l.comment}</p><p className="text-[var(--ac-muted)]">{new Date(l.createdAt).toLocaleString('ru-RU',{timeZone:'Asia/Krasnoyarsk'})}</p>{(l.selectedOffers||[]).map((o:any)=><p key={o.id}>{o.title}{Number(o.totalRub)>0?` · ${Number(o.totalRub).toLocaleString('ru-RU')} ₽`:''}</p>)}</div></details>)}{!leads.length&&<p>Новых заявок пока нет.</p>}</main>;
}
