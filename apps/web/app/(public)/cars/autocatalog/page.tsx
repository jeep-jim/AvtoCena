import {protectedPhotoUrl} from '@/lib/catalog/photo-proxy-policy';
import type {Metadata} from 'next';
import Link from 'next/link';
import {Suspense} from 'react';
import {PublicHeader} from '@/components/layout/PublicHeader';
import {DirectoryFilters} from '@/components/encyclopedia/DirectoryFilters';
import {getCurrentUser} from '@/lib/auth';
import {CreateModel} from '@/components/encyclopedia/CreateModel';
import {EncyclopediaPhoto} from '@/components/encyclopedia/Photo';
import {canEditEncyclopedia,readEncyclopedia} from '@/lib/encyclopedia/records';
import {filterModels} from '@/lib/encyclopedia/query';
import {displayValue,modelHref} from '@/lib/encyclopedia/schema';
import './encyclopedia.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Энциклопедия автомобилей — годы, модификации и характеристики | АвтоЦена',description:'Постоянная энциклопедия АвтоЦена: марки, модели, модификации по годам, двигатели, привод и 30-минутная мощность. Таблица характеристик и экспорт.',alternates:{canonical:'/cars/autocatalog'},robots:{index:true,follow:true}};
export default async function EncyclopediaPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const user=await getCurrentUser();
 const raw=await searchParams,p=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,Array.isArray(v)?v[0]:v]));const manifest=await readEncyclopedia(),models=manifest?.models||[],filtered=filterModels(models,p),pages=Math.max(1,Math.ceil(filtered.length/48)),page=Math.max(1,Math.min(pages,Math.floor(Number(p.page)||1))),shown=filtered.slice((page-1)*48,page*48);
 const pageUrl=(n:number)=>{const q=new URLSearchParams(Object.entries(p).filter((x):x is [string,string]=>typeof x[1]==='string'));q.set('page',String(n));return '/cars/autocatalog?'+q;};
 const makes=[...new Set(models.map(m=>m.make))].sort((a,b)=>a.localeCompare(b,'ru')),years=[...new Set(models.flatMap(m=>m.years))].sort((a,b)=>b-a),fuels=[...new Set(models.flatMap(m=>m.fuels))].sort();
 return <main className="ac-ency-page"><PublicHeader backHref="/cars" backLabel="В каталог"/><div className="ac-ency-container"><nav><Link href="/cars">Каталог автомобилей</Link> / Энциклопедия</nav><div className="ac-ency-layout"><Suspense><DirectoryFilters makes={makes} years={years} fuels={fuels}/></Suspense><section className="ac-ency-results"><header className="ac-ency-intro"><div><span className="ac-ency-eyebrow">АвтоЦена · база знаний</span><h1>Энциклопедия автомобилей</h1><p>Модели, годы и модификации. Характеристики сохраняются независимо от наличия автомобиля в продаже.</p></div><a className="ac-ency-button" href="/api/encyclopedia/export">Скачать для Excel · CSV ↓</a></header>{canEditEncyclopedia(user)&&<div className="ac-ency-actions"><CreateModel/></div>}<div className="ac-ency-count"><span className="ac-pulse-dot"><span/></span>{models.length.toLocaleString('ru')} моделей · {models.reduce((n,m)=>n+m.variants,0).toLocaleString('ru')} модификаций · {makes.length} марок</div><p className="ac-ency-muted">Данные из объявлений требуют проверки. Пустое поле означает, что подтверждённых данных пока нет.</p>{!manifest?<p role="status">Готовим первый снимок энциклопедии.</p>:<><p className="ac-ency-muted">Найдено моделей: {filtered.length.toLocaleString('ru')}. Снимок от {new Date(manifest.capturedAt).toLocaleDateString('ru-RU',{timeZone:'Asia/Krasnoyarsk'})}.</p><div className="ac-ency-grid">{shown.map(m=><Link key={m.id} href={modelHref(m.id)} className="ac-ency-card"><div className="ac-ency-photo"><EncyclopediaPhoto src={protectedPhotoUrl(m.photo,m.photoMarket||'')} alt={`${m.make} ${m.model}`}/></div><div className="ac-ency-card-copy"><h2>{m.make} {m.model}</h2><p>{m.years.length?`${Math.min(...m.years)}–${Math.max(...m.years)}`:'Годы уточняются'} · {m.variants} модификаций</p><p>{m.fuels.map(displayValue).join(' · ')||'Топливо уточняется'}</p><span>Характеристики →</span></div></Link>)}</div>{!shown.length&&<p>По выбранным параметрам моделей не найдено.</p>}<nav className="ac-ency-pagination" aria-label="Страницы энциклопедии">{page>1&&<Link className="ac-ency-button" href={pageUrl(page-1)} scroll={false}>← Назад</Link>}<span>{page} / {pages}</span>{page<pages&&<Link className="ac-ency-button" href={pageUrl(page+1)} scroll={false}>Далее →</Link>}</nav></>}</section></div></div></main>;
}
