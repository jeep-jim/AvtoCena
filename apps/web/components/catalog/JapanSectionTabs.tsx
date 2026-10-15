import {DealerLink as Link} from '@/components/dealers/DealerBrowsingContext';
export function JapanSectionTabs({active}: {active:"all"|"auction"|"green";params?:Record<string,string|undefined>}) {
 return <nav aria-label="Автомобили из Японии" className="my-4 flex flex-wrap gap-4 text-sm"><Link href="/cars?market=japan" aria-current={active==='auction'?'page':undefined} className="underline">Аукционы Японии</Link><Link href="/cars/green" aria-current={active==='green'?'page':undefined} className="underline">Зелёный угол · в наличии</Link></nav>;
}
