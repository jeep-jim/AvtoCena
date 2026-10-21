import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformTeam} from '@/lib/platform-access';
import {readCrmUsers} from '@/lib/crm-users';
import {readReminders} from '@/lib/crm-reminders';
import {CrmShell} from '@/components/crm/CrmShell';
import {TasksWorkspace} from '@/components/crm/TasksWorkspace';
export const dynamic='force-dynamic';
export default async function TasksPage(){const user=await getCurrentUser();if(!isPlatformTeam(user))redirect('/login');const [rows,users]=await Promise.all([readReminders(user!),readCrmUsers()]);return <CrmShell activeHref="/crm/tasks" title="Задачи и напоминания" subtitle="План работы команды · время Новокузнецка"><TasksWorkspace initialRows={rows} userId={user!.id} people={users.filter(u=>isPlatformTeam(u)).map(u=>({id:u.id,name:u.displayName}))}/></CrmShell>;}
