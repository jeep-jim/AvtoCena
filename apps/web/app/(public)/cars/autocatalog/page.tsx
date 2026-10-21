import {protectedPhotoUrl} from '@/lib/catalog/photo-proxy-policy';
import type {Metadata} from 'next';
import Link from 'next/link';
import {Suspense} from 'react';
import {PublicHeader} from '@/components/layout/PublicHeader';
import {DirectoryFilters} from '@/components/encyclopedia/DirectoryFilters';
import {getCurrentUser} from '@/lib/auth';
import {KnowledgeDirectory} from '@/components/encyclopedia/KnowledgeDirectory';
import {canEditEncyclopedia,readEncyclopedia} from '@/lib/encyclopedia/records';
import {filterModels} from '@/lib/encyclopedia/query';
import {counted,fuelFilterKey,displayValue,modelHref} from '@/lib/encyclopedia/schema';
import './encyclopedia.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Энциклопедия автомобилей — годы, модификации и характеристики | АвтоЦена',description:'Постоянная энциклопедия АвтоЦена: марки, модели, модификации по годам, двигатели, привод и 30-минутная мощность. Таблица характеристик по годам.',alternates:{canonical:'/cars/autocatalog'},robots:{index:true,follow:true}};
export default async function EncyclopediaPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const user=await getCurrentUser();
 const raw=await searchParams,p=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,Array.isArray(v)?v[0]:v]));const manifest=await readEncyclopedia(),models=manifest?.models||[],filtered=filterModels(models,p);
 const makes=[...new Set(models.map(m=>m.make))].sort((a,b)=>a.localeCompare(b,'ru')),years=[...new Set(models.flatMap(m=>m.years))].sort((a,b)=>b-a),fuels=[...new Set(models.flatMap(m=>m.fuels.map(fuelFilterKey)))].sort();
 return <main className="ac-ency-page ac-page-copy"><PublicHeader backHref="/cars" backLabel="В каталог"/><div className="ac-ency-container"><nav><Link href="/cars">Каталог автомобилей</Link> / Энциклопедия</nav><div className="ac-ency-layout"><Suspense><DirectoryFilters makes={makes} years={years} fuels={fuels} canEdit={canEditEncyclopedia(user)}/></Suspense><section className="ac-ency-results"><header className="ac-ency-intro"><div><h1>Энциклопедия автомобилей</h1></div></header><div className="ac-ency-count"><span className="ac-pulse-dot ac-pulse-dot--status"><span/></span>{counted(models.length,'model')} · {counted(models.reduce((n,m)=>n+m.variants,0),'variant')} · {counted(makes.length,'make')}</div>{!manifest?<p role="status">Готовим первый снимок энциклопедии.</p>:<><Suspense><KnowledgeDirectory models={filtered.map(({key,photo,...m})=>({...m,photo:protectedPhotoUrl(photo,m.photoMarket||'')}))} canEdit={canEditEncyclopedia(user)}/></Suspense></>}</section></div></div></main>;
}
