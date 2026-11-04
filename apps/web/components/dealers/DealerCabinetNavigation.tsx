"use client";
import Link from 'next/link';
import {usePathname} from 'next/navigation';
const links=[['/dealer-cabinet/overview','Обзор'],['/dealer-cabinet/leads','Заявки'],['/dealer-cabinet/documents','Клиенты'],['/dealer-cabinet/team','Сотрудники'],['/dealer-cabinet','Кабинет']];
export function DealerCabinetNavigation({newLeads=0}:{newLeads?:number}){
 const pathname=usePathname();
 return <nav aria-label="Кабинет дилера" className="dealer-cabinet-navigation">{links.map(([href,label])=><Link key={href} href={href} aria-current={(pathname===href||(href==='/dealer-cabinet'&&['/dealer-cabinet/profile','/dealer-cabinet/terms','/dealer-cabinet/billing'].includes(pathname)))?'page':undefined} >{label}{href==='/dealer-cabinet/leads'&&newLeads>0&&<span className="ml-2 rounded-full bg-red-500 px-2 text-xs text-white">{newLeads}</span>}</Link>)}<form action="/api/auth/logout" method="post" className="ml-auto"><button className="rounded-xl px-3 py-2 text-sm">Выйти</button></form></nav>;
}
