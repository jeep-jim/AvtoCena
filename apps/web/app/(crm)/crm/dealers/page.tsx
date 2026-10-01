import {getCurrentUser} from '@/lib/auth';
import {managesAllDealers} from '@/lib/dealers/access';
import {redirect} from 'next/navigation';
import {CrmShell} from '@/components/crm/CrmShell';
import {readDataJson,readChunkedDataJson} from '@/lib/data';
import {readPublicFeatures} from '@/lib/dealers/showcase-store';
import {readDealerProgram,readMembership} from '@/lib/dealers/program-store';
import {dealerAccessLevel} from '@/lib/dealers/program-model';
import {DealerPlatformManager} from '@/components/dealers/DealerPlatformManager';
export const dynamic='force-dynamic';
export default async function Page(){
 if(!managesAllDealers(await getCurrentUser()))redirect('/dealer-cabinet');
 const [stored,applications,program,features]=await Promise.all([readDataJson<any[]>('dealers/dealers.json',[]),readChunkedDataJson<any>('dealers/applications.json',[]),readDealerProgram(),readPublicFeatures()]);
 const dealers=await Promise.all((stored.length?stored:[{id:'dealer_topavto',name:'TopAvto',city:'Новокузнецк',status:'verified'}]).map(async d=>{const a=dealerAccessLevel(d.id,await readMembership(d.id));return {...d,accessLabel:a.level==='trial'?'Пробный доступ':a.level==='paid'?'Подписка активна':'Базовый доступ'};}));
 return <CrmShell title="Дилеры" subtitle="Управление компаниями и партнёрской программой" activeHref="/crm/dealers"><DealerPlatformManager dealers={dealers} applications={applications.sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt))} initialProgram={program} initialFeatures={features}/></CrmShell>;
}
