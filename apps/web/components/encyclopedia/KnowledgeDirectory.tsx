'use client';
import {ArrowLeft,ArrowRight} from 'lucide-react';
import {CatalogChevron} from '@/components/catalog/CatalogChevron';
import {CatalogViewIcon} from '@/components/catalog/CatalogViewIcon';
import '@/components/catalog/catalog-sidebar.css';
import {useEffect,useRef,useState} from 'react';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import {BrandLogoVisual} from '@/components/catalog/BrandLogoRail';
import {ModelEditor} from './ModelEditor';
import {EncyclopediaPhoto} from './Photo';
import {counted,modelHref,type ModelSummary,type ModelRecord} from '@/lib/encyclopedia/schema';
type Summary=Omit<ModelSummary,'key'>;
const letter=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').match(/^[A-Za-zА-Яа-я]/)?.[0]?.toUpperCase()||'#';
function YearTable({model,year,canEdit}:{model:Summary;year:number|null;canEdit:boolean}){
 const [record,setRecord]=useState<ModelRecord|null>(null),[error,setError]=useState(''),[open,setOpen]=useState(false),[revision,setRevision]=useState(0);
 useEffect(()=>{if(!open)return;const controller=new AbortController();setRecord(null);setError('');fetch(`/api/encyclopedia/${model.id}?year=${year??'unknown'}`,{signal:controller.signal}).then(async r=>{if(!r.ok)throw Error();setRecord(await r.json());}).catch(e=>{if(e.name!=='AbortError')setError('Не удалось открыть характеристики. Повторить');});return()=>controller.abort();},[open,model.id,year,revision]);
 return <details data-ac-preserve-open className="ac-knowledge-year" onToggle={e=>setOpen(e.currentTarget.open)}><summary><CatalogChevron className="ac-knowledge-chevron"/>{year||'Год не указан'}<span>Характеристики и модификации</span></summary>{open&&(record?<ModelEditor record={record} canEdit={canEdit} onSaved={()=>setRevision(n=>n+1)}/>:error?<button className="ac-ency-button" onClick={()=>setRevision(n=>n+1)}>{error}</button>:<p role="status">Загружаем характеристики…</p>)}</details>;
}
function ModelRow({model,canEdit}:{model:Summary;canEdit:boolean}){
 const [open,setOpen]=useState(false);
 return <details data-ac-preserve-open className="ac-knowledge-model" onToggle={e=>setOpen(e.currentTarget.open)}><summary><div className="ac-knowledge-photo"><EncyclopediaPhoto src={model.photo} alt={`${model.make} ${model.model}`}/></div><strong>{model.model}</strong><span>{model.years.length?`${Math.min(...model.years)}–${Math.max(...model.years)}`:'Год не указан'}</span><span>{counted(model.variants,'variant')}</span><CatalogChevron className="ac-knowledge-chevron"/></summary>{open&&<div className="ac-knowledge-years"><Link className="ac-knowledge-link" href={modelHref(model.id)}>Открыть страницу модели<ArrowRight size={16} aria-hidden/></Link>{[...model.years].sort((a,b)=>b-a).map(year=><YearTable key={year} model={model} year={year} canEdit={canEdit}/>)}{(model.hasUnknownYear||!model.years.length)&&<YearTable model={model} year={null} canEdit={canEdit}/>}</div>}</details>;
}
export function KnowledgeDirectory({models,canEdit}:{models:Summary[];canEdit:boolean}){
 const router=useRouter(),params=useSearchParams(),selected=params.get('make')||'';
 const [view,setView]=useState<'list'|'grid'>('list'),[activeLetter,setActiveLetter]=useState('');
 const returnPosition=useRef(0);
 useEffect(()=>{const saved=sessionStorage.getItem('encyclopedia-view');if(saved==='grid')setView('grid');},[]);
 useEffect(()=>{setActiveLetter('');},[selected]);
 const groups=new Map<string,Summary[]>();for(const m of models)groups.set(m.make,[...(groups.get(m.make)||[]),m]);
 const brands=[...groups].sort(([a],[b])=>a.localeCompare(b,'ru',{numeric:true}));
 const letters=[...new Set((selected?models.map(m=>m.model):brands.map(([make])=>make)).map(letter))].sort();
 const choose=(make:string)=>{if(make)returnPosition.current=window.scrollY;const q=new URLSearchParams(params);q.delete('page');q.delete('market');q.delete('q');if(make)q.set('make',make);else q.delete('make');router.push(`/cars/autocatalog${q.size?'?'+q:''}`,{scroll:false});if(!make)requestAnimationFrame(()=>window.scrollTo(0,returnPosition.current));};
 return <section className={`ac-knowledge ac-knowledge--${view}`} aria-label="Марки, модели и годы">{selected&&<button className="ac-ency-button" onClick={()=>choose('')}><ArrowLeft size={16} aria-hidden/>Назад к маркам</button>}<div className="ac-knowledge-toolbar"><div className="ac-catalog-view-toggle ac-knowledge-switch" aria-label="Вид каталога">{(['grid','list'] as const).map(v=><button key={v} aria-label={v==='grid'?'Плитка':'Список'} title={v==='grid'?'Плитка':'Список'} aria-pressed={view===v} onClick={()=>{setView(v);sessionStorage.setItem('encyclopedia-view',v);}}><CatalogViewIcon mode={v}/></button>)}</div><nav className="ac-knowledge-alphabet" aria-label={selected?'Алфавит моделей':'Алфавит марок'}><button aria-pressed={!activeLetter} onClick={()=>setActiveLetter('')}>Все</button>{letters.map(l=><button key={l} aria-pressed={activeLetter===l} onClick={()=>setActiveLetter(l)}>{l}</button>)}</nav></div>{selected?<><h2 className="ac-knowledge-heading"><BrandLogoVisual brand={selected}/>{selected}</h2><div className="ac-knowledge-models">{models.filter(m=>!activeLetter||letter(m.model)===activeLetter).sort((a,b)=>a.model.localeCompare(b.model,'ru',{numeric:true})).map(m=><ModelRow key={m.id} model={m} canEdit={canEdit}/>)}</div></>:<div className="ac-knowledge-brands">{brands.filter(([make])=>!activeLetter||letter(make)===activeLetter).map(([make,rows])=><details data-ac-preserve-open className="ac-knowledge-brand" key={make}><summary><BrandLogoVisual brand={make}/><strong>{make}</strong><span>{counted(rows.length,'model')}</span><CatalogChevron className="ac-knowledge-chevron"/></summary><div className="ac-knowledge-brand-content"><button className="ac-knowledge-link" onClick={()=>choose(make)}>Все модели {make}<ArrowRight size={16} aria-hidden/></button>{rows.sort((a,b)=>a.model.localeCompare(b.model,'ru',{numeric:true})).map(m=><ModelRow key={m.id} model={m} canEdit={canEdit}/>)}</div></details>)}</div>}{!models.length&&<p>По выбранным параметрам моделей не найдено.</p>}</section>;
}
