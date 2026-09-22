import Link from "next/link";
export function JapanSectionTabs({active,params={}}:{active:"auction"|"green";params?:Record<string,string|undefined>}) {
 const target=(green:boolean)=>{const query=new URLSearchParams();for(const [key,value] of Object.entries(params))if(value&&!['page','stock','budget','budgetFrom','budgetTo','fobFrom','fobTo'].includes(key))query.set(key,value);query.set('market','japan');if(green)query.set('stock','green');return `${green?'/cars/green':'/cars'}?${query}`;};
 return <nav aria-label="Разделы Японии" className="ac-japan-sections my-5 grid grid-cols-2 gap-2.5 sm:max-w-lg text-sm font-bold">
  <Link href={target(false)} aria-current={active==="auction"?"page":undefined} className="ac-auction-button">Аукционная Япония</Link>
  <Link href={target(true)} aria-current={active==="green"?"page":undefined} className="ac-green-button">Зелёный угол</Link>
 </nav>;
}
