import {redirect} from 'next/navigation';
import {catalogBrandPresentation} from '@/lib/catalog/brands';
import {protectedPhotoUrl} from '@/lib/catalog/photo-proxy-policy';
import type {Metadata} from 'next';
import {CatalogBreadcrumbs} from '@/components/catalog/CatalogBreadcrumbs';
import {Suspense} from 'react';
import {PublicHeader} from '@/components/layout/PublicHeader';
import {DirectoryFilters} from '@/components/encyclopedia/DirectoryFilters';
import {getCurrentUser} from '@/lib/auth';
import {CreateModel} from '@/components/encyclopedia/CreateModel';
import {KnowledgeDirectory} from '@/components/encyclopedia/KnowledgeDirectory';
import {canEditEncyclopedia,readEncyclopedia} from '@/lib/encyclopedia/records';
import {filterModels,canonicalDirectoryModels} from '@/lib/encyclopedia/query';
import {counted,fuelFilterKey} from '@/lib/encyclopedia/schema';
import './encyclopedia.css';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Энциклопедия автомобилей — годы, модификации и характеристики | АвтоЦена',description:'Постоянная энциклопедия АвтоЦена: марки, модели, модификации по годам, двигатели, привод и 30-минутная мощность. Таблица характеристик по годам.',alternates:{canonical:'/cars/autocatalog'},robots:{index:true,follow:true}};
export default async function EncyclopediaPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const user=await getCurrentUser();
 const raw=await searchParams,p=Object.fromEntries(Object.entries(raw).map(([k,v])=>[k,Array.isArray(v)?v[0]:v]));if(p.make){const make=catalogBrandPresentation(p.make).name;if(make!==p.make){const canonical=new URLSearchParams();for(const [key,value] of Object.entries(p))if(value!==undefined)canonical.set(key,key==='make'?make:value);redirect(`/cars/autocatalog?${canonical}`);}}const manifest=await readEncyclopedia(),models=canonicalDirectoryModels(manifest?.models||[]),filtered=filterModels(models,p);
 const makes=[...new Set(models.map(m=>m.make))].sort((a,b)=>a.localeCompare(b,'ru')),years=[...new Set(models.flatMap(m=>m.years))].sort((a,b)=>b-a),fuels=[...new Set(models.flatMap(m=>m.fuels.map(fuelFilterKey)))].sort();
 return <main className="ac-ency-page ac-page-copy"><PublicHeader backHref="/cars" backLabel="В каталог"/><div className="ac-ency-container">
  <CatalogBreadcrumbs items={[{label:'Главная',href:'/'},{label:'Каталог автомобилей',href:'/cars'},{label:'Энциклопедия',href:'/cars/autocatalog'},...(p.make?[{label:p.make,href:`/cars/autocatalog?make=${encodeURIComponent(p.make)}`}]:[])]}/>
  <header className="ac-ency-intro"><div><h1>Энциклопедия автомобилей</h1><div className="ac-ency-count"><span className="ac-pulse-dot ac-pulse-dot--status"><span/></span>{counted(models.length,'model')} · {counted(models.reduce((n,m)=>n+m.variants,0),'variant')} · {counted(makes.length,'make')}</div></div>{canEditEncyclopedia(user)&&<CreateModel/>}</header>
  <Suspense><DirectoryFilters makes={makes} years={years} fuels={fuels}/></Suspense>
  <section className="ac-ency-results">{!manifest?<p role="status">Готовим первый снимок энциклопедии.</p>:<Suspense><KnowledgeDirectory models={filtered.map(({key,photo,...m})=>({...m,photo:protectedPhotoUrl(photo,m.photoMarket||'')}))} canEdit={canEditEncyclopedia(user)}/></Suspense>}</section>
 </div></main>;
}
