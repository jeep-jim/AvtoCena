import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformTeam,isPlatformOwner} from '@/lib/platform-access';
import {CrmShell} from '@/components/crm/CrmShell';
import {TeamIdeas} from '@/components/crm/TeamIdeas';
export const dynamic='force-dynamic';
export default async function Page(){const user=await getCurrentUser();if(!user||!isPlatformTeam(user))redirect('/login');return <CrmShell title="Идеи и правки" subtitle="Предлагайте улучшения, голосуйте и следите за готовностью. Раздел доступен только команде Top Avto." activeHref="/crm/ideas"><TeamIdeas owner={isPlatformOwner(user)}/></CrmShell>;}
