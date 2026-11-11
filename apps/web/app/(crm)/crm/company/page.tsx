import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformTeam} from '@/lib/platform-access';
import {canManageDealer} from '@/lib/dealers/access';
import {readShowcase,findDealer} from '@/lib/dealers/showcase-store';
import {CrmShell} from '@/components/crm/CrmShell';
import {DealerWorkspace} from '@/components/dealers/DealerWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){
 const user=await getCurrentUser();
 if(!user)redirect('/login');
 if(!isPlatformTeam(user))redirect('/dealer-cabinet');
 if(!await canManageDealer(user,'dealer_topavto'))redirect('/crm');
 const [showcase,dealer]=await Promise.all([readShowcase('dealer_topavto'),findDealer('dealer_topavto')]);
 return <CrmShell activeHref="/crm/company" title={showcase.name} subtitle="Страница и автомобили вашей компании"><DealerWorkspace initial={showcase} verified={dealer?.status==='verified'} features={{version:0,affiliatesEnabled:false}} fullAccess/></CrmShell>;
}
