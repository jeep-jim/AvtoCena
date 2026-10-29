'use client';
import {useEffect,useRef,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {directoryLetter} from '@/lib/encyclopedia/query';
import {displayValue} from '@/lib/encyclopedia/schema';
export function DirectoryFilters({makes,years,fuels}:{makes:string[];years:number[];fuels:string[]}){
 const params=useSearchParams();
 const [q,setQ]=useState(params.get('q')||'');
 const timer=useRef<ReturnType<typeof setTimeout>>(),latest=useRef(params.toString());
 useEffect(()=>{latest.current=params.toString();setQ(params.get('q')||'');},[params]);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 const change=(key:string,value:string)=>{const next=new URLSearchParams(latest.current);next.delete('page');next.delete('market');if(key==='make')next.delete('letter');if(value)next.set(key,value);else next.delete(key);latest.current=next.toString();window.history.replaceState(null,'',`/cars/autocatalog${next.size?'?'+next:''}`);};
 return <section className="ac-ency-filters" aria-label="Фильтры энциклопедии" aria-busy={false}>
  <label>Марка<select value={params.get('make')||''} onChange={e=>change('make',e.target.value)}><option value="">Все марки</option>{makes.map(v=><option key={v}>{v}</option>)}</select></label>
  <label className="ac-ency-search">Поиск<input type="search" value={q} placeholder="Марка или модель" onChange={e=>{setQ(e.target.value);clearTimeout(timer.current);const value=e.target.value;timer.current=setTimeout(()=>change('q',value),350);}}/></label>
  <label>Год<select value={params.get('year')||''} onChange={e=>change('year',e.target.value)}><option value="">Все годы</option>{years.map(v=><option key={v}>{v}</option>)}</select></label>
  <label>Топливо<select value={params.get('fuel')||''} onChange={e=>change('fuel',e.target.value)}><option value="">Все виды</option>{fuels.map(v=><option key={v} value={v}>{displayValue(v)}</option>)}</select></label>
  <label className="ac-ency-check"><input type="checkbox" checked={params.has('missing30')} onChange={e=>change('missing30',e.target.checked?'1':'')}/>Без 30-мин. мощности</label>
  <button className="ac-ency-button" onClick={()=>{clearTimeout(timer.current);setQ('');latest.current='';window.history.replaceState(null,'','/cars/autocatalog');}}>Сбросить</button>
 </section>;
}

export function DirectoryAlphabet({makes}:{makes:string[]}){
 const params=useSearchParams();
 const letters=[...new Set(makes.map(directoryLetter))].filter(Boolean).sort((a,b)=>a.localeCompare(b,'ru',{numeric:true}));
 const select=(letter:string)=>{const next=new URLSearchParams(params);next.delete('page');next.delete('make');if(letter)next.set('letter',letter);else next.delete('letter');window.history.replaceState(null,'',`/cars/autocatalog${next.size?'?'+next:''}`);};
 return <nav className="ac-knowledge-alphabet" aria-label="Алфавит марок" aria-busy={false}><button aria-pressed={!params.get('letter')} onClick={()=>select('')}>Все</button>{letters.map(letter=><button key={letter} aria-pressed={params.get('letter')===letter} onClick={()=>select(letter)}>{letter}</button>)}</nav>;
}
