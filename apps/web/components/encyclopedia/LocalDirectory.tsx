'use client';
import {PUBLIC_HEADER_LAYOUT_EVENT} from '@/components/layout/public-header-layout';
import {useEffect,useMemo,useRef,useState} from 'react';
import {useSearchParams} from 'next/navigation';
import {directoryLetter,filterModels} from '@/lib/encyclopedia/query';
import {unpackDirectory,type DirectoryWire} from '@/lib/encyclopedia/directory-wire';
import {BrandLogoVisual} from '@/components/catalog/BrandLogoRail';
import {KnowledgeDirectory} from './KnowledgeDirectory';
export function LocalDirectory({data,canEdit}:{data:DirectoryWire;canEdit:boolean}){
 const params=useSearchParams(),models=useMemo(()=>unpackDirectory(data),[data]);
 const filtered=useMemo(()=>filterModels(models,Object.fromEntries(params.entries())),[models,params]);
 const root=useRef<HTMLDivElement>(null),pending=useRef<string>(),[active,setActive]=useState('');
 const navigationModels=useMemo(()=>{const query=Object.fromEntries(params.entries());delete query.make;delete query.letter;return filterModels(models,query);},[models,params]);
 const makes=useMemo(()=>[...new Set(navigationModels.map(m=>m.make))],[navigationModels]);
 const letters=useMemo(()=>[...new Set(makes.map(directoryLetter))].filter(Boolean),[makes]);
 const jump=(make:string)=>{const index=navigationModels.findIndex(m=>m.make===make);if(index<0)return;pending.current=make;const query=new URLSearchParams(params);query.delete('make');query.delete('letter');query.set('page',String(Math.floor(index/40)+1));if(query.toString()===params.toString()){pending.current=undefined;[...root.current!.querySelectorAll<HTMLElement>('[data-ency-make]')].find(h=>h.dataset.encyMake===make)?.scrollIntoView({block:'start',behavior:'instant'});}else window.history.pushState(null,'',`/cars/autocatalog?${query}`);setActive(make);};
 useEffect(()=>{
  const node=root.current;if(!node)return;
  const header=document.querySelector<HTMLElement>('.ac-public-header');
  const sync=()=>node.style.setProperty('--ency-header-height',`${header?.getBoundingClientRect().bottom||68}px`);sync();
  const resize=new ResizeObserver(sync);if(header)resize.observe(header);
  window.addEventListener(PUBLIC_HEADER_LAYOUT_EVENT,sync);
  return()=>{resize.disconnect();window.removeEventListener(PUBLIC_HEADER_LAYOUT_EVENT,sync);};
 },[]);
 useEffect(()=>{
  const node=root.current;if(!node)return;
  const headings=[...node.querySelectorAll<HTMLElement>('[data-ency-make]')];
  if(pending.current){const target=headings.find(h=>h.dataset.encyMake===pending.current);pending.current=undefined;target?.scrollIntoView({block:'start',behavior:'instant'});}
  let frame=0;
  const rail=node.querySelector<HTMLElement>('.ac-directory-rail'),list=node.querySelector<HTMLElement>('.ac-model-list');
  const update=()=>{
   frame=0;
   if(rail&&list){
    if(matchMedia('(min-width:1101px)').matches){
     const railTop=parseFloat(getComputedStyle(rail).top)||124;
     // Shrink above the end of the model list instead of letting sticky push
     // the whole rail (including the active letter) behind the fixed header.
     const height=Math.max(0,Math.min(innerHeight-railTop-16,list.getBoundingClientRect().bottom-railTop));
     rail.style.height=`${height}px`;
     for(const column of rail.querySelectorAll<HTMLElement>('.ac-directory-rail-column')){
      const item=column.querySelector<HTMLElement>('[aria-current="true"]');
      if(item&&column.clientHeight&&(item.offsetTop<column.scrollTop||item.offsetTop+item.offsetHeight>column.scrollTop+column.clientHeight))column.scrollTop=Math.max(0,item.offsetTop-(column.clientHeight-item.offsetHeight)/2);
     }
    }else rail.style.removeProperty('height');
   }
   const top=(headings[0]?parseFloat(getComputedStyle(headings[0]).scrollMarginTop):0)||((document.querySelector('.ac-public-header')?.getBoundingClientRect().bottom||68)+64);const visible=headings.filter(h=>h.getBoundingClientRect().top<=top+1);setActive((visible.at(-1)||headings[0])?.dataset.encyMake||'');
  };
  const scroll=()=>{if(!frame)frame=requestAnimationFrame(update);};update();window.addEventListener('scroll',scroll,{passive:true});window.addEventListener('resize',scroll);window.addEventListener(PUBLIC_HEADER_LAYOUT_EVENT,scroll);
  return()=>{window.removeEventListener('scroll',scroll);window.removeEventListener('resize',scroll);window.removeEventListener(PUBLIC_HEADER_LAYOUT_EVENT,scroll);cancelAnimationFrame(frame);};
 },[filtered,params]);
 useEffect(()=>{for(const column of root.current?.querySelectorAll<HTMLElement>('.ac-directory-rail-column')||[]){const item=column.querySelector<HTMLElement>('[aria-current="true"]');if(item)column.scrollTo({top:Math.max(0,item.offsetTop-column.clientHeight/2+item.clientHeight/2),left:Math.max(0,item.offsetLeft-column.clientWidth/2+item.clientWidth/2),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});}},[active]);
 const page=Math.min(Math.max(1,Math.floor(Number(params.get('page'))||1)),Math.max(1,Math.ceil(filtered.length/40)));
 return <div ref={root} className="ac-directory-with-rail"><KnowledgeDirectory models={filtered.slice((page-1)*40,page*40)} canEdit={canEdit} pagination={{page,total:filtered.length}}/>
  <aside className="ac-directory-rail" aria-label="Быстрый переход по маркам">
   <nav className="ac-directory-rail-column ac-directory-rail-letters" aria-label="Буквы марок">{letters.map(letter=><button key={letter} aria-label={`Марки на ${letter}`} aria-current={directoryLetter(active)===letter?'true':undefined} onClick={()=>jump(makes.find(make=>directoryLetter(make)===letter)!)}>{letter}</button>)}</nav>
   <nav className="ac-directory-rail-column ac-directory-rail-brands" aria-label="Логотипы марок">{makes.map(make=><button key={make} title={make} aria-label={make} aria-current={active===make?'true':undefined} onClick={()=>jump(make)}><BrandLogoVisual brand={make}/></button>)}</nav>
  </aside>
 </div>;
}
