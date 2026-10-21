'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,ArrowRight} from 'lucide-react';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import {CatalogChevron} from '@/components/catalog/CatalogChevron';
import {CatalogViewIcon} from '@/components/catalog/CatalogViewIcon';
import {BrandLogoVisual} from '@/components/catalog/BrandLogoRail';
import '@/components/catalog/catalog-sidebar.css';
import {ModelEditor} from './ModelEditor';
import {EncyclopediaPhoto} from './Photo';
import {counted,modelHref,type ModelSummary,type ModelRecord} from '@/lib/encyclopedia/schema';
type Summary=Omit<ModelSummary,'key'>;
const letter=(s:string)=>s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').match(/^[A-Za-zА-Яа-я]/)?.[0]?.toUpperCase()||'#';
export function ModelWorkspace({model,canEdit,standalone=false}:{model:Summary;canEdit:boolean;standalone?:boolean}){
 const params=useSearchParams(),filterYear=params.get('year');
 const years=[...model.years].sort((a,b)=>b-a).map(String);if(model.hasUnknownYear||!years.length)years.push('unknown');
 const [year,setYear]=useState(filterYear&&years.includes(filterYear)?filterYear:years[0]);
 const [editing,setEditing]=useState(false);
 useEffect(()=>{if(filterYear&&model.years.includes(Number(filterYear)))setYear(filterYear);},[filterYear,model.id]);
 const [record,setRecord]=useState<ModelRecord|null>(null),[error,setError]=useState('');
 const controller=useRef<AbortController>();
 const load=useCallback(async()=>{
  controller.current?.abort();const request=new AbortController();controller.current=request;setError('');
  try{const response=await fetch(`/api/encyclopedia/${model.id}?year=${year}`,{signal:request.signal});if(!response.ok)throw Error();const data=await response.json();if(!request.signal.aborted)setRecord(data);}
  catch(e){if(!request.signal.aborted){setError('Не удалось загрузить модификации.');throw e;}}
 },[model.id,year]);
 useEffect(()=>{setRecord(null);void load().catch(()=>{});return()=>controller.current?.abort();},[load]);
 return <section className="ac-knowledge-workspace" aria-label={`${model.make} ${model.model}: модификации`}>
  <div className="ac-knowledge-workspace-bar"><div className="ac-knowledge-years" role="group" aria-label={`Год ${model.model}`}>{years.map(y=><button key={y} aria-pressed={year===y} disabled={editing} onClick={()=>setYear(y)}>{y==='unknown'?'Без года':y}</button>)}</div>{!standalone&&<Link className="ac-knowledge-link" href={modelHref(model.id)}>Страница модели<ArrowRight size={16} aria-hidden/></Link>}</div>
  {error?<p role="alert">{error} <button className="ac-ency-button" onClick={()=>void load().catch(()=>{})}>Повторить</button></p>:record?<ModelEditor record={record} canEdit={canEdit} defaultYear={year==='unknown'?undefined:Number(year)} onSaved={load} onEditingChange={setEditing} filterFuel={params.get('fuel')||''} onlyMissing30={params.has('missing30')}/>:<p className="ac-ency-muted" role="status">Загружаем модификации…</p>}
 </section>;
}
function ModelRow({model,canEdit}:{model:Summary;canEdit:boolean}){
 const [opened,setOpened]=useState(false);
 return <details data-ac-preserve-open className="ac-knowledge-model" onToggle={e=>{if(e.target===e.currentTarget)if(e.currentTarget.open)setOpened(true);}}><summary><div className="ac-knowledge-photo"><EncyclopediaPhoto src={model.photo} alt={`${model.make} ${model.model}`}/></div><strong>{model.model}</strong><span className="ac-knowledge-model-meta">{model.years.length?`${Math.min(...model.years)}–${Math.max(...model.years)}`:'Без года'} · {counted(model.variants,'variant')}</span><CatalogChevron className="ac-knowledge-chevron"/></summary>{opened&&<ModelWorkspace model={model} canEdit={canEdit}/>}</details>;
}
export function KnowledgeDirectory({models,canEdit}:{models:Summary[];canEdit:boolean}){
 const router=useRouter(),params=useSearchParams(),selected=params.get('make')||'';
 const [view,setView]=useState<'list'|'grid'>('list'),[activeLetter,setActiveLetter]=useState('');
 const returnPosition=useRef(0);
 useEffect(()=>{try{if(sessionStorage.getItem('encyclopedia-view')==='grid')setView('grid');}catch{}},[]);
 useEffect(()=>{setActiveLetter('');},[selected]);
 const groups=new Map<string,Summary[]>();for(const m of models)groups.set(m.make,[...(groups.get(m.make)||[]),m]);
 const brands=[...groups].sort(([a],[b])=>a.localeCompare(b,'ru',{numeric:true}));
 const letters=[...new Set((selected?models.map(m=>m.model):brands.map(([make])=>make)).map(letter))].sort();
 const choose=(make:string)=>{if(make)returnPosition.current=window.scrollY;const q=new URLSearchParams(params);q.delete('page');q.delete('market');q.delete('q');if(make)q.set('make',make);else q.delete('make');router.push(`/cars/autocatalog${q.size?'?'+q:''}`,{scroll:false});if(!make)requestAnimationFrame(()=>window.scrollTo(0,returnPosition.current));};
 return <section className={`ac-knowledge ac-knowledge--${view}`} aria-label="Марки, модели и годы">
  {selected&&<button className="ac-ency-button" onClick={()=>choose('')}><ArrowLeft size={16} aria-hidden/>Назад к маркам</button>}
  <div className="ac-knowledge-toolbar"><div className="ac-catalog-view-toggle ac-knowledge-switch" role="group" aria-label="Вид каталога">{(['grid','list'] as const).map(v=><button key={v} aria-label={v==='grid'?'Плитка':'Список'} title={v==='grid'?'Плитка':'Список'} aria-pressed={view===v} onClick={()=>{setView(v);try{sessionStorage.setItem('encyclopedia-view',v);}catch{}}}><CatalogViewIcon mode={v}/></button>)}</div><nav className="ac-knowledge-alphabet" aria-label={selected?'Алфавит моделей':'Алфавит марок'}><button aria-pressed={!activeLetter} onClick={()=>setActiveLetter('')}>Все</button>{letters.map(l=><button key={l} aria-pressed={activeLetter===l} onClick={()=>setActiveLetter(l)}>{l}</button>)}</nav></div>
  {selected?<><h2 className="ac-knowledge-heading"><BrandLogoVisual brand={selected}/>{selected}</h2><div className="ac-knowledge-models">{models.filter(m=>!activeLetter||letter(m.model)===activeLetter).sort((a,b)=>a.model.localeCompare(b.model,'ru',{numeric:true})).map(m=><ModelRow key={m.id} model={m} canEdit={canEdit}/>)}</div></>:<div className="ac-knowledge-brands">{brands.filter(([make])=>!activeLetter||letter(make)===activeLetter).map(([make,rows])=><details data-ac-preserve-open className="ac-knowledge-brand" key={make}><summary><BrandLogoVisual brand={make}/><strong>{make}</strong><span>{counted(rows.length,'model')}</span><CatalogChevron className="ac-knowledge-chevron"/></summary><div className="ac-knowledge-brand-content"><div className="ac-knowledge-brand-bar"><button className="ac-knowledge-link" onClick={()=>choose(make)}>Все модели {make}<ArrowRight size={16} aria-hidden/></button></div>{rows.sort((a,b)=>a.model.localeCompare(b.model,'ru',{numeric:true})).map(m=><ModelRow key={m.id} model={m} canEdit={canEdit}/>)}</div></details>)}</div>}
  {!models.length&&<p>По выбранным параметрам моделей не найдено.</p>}
 </section>;
}
