'use client';
import {useState,type ReactNode} from 'react';
import {Eye,RotateCcw} from 'lucide-react';
import {DealerEditor} from './DealerEditor';
import {defaultShowcase,type DealerShowcase} from '@/lib/dealers/showcase-model';
import {DEFAULT_PROGRAM,EMPTY_MEMBERSHIP,type DealerProgram,type Membership} from '@/lib/dealers/program-model';
import type {PublicFeatures} from '@/lib/dealers/showcase-store';
export function DealerWorkspace({initial,features,owner=false,administration,program=DEFAULT_PROGRAM,membership=EMPTY_MEMBERSHIP,fullAccess=true}:{initial:DealerShowcase;features:PublicFeatures;owner?:boolean;administration?:ReactNode;program?:DealerProgram;membership?:Membership;fullAccess?:boolean}){
 const [demo,setDemo]=useState(false),[basic,setBasic]=useState(false),[revision,setRevision]=useState(0);
 const demoValue={...defaultShowcase('dealer_demo','Ваша компания'),description:'Демонстрационная компания. Настройте страницу и добавьте свой первый автомобиль.',catalogMarkets:['japan','china','korea'] as DealerShowcase['catalogMarkets'],offices:[{id:'demo-office',city:'Новосибирск',address:'Пример адреса офиса',phone:'',hours:'Пн–Пт 10:00–19:00',lat:null,lon:null,photos:[]}]};
 return <div className="dealer-workspace">{owner&&<div className="dw-demo"><div><strong><Eye size={17} className="inline mr-2"/>Посмотреть как подключённый дилер</strong><p>Отдельный пример кабинета. Настройки ТопАвто и других компаний сохраняются только в рабочем режиме.</p></div><button type="button" role="switch" aria-checked={demo} className="dw-primary" onClick={()=>setDemo(!demo)}>{demo?'Выйти из демо':'Включить демо'}</button></div>}{demo&&<div className="dw-demo"><strong>Демо · Дилер</strong><div className="flex gap-2"><button className="rounded-xl border px-3 py-2 text-sm" onClick={()=>setBasic(!basic)}>{basic?'Базовый доступ':'Пробный месяц · все функции'}</button><button className="rounded-xl border px-3 py-2 text-sm" onClick={()=>setRevision(revision+1)}><RotateCcw size={15} className="inline"/> Сбросить</button></div></div>}
 <DealerEditor key={`${demo}-${basic}-${revision}`} initial={demo?demoValue:initial} features={features} platformOwner={owner&&!demo} demo={demo} fullAccess={demo?!basic:fullAccess} program={program} membership={membership} administration={demo?undefined:administration}/></div>;
}
