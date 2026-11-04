import {cabinetUser} from '@/lib/dealers/cabinet-user';
import {chatList} from '@/lib/crm-chat';
import {ChatWorkspace} from '@/components/crm/ChatWorkspace';
import {CrmPageHeading} from '@/components/crm/CrmWorkspaceFrame';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string>>}){const user=await cabinetUser(),q=await searchParams;return <section className="dealer-cabinet-content"><CrmPageHeading title="Чат" help="Клиенты и команда вашей компании."/><ChatWorkspace apiBase="/api/dealers" basePath="/dealer-cabinet/chat" initial={await chatList(user)} initialThread={q.thread||''}/></section>;}
