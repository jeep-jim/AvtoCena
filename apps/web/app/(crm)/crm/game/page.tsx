import {redirect} from 'next/navigation';
import {getCurrentUser,isCrmRole} from '@/lib/auth';
import {CrmShell} from '@/components/crm/CrmShell';
import {GamesHub} from '@/components/games/GamesHub';
export const dynamic='force-dynamic';
export default async function GamePage(){
 const user=await getCurrentUser();if(!user||!isCrmRole(user.role))redirect('/login');
 return <CrmShell title="Старт" subtitle="Погнали и Утильсбор — игры АвтоЦены." activeHref="/crm/game"><GamesHub user={{name:user.displayName,avatar:user.avatarUrl}} userId={user.id}/></CrmShell>;
}
