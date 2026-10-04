import {redirect} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformTeam} from '@/lib/platform-access';
import {chatList} from '@/lib/crm-chat';
import {CrmShell} from '@/components/crm/CrmShell';
import {ChatWorkspace} from '@/components/crm/ChatWorkspace';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string>>}){const user=await getCurrentUser();if(!user)redirect('/login');if(!isPlatformTeam(user))redirect('/dealer-cabinet');const q=await searchParams;return <CrmShell activeHref="/crm/chat" title="Чат" subtitle="Клиенты, команда и уведомления в одном месте."><ChatWorkspace initial={await chatList(user)} initialThread={q.thread||''}/></CrmShell>;}
