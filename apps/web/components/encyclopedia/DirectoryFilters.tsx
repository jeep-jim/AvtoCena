'use client';
import {useEffect,useRef,useState,useTransition} from 'react';
import {useRouter,useSearchParams} from 'next/navigation';
import {displayValue} from '@/lib/encyclopedia/schema';
export function DirectoryFilters({makes,years,fuels}:{makes:string[];years:number[];fuels:string[]}){
 const router=useRouter(),params=useSearchParams(),[pending,start]=useTransition();
 const [q,setQ]=useState(params.get('q')||'');
 const timer=useRef<ReturnType<typeof setTimeout>>(),latest=useRef(params.toString());
 useEffect(()=>{latest.current=params.toString();setQ(params.get('q')||'');},[params]);
 useEffect(()=>()=>clearTimeout(timer.current),[]);
 const change=(key:string,value:string)=>{const next=new URLSearchParams(latest.current);next.delete('page');next.delete('market');if(value)next.set(key,value);else next.delete(key);latest.current=next.toString();start(()=>router.replace(`/cars/autocatalog${next.size?'?'+next:''}`,{scroll:false}));};
 return <section className="ac-ency-filters" aria-label="Фильтры энциклопедии" aria-busy={pending}>
  <label>Марка<select value={params.get('make')||''} onChange={e=>change('make',e.target.value)}><option value="">Все марки</option>{makes.map(v=><option key={v}>{v}</option>)}</select></label>
  <label className="ac-ency-search">Поиск<input type="search" value={q} placeholder="Марка или модель" onChange={e=>{setQ(e.target.value);clearTimeout(timer.current);const value=e.target.value;timer.current=setTimeout(()=>change('q',value),350);}}/></label>
  <label>Год<select value={params.get('year')||''} onChange={e=>change('year',e.target.value)}><option value="">Все годы</option>{years.map(v=><option key={v}>{v}</option>)}</select></label>
  <label>Топливо<select value={params.get('fuel')||''} onChange={e=>change('fuel',e.target.value)}><option value="">Все виды</option>{fuels.map(v=><option key={v} value={v}>{displayValue(v)}</option>)}</select></label>
  <label className="ac-ency-check"><input type="checkbox" checked={params.has('missing30')} onChange={e=>change('missing30',e.target.checked?'1':'')}/>Без 30-мин. мощности</label>
  <button className="ac-ency-button" onClick={()=>{clearTimeout(timer.current);setQ('');latest.current='';start(()=>router.replace('/cars/autocatalog',{scroll:false}));}}>Сбросить</button>
  {pending&&<span className="ac-ency-filter-status" role="status">Обновляем…</span>}
 </section>;
}
