import Link from 'next/link';
import {notFound} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {managesAllDealers} from '@/lib/dealers/access';
import {readShowcase,readPublicFeatures,findDealer,validDealerId} from '@/lib/dealers/showcase-store';
import {readDealerProgram,readMembership} from '@/lib/dealers/program-store';
import {readDataJson,readChunkedDataJson} from '@/lib/data';
import {CrmShell} from '@/components/crm/CrmShell';
import {DealerWorkspace} from '@/components/dealers/DealerWorkspace';
import {DealerCompanyControls} from '@/components/dealers/DealerCompanyControls';
export const dynamic='force-dynamic';
export default async function Page({params}:{params:Promise<{id:string}>}){
 if(!managesAllDealers(await getCurrentUser()))notFound();const {id}=await params;if(!validDealerId(id))notFound();
 const [s,dealer,features,program,membership,sales,leads]=await Promise.all([readShowcase(id),findDealer(id),readPublicFeatures(),readDealerProgram(),readMembership(id),readDataJson<any[]>('dealers/sales.json',[]),readChunkedDataJson<any>('leads/leads.json',[])]);if(!s||!dealer)notFound();
 return <CrmShell activeHref="/crm/dealers" title={s.name} subtitle="Кабинет компании"><Link className="dealer-back-to-companies inline-block mb-5 text-sm text-[var(--ac-muted)]" href="/crm/dealers">← Все компании</Link><DealerWorkspace initial={s} features={features} owner program={program} membership={membership} administration={<DealerCompanyControls dealer={dealer} initialMembership={membership} program={program} initialSales={sales.filter(r=>r.dealerId===id)} completedLeads={leads.filter(l=>!l.archivedAt&&l.status==='completed'&&(l.requestedDealerId===id||l.dealerId===id)).map(l=>({id:l.id,label:[l.name||l.clientName||'Сделка',l.carModel||l.model||'',l.createdAt?new Date(l.createdAt).toLocaleDateString('ru-RU'):''].filter(Boolean).join(' · ')}))}/>}/></CrmShell>;
}
