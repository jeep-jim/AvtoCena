import {redirect} from 'next/navigation';
import {currentAccount,publicAccount} from '@/lib/account/auth';
import {getCurrentUser} from '@/lib/auth';
import {PublicHeader} from '@/components/layout/PublicHeader';
import {CustomerPortal} from '@/components/account/CustomerPortal';
export const dynamic='force-dynamic';
export const metadata={title:'Личный кабинет — АвтоЦена',robots:{index:false,follow:false},referrer:'no-referrer' as const};
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const a=await currentAccount();const p=await searchParams;const invite=typeof p.invite==='string'?p.invite:'';if(!a){const staff=await getCurrentUser();if(staff&&!invite)redirect(staff.role==='dealer'?'/dealer-cabinet':'/crm');redirect('/login?next='+encodeURIComponent('/account'+(invite?'?invite='+encodeURIComponent(invite):'')));}return <main className="account-cabinet-page min-h-screen"><PublicHeader backHref="/"/><div className="account-cabinet-content"><CustomerPortal account={publicAccount(a)}/></div></main>;}
