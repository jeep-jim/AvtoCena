'use client';
import {PUBLIC_HEADER_LAYOUT_EVENT} from '@/components/layout/public-header-layout';
import {useEffect,useMemo,useRef} from 'react';
import {useSearchParams} from 'next/navigation';
import {ArrowLeft,Search} from 'lucide-react';
import {filterModels} from '@/lib/encyclopedia/query';
import {unpackDirectory,type DirectoryWire} from '@/lib/encyclopedia/directory-wire';
import {BrandLogoVisual} from '@/components/catalog/BrandLogoRail';
import {KnowledgeDirectory} from './KnowledgeDirectory';
export function LocalDirectory({data,canEdit}:{data:DirectoryWire;canEdit:boolean}){
 const params=useSearchParams(),models=useMemo(()=>unpackDirectory(data),[data]);
 const root=useRef<HTMLDivElement>(null),make=params.get('make')||'';
 const filtered=useMemo(()=>filterModels(models,Object.fromEntries(params.entries())),[models,params]);
 const brands=useMemo(()=>{
  const query=Object.fromEntries(params.entries());delete query.make;
  const groups=new Map<string,number>();for(const model of filterModels(models,query))groups.set(model.make,(groups.get(model.make)||0)+1);
  return [...groups].map(([name,count])=>({name,count}));
 },[models,params]);
 const navigate=(name:string)=>{const next=new URLSearchParams(params);next.delete('page');if(name)next.set('make',name);else next.delete('make');window.history.pushState(null,'',`/cars/autocatalog${next.size?'?'+next:''}`);};
 useEffect(()=>{
  const node=root.current?.closest<HTMLElement>('.ac-ency-page');if(!node)return;
  const header=document.querySelector<HTMLElement>('.ac-public-header'),filters=node.querySelector<HTMLElement>('.ac-ency-filter-dock');
  const sync=()=>{node.style.setProperty('--ency-header-height',`${header?.getBoundingClientRect().height||68}px`);node.style.setProperty('--ency-filter-height',`${filters?.getBoundingClientRect().height||0}px`);};sync();
  const resize=new ResizeObserver(sync);if(header)resize.observe(header);if(filters)resize.observe(filters);
  window.addEventListener(PUBLIC_HEADER_LAYOUT_EVENT,sync);return()=>{resize.disconnect();window.removeEventListener(PUBLIC_HEADER_LAYOUT_EVENT,sync);};
 },[]);
 const page=Math.min(Math.max(1,Math.floor(Number(params.get('page'))||1)),Math.max(1,Math.ceil(filtered.length/40)));
 return <div ref={root} className={`ac-directory-browser${make?' is-selected':''}`}>
  {make&&<aside className="ac-brand-sidebar"><button className="ac-browser-back" onClick={()=>navigate('')}><ArrowLeft size={16}/>Все марки</button><nav aria-label="Марки автомобилей">{brands.map(brand=><button key={brand.name} aria-current={make===brand.name?'true':undefined} onClick={()=>navigate(brand.name)}><BrandLogoVisual brand={brand.name}/><span>{brand.name}</span><small>{brand.count}</small></button>)}</nav></aside>}
  <div className="ac-browser-content">
   <header className="ac-browser-heading"><div>{make?<><button className="ac-browser-mobile-back" aria-label="Назад к маркам" onClick={()=>navigate('')}><ArrowLeft size={18}/></button><BrandLogoVisual brand={make}/></>:null}<h2>{make||'Марки автомобилей'}</h2><span>{make?`${filtered.length} моделей`:`${brands.length} марок`}</span></div></header>
   {make?<KnowledgeDirectory models={filtered.slice((page-1)*40,page*40)} canEdit={canEdit} pagination={{page,total:filtered.length}}/>:<div className="ac-brand-grid">{brands.map(brand=><button className="ac-brand-card" key={brand.name} onClick={()=>navigate(brand.name)}><BrandLogoVisual brand={brand.name}/><span><strong>{brand.name}</strong><small>{brand.count} моделей</small></span></button>)}</div>}
   {!make&&!brands.length&&<div className="ac-browser-empty"><Search size={24}/><h3>Марки не найдены</h3><p>Измените поиск или сбросьте фильтры.</p></div>}
  </div>
 </div>;
}
