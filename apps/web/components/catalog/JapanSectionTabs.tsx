import {DealerLink as Link} from '@/components/dealers/DealerBrowsingContext';
export function JapanSectionTabs({active,params={}}: {active:"all"|"auction"|"green";params?:Record<string,string|undefined>}) {
 const query=new URLSearchParams(Object.entries(params).filter(([k,v])=>!!v&&!['market','stock','page'].includes(k)) as [string,string][]);
 return <nav aria-label="Автомобили из Японии" className="mb-5 flex flex-wrap gap-2 text-sm font-black"><Link href={`/cars?market=japan${query.size?'&'+query:''}`} aria-current={active!=='green'?'page':undefined} className="ac-market-all-link rounded-xl px-4 py-3" style={active!=='green'?{background:'#ff353d',color:'#fff'}:undefined}>Аукционы Японии</Link><Link href={`/cars/green${query.size?'?'+query:''}`} aria-current={active==='green'?'page':undefined} className="ac-market-all-link ac-green-button rounded-xl px-4 py-3" style={active==='green'?{background:'#1db65d',color:'#fff'}:undefined}>Зелёный угол · в наличии</Link></nav>;
}
