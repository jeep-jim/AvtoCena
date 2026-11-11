import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {notFound} from 'next/navigation';
import {CrmShell} from '@/components/crm/CrmShell';
import {AutobotSettings} from '@/components/autobot/AutobotSettings';
export default async function Page(){if(!isPlatformOwner(await getCurrentUser()))notFound();return <CrmShell title="АвтоБот" subtitle="Модель и расходы помощника" activeHref="/crm/site"><AutobotSettings/></CrmShell>;}
