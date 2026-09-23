import {redirect} from 'next/navigation';
import {getCurrentUser,isAdminRole} from '@/lib/auth';
import {CrmShell} from '@/components/crm/CrmShell';
import {MetrikaSettings} from '@/components/crm/settings/MetrikaSettings';
import {metrikaStatus} from '@/lib/metrika-crm';
export const dynamic='force-dynamic';
export default async function Page(){const user=await getCurrentUser();if(!user||!isAdminRole(user.role))redirect('/crm');return <CrmShell activeHref="/crm/settings" title="Реклама и Метрика" subtitle="Передача качества заявок и договоров из CRM"><MetrikaSettings initial={await metrikaStatus()}/></CrmShell>;}
