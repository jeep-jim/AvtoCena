"use client";
import {CrmNavigationLinks} from '../crm/CrmNavigationLinks';
import {usePathname} from 'next/navigation';
const links:Array<readonly [string,string]>=[['/dealer-cabinet/overview','Обзор'],['/dealer-cabinet/leads','Заявки'],['/dealer-cabinet/documents','Клиенты'],['/dealer-cabinet/team','Сотрудники'],['/dealer-cabinet','Кабинет']];
export function DealerCabinetNavigation({newLeads=0}:{newLeads?:number}){
 const pathname=usePathname();
 const activeHref=['/dealer-cabinet/profile','/dealer-cabinet/terms','/dealer-cabinet/billing'].includes(pathname)?'/dealer-cabinet':pathname;
 return <CrmNavigationLinks label="Кабинет дилера" className="dealer-cabinet-navigation" links={links} activeHref={activeHref} counts={{'/dealer-cabinet/leads':newLeads}}><form action="/api/auth/logout" method="post" className="ml-auto"><button className="rounded-xl px-3 py-2 text-sm">Выйти</button></form></CrmNavigationLinks>;
}
