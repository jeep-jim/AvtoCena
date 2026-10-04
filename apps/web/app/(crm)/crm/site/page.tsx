import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {readPublicFeatures} from '@/lib/dealers/showcase-store';
import {CrmShell} from '@/components/crm/CrmShell';
import {SiteControls} from '@/components/site/SiteControls';
export const dynamic='force-dynamic';
export default async function Page(){if(!isPlatformOwner(await getCurrentUser()))redirect('/crm');return <CrmShell title="Управление сайтом" subtitle="Страницы, блоки и видимость на устройствах." activeHref="/crm/site"><SiteControls initial={await readPublicFeatures()}/></CrmShell>;}
