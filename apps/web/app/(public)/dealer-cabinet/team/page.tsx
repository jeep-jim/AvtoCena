import {cabinetUser} from '@/lib/dealers/cabinet-user';
import {readCrmUsers} from '@/lib/crm-users';
import {isDealerTeamOwner} from '@/lib/dealers/team';
import {DealerTeam} from '@/components/dealers/DealerTeam';
import {CrmPageHeading} from '@/components/crm/CrmWorkspaceFrame';
import {readChunkedDataJson} from '@/lib/data';
import {leadDealerId} from '@/lib/dealers/lead-routing';
import {workspaceClientsPath,canAccessDocumentClient} from '@/lib/document-workspace';
import {readyDealerClients} from '@/lib/dealers/client-workflow';
export const dynamic='force-dynamic';
export default async function Page(){
 const user=await cabinetUser();
 const [staff,allLeads,storedClients]=await Promise.all([readCrmUsers(),readChunkedDataJson<any>('leads/leads.json',[]),readChunkedDataJson<any>(workspaceClientsPath(user),[])]);
 const leads=allLeads.filter(l=>leadDealerId(l)===user.companyId&&!l.archivedAt),clients=await readyDealerClients(user,storedClients.filter(c=>canAccessDocumentClient(user,c)));
 const users=staff.filter(u=>u.companyId===user.companyId).map(u=>({id:u.id,name:u.displayName,login:u.telegramUsername,avatar:u.avatarUrl,owner:u.dealerTeamRole==='owner',disabled:u.status==='disabled',approved:u.dealerApproved===true,leads:leads.filter(l=>l.assignedManagerId===u.id).length,clients:clients.filter(c=>c.assignedManagerId===u.id).length}));
 return <section className="dealer-cabinet-content"><CrmPageHeading title="Сотрудники" help="Команда вашей компании и доступ сотрудников."/><DealerTeam users={users} owner={isDealerTeamOwner(user)} self={user.id}/></section>;
}
