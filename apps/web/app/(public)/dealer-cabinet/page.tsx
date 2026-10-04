import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {canManageDealer} from '@/lib/dealers/access';
import {readShowcase,findDealer} from '@/lib/dealers/showcase-store';
import {readDealerProgram,readMembership,startDealerTrial} from '@/lib/dealers/program-store';
import {dealerAccessLevel} from '@/lib/dealers/program-model';
import {DealerWorkspace} from '@/components/dealers/DealerWorkspace';
import {CrmThemeToggle} from '@/components/crm/CrmThemeToggle';
export const dynamic='force-dynamic';
export default async function Page(){
 const user=await getCurrentUser();if(!user)redirect('/login?next=/dealer-cabinet');if(isPlatformOwner(user))redirect('/crm/dealers');
 const allowed=await canManageDealer(user,user.companyId||'');const s=allowed?await readShowcase(user.companyId!):null;
 if(s&&s.dealerId!=='dealer_topavto'){const current=await readMembership(s.dealerId);if(!current.trialStartedAt&&!current.history.length)await startDealerTrial(s.dealerId);}
 const [program,membership]=await Promise.all([readDealerProgram(),s?readMembership(s.dealerId):Promise.resolve(null)]);
 return <main className="dealer-workspace min-h-screen bg-[var(--ac-bg)] text-[var(--ac-text)]"><header className="border-b border-[var(--ac-border)]"><div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-5 md:px-8"><Link href="/" className="font-black">АвтоЦена</Link><nav className="flex items-center gap-5 overflow-x-auto whitespace-nowrap"><span className="font-bold text-red-500">Дилер</span><Link className="text-sm" href="/dealer-cabinet/leads">Заявки</Link><Link className="text-sm" href="/dealer-cabinet/documents">Клиенты и документы</Link><Link className="text-sm" href="/cars">Каталог</Link><CrmThemeToggle/><form action="/api/auth/logout" method="post"><button className="text-sm">Выйти</button></form></nav></div></header><div className="mx-auto max-w-[1500px] px-4 py-8 md:px-8"><h1 className="mb-6 text-3xl font-black">{s?s.name:'Доступ к кабинету'}</h1>{s&&membership?<DealerWorkspace verified={(await findDealer(s.dealerId))?.status==='verified'} initial={s} features={{version:0,affiliatesEnabled:false}} program={program} membership={membership} fullAccess={dealerAccessLevel(s.dealerId,membership).full}/>:<p>Кабинет станет доступен после подтверждения компании и вашего доступа командой АвтоЦены.</p>}</div></main>;
}
