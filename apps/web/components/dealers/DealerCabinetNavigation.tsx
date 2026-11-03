"use client";
import Link from 'next/link';
import {usePathname} from 'next/navigation';
const links=[['/dealer-cabinet','Компания'],['/dealer-cabinet/leads','Заявки'],['/dealer-cabinet/documents','Клиенты и документы'],['/dealer-cabinet/terms','Тариф и документы'],['/dealer-cabinet/billing','Взаиморасчёты']];
export function DealerCabinetNavigation(){
 const pathname=usePathname();
 return <nav aria-label="Кабинет дилера" className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-2 border-b border-[var(--ac-border)] px-4 py-3 md:px-8">{links.map(([href,label])=><Link key={href} href={href} aria-current={pathname===href?'page':undefined} className={`rounded-xl px-3 py-2 text-sm font-bold ${pathname===href?'bg-red-500/10 text-[#ff353d]':'text-[var(--ac-text)]'}`}>{label}</Link>)}<form action="/api/auth/logout" method="post" className="ml-auto"><button className="rounded-xl px-3 py-2 text-sm">Выйти</button></form></nav>;
}
