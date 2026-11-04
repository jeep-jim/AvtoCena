import {cabinetUser} from '@/lib/dealers/cabinet-user';
import {readCrmUsers} from '@/lib/crm-users';
import {isDealerTeamOwner} from '@/lib/dealers/team';
import {DealerTeam} from '@/components/dealers/DealerTeam';
export const dynamic='force-dynamic';
export default async function Page(){const user=await cabinetUser(),users=(await readCrmUsers()).filter(u=>u.companyId===user.companyId).map(u=>({id:u.id,name:u.displayName,login:u.telegramUsername,owner:u.dealerTeamRole==='owner',disabled:u.status==='disabled',approved:u.dealerApproved===true}));return <main className="dealer-cabinet-content"><h1 className="dealer-cabinet-title">Сотрудники</h1><DealerTeam users={users} owner={isDealerTeamOwner(user)} self={user.id}/></main>;}
