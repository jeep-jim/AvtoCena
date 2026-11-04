import {headers} from 'next/headers';
import {notFound} from 'next/navigation';
import {findDealer} from '@/lib/dealers/showcase-store';
import './cabinet.css';
import {redirect} from 'next/navigation';
import {isPlatformTeam,isPlatformOwner} from '@/lib/platform-access';
import '../../flat-ui.css';
import '../../(crm)/crm-responsive.css';
import {CrmWorkspaceFrame} from '@/components/crm/CrmWorkspaceFrame';
import {CrmThemeToggle} from '@/components/crm/CrmThemeToggle';
import {DealerAccountMenu} from '@/components/dealers/DealerAccountMenu';
import {DealerCabinetNavigation} from '@/components/dealers/DealerCabinetNavigation';
import {getCurrentUser} from '@/lib/auth';
import {canManageDealer} from '@/lib/dealers/access';
import {readChunkedDataJson} from '@/lib/data';
import {leadDealerId} from '@/lib/dealers/lead-routing';
export default async function DealerCabinetLayout({children}:{children:React.ReactNode}){
 const user=await getCurrentUser();
 if(isPlatformTeam(user))redirect(isPlatformOwner(user)?'/crm/dealers':'/crm/company');
 const requested=(await headers()).get('x-dealer-workspace');
 if(requested&&requested!==user?.companyId)notFound();
 const company=user?.companyId?await findDealer(user.companyId):null;
 const allowed=!!user?.companyId&&await canManageDealer(user,user.companyId);
 const newLeads=allowed?(await readChunkedDataJson<any>('leads/leads.json',[])).filter(l=>leadDealerId(l)===user!.companyId&&!l.archivedAt&&!l.assignedManagerId).length:0;
 return <CrmWorkspaceFrame actions={<><CrmThemeToggle/>{user&&<DealerAccountMenu user={{...user,avatarUrl:user.avatarUrl||undefined,companyId:user.companyId||undefined}} newLeads={newLeads}/>}</>} navigation={<DealerCabinetNavigation newLeads={newLeads}/>}>{company&&<div className="dealer-cabinet-content mb-4 text-sm font-bold" aria-label="Текущая компания">{company.name}</div>}{children}</CrmWorkspaceFrame>;
}
