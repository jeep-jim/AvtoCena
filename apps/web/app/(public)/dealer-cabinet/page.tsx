import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {canManageDealer} from '@/lib/dealers/access';
import {readShowcase} from '@/lib/dealers/showcase-store';
import {readDealerProgram,readMembership} from '@/lib/dealers/program-store';
import {dealerAccessLevel} from '@/lib/dealers/program-model';
import {DealerWorkspace} from '@/components/dealers/DealerWorkspace';
import {CrmThemeToggle} from '@/components/crm/CrmThemeToggle';
export const dynamic='force-dynamic';
export default async function Page(){
 const user=await getCurrentUser();if(!user)redirect('/login?next=/dealer-cabinet');if(isPlatformOwner(user))redirect('/crm/dealers');
 const allowed=await canManageDealer(user,user.companyId||'');const s=allowed?await readShowcase(user.companyId!):null;
 const [program,membership]=await Promise.all([readDealerProgram(),s?readMembership(s.dealerId):Promise.resolve(null)]);
 return <main className="dealer-workspace min-h-screen bg-[var(--ac-bg)] text-[var(--ac-text)]"><header className="border-b border-[var(--ac-border)]"><div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-5 md:px-8"><Link href="/" className="font-black">АвтоЦена</Link><nav className="flex items-center gap-5"><span className="font-bold text-red-500">Дилер</span><Link className="text-sm" href="/cars">Каталог</Link><CrmThemeToggle/><form action="/api/auth/logout" method="post"><button className="text-sm">Выйти</button></form></nav></div></header><div className="mx-auto max-w-[1500px] px-4 py-8 md:px-8"><h1 className="mb-6 text-3xl font-black">{s?s.name:'Доступ к кабинету'}</h1>{s&&membership?<DealerWorkspace initial={s} features={{version:0,affiliatesEnabled:false}} program={program} membership={membership} fullAccess={dealerAccessLevel(s.dealerId,membership).full}/>:<p>Кабинет станет доступен после подтверждения компании и вашего доступа командой АвтоЦены.</p>}</div></main>;
}
