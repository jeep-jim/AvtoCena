import {pendingDealerApprovals} from '@/lib/dealers/pending-approvals';
import Link from 'next/link';
import {getCurrentUser} from '@/lib/auth';
import {managesAllDealers} from '@/lib/dealers/access';
import {redirect} from 'next/navigation';
import {CrmShell} from '@/components/crm/CrmShell';
import {readDataJson,readChunkedDataJson} from '@/lib/data';
import {readPublicFeatures,readShowcase} from '@/lib/dealers/showcase-store';
import {readDealerProgram,readMembership} from '@/lib/dealers/program-store';
import {dealerAccessLevel} from '@/lib/dealers/program-model';
import {DealerPlatformManager} from '@/components/dealers/DealerPlatformManager';
export const dynamic='force-dynamic';
export default async function Page(){
 const user=await getCurrentUser();if(!managesAllDealers(user))redirect('/dealer-cabinet');
 const pending=await pendingDealerApprovals(user!);
 const [stored,applications,program,features]=await Promise.all([readDataJson<any[]>('dealers/dealers.json',[]),readChunkedDataJson<any>('dealers/applications.json',[]),readDealerProgram(),readPublicFeatures()]);
 const dealers=await Promise.all((stored.length?stored:[{id:'dealer_topavto',name:'TopAvto',city:'Новокузнецк',status:'verified'}]).map(async d=>{const [m,s]=await Promise.all([readMembership(d.id),readShowcase(d.id)]);const a=dealerAccessLevel(d.id,m);return {...d,name:s?.name||d.name,city:s?.offices[0]?.city||d.city,accessLabel:a.level==='trial'?'Пробный доступ':a.level==='paid'?'Подписка активна':'Базовый доступ'};}));
 return <CrmShell title="Дилеры" subtitle="Управление компаниями и партнёрской программой" activeHref="/crm/dealers"><section className="mb-5" aria-label="Ожидающие подключения">{pending.length>0&&<><h2 className="mb-3 text-xl font-bold">Ожидают подтверждения · {pending.length}</h2><div className="flex flex-col gap-3">{pending.map(d=><Link key={d.id} href={d.href} className="rounded-xl border border-red-400 p-4"><strong>{d.name}</strong><p>{d.text}</p><span className="underline">Проверить и подтвердить →</span></Link>)}</div></>}</section><DealerPlatformManager dealers={dealers} applications={applications.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))} initialProgram={program} initialFeatures={features}/></CrmShell>;
}
