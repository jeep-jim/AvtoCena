import Link from 'next/link';
import {isPlatformTeam} from '@/lib/platform-access';
import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {canManageDealer} from '@/lib/dealers/access';
import {readShowcase} from '@/lib/dealers/showcase-store';
import {DealerEditor} from '@/components/dealers/DealerEditor';
export const dynamic='force-dynamic';
export default async function DealerCabinet(){
 const user=await getCurrentUser();if(!user)redirect('/login?next=/dealer-cabinet');
 if(isPlatformTeam(user))redirect('/api/auth/refresh-team-session');
 const allowed=await canManageDealer(user,user.companyId||'');
 const s=allowed?await readShowcase(user.companyId!):null;
 return <main className="min-h-screen bg-[var(--ac-bg)] text-[var(--ac-text)]"><header className="border-b border-[var(--ac-border)]"><div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-5 md:px-8"><Link href="/" className="font-black">АвтоЦена</Link><span className="text-sm">Кабинет дилера</span><form action="/api/auth/logout" method="post"><button className="text-sm">Выйти</button></form></div></header><div className="mx-auto max-w-[1500px] px-4 py-8 md:px-8"><h1 className="mb-2 text-3xl font-black">{s?s.name:'Доступ к кабинету'}</h1><p className="mb-6 text-sm text-[var(--ac-muted)]">{s?'Профиль вашей компании, офисы, фотографии и автомобили.':'Кабинет станет доступен после подтверждения компании и вашего доступа командой АвтоЦены.'}</p>{s&&<DealerEditor initial={s} features={{version:0,affiliatesEnabled:false}} platformOwner={false}/>}</div></main>;
}
