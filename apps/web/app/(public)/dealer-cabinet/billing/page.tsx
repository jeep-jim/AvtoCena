import Link from 'next/link';
import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {billingDealer} from '@/lib/dealers/billing/access';
import {isPlatformOwner} from '@/lib/platform-access';
import {DealerBilling} from '@/components/dealers/DealerBilling';
export const dynamic='force-dynamic';
export const metadata={title:'Взаиморасчёты — АвтоЦена',robots:{index:false,follow:false}};
export default async function Page(){const u=await getCurrentUser();if(!u)redirect('/login?next=/dealer-cabinet/billing');if(isPlatformOwner(u))redirect('/crm/dealer-billing');let id='';try{id=await billingDealer(u);}catch{redirect('/dealer-cabinet');}return <main className="mx-auto max-w-7xl px-4 py-6"><Link href="/dealer-cabinet">← Кабинет дилера</Link><DealerBilling initialDealer={id}/></main>;}
