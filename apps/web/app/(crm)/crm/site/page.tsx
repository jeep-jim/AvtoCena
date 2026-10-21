import {ServerResources} from '@/components/site/ServerResources';
import Link from 'next/link';
import {hasCrmPermission} from '@/lib/crm-permissions';
import {isPlatformTeam} from '@/lib/platform-access';
import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {readPublicFeatures} from '@/lib/dealers/showcase-store';
import {CrmShell} from '@/components/crm/CrmShell';
import {SiteControls} from '@/components/site/SiteControls';
import {CollectionControls} from '@/components/site/CollectionControls';
export const dynamic='force-dynamic';
export default async function Page(){const user=await getCurrentUser();if(!isPlatformTeam(user)||!hasCrmPermission(user,'site'))redirect('/crm');return <CrmShell title="Управление сайтом" subtitle="Страницы, блоки и видимость на устройствах." activeHref="/crm/site"><>{isPlatformOwner(user)&&<ServerResources/>}{isPlatformOwner(user)&&<details className="mb-5 border-b border-[var(--ac-border)] pb-4"><summary className="cursor-pointer font-bold">Настройки владельца</summary><Link href="/crm/settings/metrika" className="mt-3 inline-block underline">Реклама и Метрика</Link><br/><Link href="/crm/site/autobot" className="mt-3 inline-block underline">АвтоБот — подключение и расходы</Link></details>}<>{isPlatformOwner(user)&&<CollectionControls/>}</><SiteControls initial={await readPublicFeatures()}/></></CrmShell>;}
