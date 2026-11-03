"use client";
import Link from 'next/link';
import {usePathname} from 'next/navigation';
const links=[['/dealer-cabinet','Компания'],['/dealer-cabinet/leads','Заявки'],['/dealer-cabinet/documents','Клиенты и документы'],['/dealer-cabinet/terms','Тариф и документы'],['/dealer-cabinet/billing','Взаиморасчёты']];
export function DealerCabinetNavigation(){
 const pathname=usePathname();
 return <nav aria-label="Кабинет дилера" className="dealer-cabinet-navigation">{links.map(([href,label])=><Link key={href} href={href} aria-current={pathname===href?'page':undefined} >{label}</Link>)}<form action="/api/auth/logout" method="post" className="ml-auto"><button className="rounded-xl px-3 py-2 text-sm">Выйти</button></form></nav>;
}
