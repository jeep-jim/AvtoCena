import {redirect} from 'next/navigation';
import {getCurrentUser,isCrmRole} from '@/lib/auth';
import {CrmShell} from '@/components/crm/CrmShell';
import {PognaliArena} from '@/components/crm/PognaliArena';
export const dynamic='force-dynamic';
export default async function GamePage(){
 const user=await getCurrentUser();if(!user||!isCrmRole(user.role))redirect('/login');
 return <CrmShell title="Погнали!" subtitle="Холмы и боевые заезды. Общий рейтинг всех игроков." activeHref="/crm/game"><PognaliArena user={{name:user.displayName,avatar:user.avatarUrl}} userId={user.id}/></CrmShell>;
}
