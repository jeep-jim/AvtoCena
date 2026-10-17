import {CrmShell} from "@/components/crm/CrmShell";
import {ActivityFeed} from "@/components/crm/ActivityFeed";
export const dynamic="force-dynamic";
export default function Page(){return <CrmShell activeHref="/crm/feed" title="Лента действий" subtitle="Кто, когда и что изменил. Время Новокузнецка."><div className="glass rounded-3xl p-4 md:p-6"><ActivityFeed/></div></CrmShell>;}
