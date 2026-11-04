import './cabinet.css';
import Link from 'next/link';
import {PublicHeader} from '@/components/layout/PublicHeader';
import {DealerCabinetNavigation} from '@/components/dealers/DealerCabinetNavigation';
import {getCurrentUser} from '@/lib/auth';
import {canManageDealer} from '@/lib/dealers/access';
import {readChunkedDataJson} from '@/lib/data';
import {leadDealerId} from '@/lib/dealers/lead-routing';
export default async function DealerCabinetLayout({children}:{children:React.ReactNode}){
 const user=await getCurrentUser();
 const allowed=!!user?.companyId&&await canManageDealer(user,user.companyId);
 const newLeads=allowed?(await readChunkedDataJson<any>('leads/leads.json',[])).filter(l=>leadDealerId(l)===user!.companyId&&!l.archivedAt&&!l.assignedManagerId).length:0;
 return <div className="dealer-cabinet-shell min-h-screen bg-[var(--ac-page-bg)] text-[var(--ac-text)]"><div className="ac-page-copy"><PublicHeader backHref="/cars"/></div><DealerCabinetNavigation newLeads={newLeads}/>{allowed&&<div className="dealer-cabinet-account"><Link className="inline-flex items-center gap-2" href="/dealer-cabinet/profile">{user?.avatarUrl&&<img src={user.avatarUrl} alt="" width={32} height={32} className="h-8 w-8 rounded-full object-cover"/>}{user?.displayName} · Мой профиль</Link></div>}{children}</div>;
}
