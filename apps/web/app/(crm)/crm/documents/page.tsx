import {readCrmUsers} from '@/lib/crm-users';
import {redirect} from 'next/navigation';
import {CrmShell} from '@/components/crm/CrmShell';
import {ContractWorkspace} from '@/components/crm/contracts/ContractWorkspace';
import {getCurrentUser,isCrmRole} from '@/lib/auth';
import {canSeeLead} from '@/lib/crm-visibility';
import {readChunkedDataJson} from '@/lib/data';
export const dynamic='force-dynamic';
export default async function DocumentsPage(){const user=await getCurrentUser();if(!user||!isCrmRole(user.role)||user.status==='disabled')redirect('/login');const managers=(await readCrmUsers()).filter(m=>['owner','admin','manager'].includes(m.role)).map(m=>({id:m.id,name:m.displayName,avatar:m.avatarUrl||''}));const clients=(await readChunkedDataJson<any>('clients/clients.json',[])).filter(c=>canSeeLead(user,c)).map(c=>({id:c.id,name:c.fio||c.phone||'Клиент',phone:c.phone||'',city:c.city||''}));return <CrmShell title="Документы" subtitle="Два шаблона договоров, заполнение данных клиента и автомобиля, PDF и готовые версии." activeHref="/crm/documents"><ContractWorkspace owner={user.role==='owner'} clients={clients} managers={managers}/></CrmShell>;}
