"use client";
import {CrmNavigationLinks} from '../crm/CrmNavigationLinks';
import {usePathname} from 'next/navigation';
const links:Array<readonly [string,string]>=[['/dealer-cabinet/overview','Обзор'],['/dealer-cabinet/chat','Чат'],['/dealer-cabinet/leads','Заявки'],['/dealer-cabinet/documents','Клиенты'],['/dealer-cabinet/team','Сотрудники'],['/dealer-cabinet','Кабинет']];
export function DealerCabinetNavigation({newLeads=0}:{newLeads?:number}){
 const currentPath=usePathname(),prefix=currentPath.match(/^\/dealer-cabinet\/company\/[^/]+/)?.[0]||'/dealer-cabinet',pathname=currentPath.replace(/^\/dealer-cabinet\/company\/[^/]+/,'/dealer-cabinet');
 const activeHref=['/dealer-cabinet/profile','/dealer-cabinet/terms','/dealer-cabinet/billing'].includes(pathname)?'/dealer-cabinet':pathname;
 return <CrmNavigationLinks label="Кабинет дилера" className="dealer-cabinet-navigation" links={links.map(([href,label])=>[href.replace('/dealer-cabinet',prefix),label] as const)} activeHref={activeHref.replace('/dealer-cabinet',prefix)} counts={{[prefix+'/leads']:newLeads}}><form action="/api/auth/logout" method="post" className="ml-auto"><button className="rounded-xl px-3 py-2 text-sm">Выйти</button></form></CrmNavigationLinks>;
}
