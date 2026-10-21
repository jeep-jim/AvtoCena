import {DealerLink as Link} from '@/components/dealers/DealerBrowsingContext';
export function FeedSourceTabs({market,active}:{market:string;active:'ajes'|'existing'}){
 if(market!=='china'&&market!=='korea')return null;
 return <nav aria-label="Источник автомобилей" className="mb-5 flex flex-wrap gap-2">{[['existing','Основной каталог'],['ajes','AJ System']].map(([source,label])=><Link key={source} href={`/cars?market=${market}&source=${source}`} aria-current={active===source?'page':undefined} className={`rounded-full border px-4 py-2 text-sm font-bold ${active===source?'border-[var(--ac-text)] bg-[var(--ac-surface)] text-[var(--ac-text)]':'border-[var(--ac-border)] text-[var(--ac-muted)]'}`}>{label}</Link>)}</nav>;
}
