import Link from "next/link";
export function JapanSectionTabs({active,params={}}:{active:"all"|"auction"|"green";params?:Record<string,string|undefined>}) {
 const target=(section:"all"|"auction"|"green")=>{const query=new URLSearchParams();for(const [key,value] of Object.entries(params))if(value&&!['page','stock','budget','budgetFrom','budgetTo','fobFrom','fobTo'].includes(key)&&!(section==='green'&&key==='auctionGrade'))query.set(key,value);query.set('market','japan');query.set('stock',section);return `${section==='green'?'/cars/green':'/cars'}?${query}`;};
 return <nav aria-label="Разделы Японии" className="ac-japan-sections my-5 grid grid-cols-3 gap-2 sm:max-w-lg text-sm font-bold">
  <Link href={target('all')} aria-current={active==="all"?"page":undefined} className="ac-japan-tab ac-japan-tab-all">Все</Link>
  <Link href={target('auction')} aria-current={active==="auction"?"page":undefined} className="ac-japan-tab ac-japan-tab-auction">Аукционы</Link>
  <Link href={target('green')} aria-current={active==="green"?"page":undefined} className="ac-japan-tab ac-japan-tab-green">В наличии</Link>
 </nav>;
}
