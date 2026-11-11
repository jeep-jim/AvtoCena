import {CrmPageHeading} from '@/components/crm/CrmWorkspaceFrame';
import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {canManageDealer} from '@/lib/dealers/access';
import {readShowcase,findDealer} from '@/lib/dealers/showcase-store';
import {readDealerProgram,readMembership,startDealerTrial} from '@/lib/dealers/program-store';
import {dealerAccessLevel} from '@/lib/dealers/program-model';
import {DealerWorkspace} from '@/components/dealers/DealerWorkspace';
export const dynamic='force-dynamic';
export default async function Page(){
 const user=await getCurrentUser();if(!user)redirect('/login?next=/dealer-cabinet');if(isPlatformOwner(user))redirect('/crm/dealers');
 const allowed=await canManageDealer(user,user.companyId||'');const s=allowed?await readShowcase(user.companyId!):null;
 if(s&&s.dealerId!=='dealer_topavto'){const current=await readMembership(s.dealerId);if(!current.trialStartedAt&&!current.history.length)await startDealerTrial(s.dealerId);}
 const [program,membership]=await Promise.all([readDealerProgram(),s?readMembership(s.dealerId):Promise.resolve(null)]);
 return <section className="dealer-workspace dealer-cabinet-content"><CrmPageHeading title={s?s.name:'Доступ к кабинету'}/>{s&&membership?<DealerWorkspace verified={(await findDealer(s.dealerId))?.status==='verified'} initial={s} features={{version:0,affiliatesEnabled:false}} program={program} membership={membership} fullAccess={dealerAccessLevel(s.dealerId,membership).full}/>:<p>Кабинет станет доступен после подтверждения компании и вашего доступа командой АвтоЦены.</p>}</section>;
}
