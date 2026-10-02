'use client';
import {useState,type ReactNode} from 'react';
import {Eye,RotateCcw} from 'lucide-react';
import {DealerEditor} from './DealerEditor';
import {defaultShowcase,type DealerShowcase} from '@/lib/dealers/showcase-model';
import {DEFAULT_PROGRAM,EMPTY_MEMBERSHIP,type DealerProgram,type Membership} from '@/lib/dealers/program-model';
import type {PublicFeatures} from '@/lib/dealers/showcase-store';
export function DealerWorkspace({initial,features,owner=false,administration,program=DEFAULT_PROGRAM,membership=EMPTY_MEMBERSHIP,fullAccess=true}:{initial:DealerShowcase;features:PublicFeatures;owner?:boolean;administration?:ReactNode;program?:DealerProgram;membership?:Membership;fullAccess?:boolean}){
 const [demo,setDemo]=useState(false),[basic,setBasic]=useState(false),[revision,setRevision]=useState(0),[uploading,setUploading]=useState(false);
 const makeDemo=()=>({...defaultShowcase('dealer_demo','Ваша компания'),description:'Демонстрационная компания. Настройте страницу и добавьте свой первый автомобиль.',catalogMarkets:['japan','china','korea'] as DealerShowcase['catalogMarkets'],offices:[{id:'demo-office',city:'Новосибирск',address:'Пример адреса офиса',phone:'',hours:'Пн–Пт 10:00–19:00',lat:null,lon:null,photos:[]}]});
 const [demoValue,setDemoValue]=useState(makeDemo);
 const [current,setCurrent]=useState(initial);
 const demoControl=owner?<button type="button" role="switch" aria-label={demo?"Выйти из демо":"Посмотреть демо"} aria-checked={demo} disabled={uploading} className="dw-demo dw-demo-button" onClick={()=>setDemo(!demo)}><strong><Eye size={17}/>{demo?"Выйти из демо":"Посмотреть демо"}</strong><span>Отдельный пример кабинета.</span></button>:undefined;
 return <div className="dealer-workspace" data-dealer-demo={demo}>{demo&&<header className="dealer-demo-header"><span>АвтоЦена</span><strong>Дилер</strong></header>}{demo&&<div className="dw-demo"><strong>Демо · Дилер</strong><div className="flex gap-2"><button className="rounded-xl border px-3 py-2 text-sm" disabled={uploading} onClick={()=>setBasic(!basic)}>{basic?'Базовый доступ':'Пробный месяц · все функции'}</button><button className="rounded-xl border px-3 py-2 text-sm" disabled={uploading} onClick={()=>{setDemoValue(makeDemo());setRevision(revision+1);}}><RotateCcw size={15} className="inline"/> Сбросить</button></div></div>}
 <DealerEditor key={`${demo}-${basic}-${revision}`} initial={demo?demoValue:current} sidebarTop={demoControl} onSaved={setCurrent} features={features} platformOwner={owner&&!demo} demo={demo} onDemoChange={setDemoValue} onUploadingChange={setUploading} fullAccess={demo?!basic:fullAccess} program={program} membership={membership} administration={demo?undefined:administration}/></div>;
}
