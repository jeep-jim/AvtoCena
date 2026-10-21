import {Suspense} from 'react';
import {ArrowRight} from 'lucide-react';
import {CatalogBreadcrumbs} from '@/components/catalog/CatalogBreadcrumbs';
import {protectedPhotoUrl} from '@/lib/catalog/photo-proxy-policy';
import type {Metadata} from 'next';
import Link from 'next/link';
import {notFound} from 'next/navigation';
import {getCurrentUser} from '@/lib/auth';
import {PublicHeader} from '@/components/layout/PublicHeader';
import {ModelWorkspace} from '@/components/encyclopedia/KnowledgeDirectory';
import {readModel,canEditEncyclopedia,summarize} from '@/lib/encyclopedia/records';
import {counted,modelHref} from '@/lib/encyclopedia/schema';
import '../encyclopedia.css';
export const dynamic='force-dynamic';
export async function generateMetadata({params}:{params:Promise<{id:string}>}):Promise<Metadata>{const {id}=await params,m=await readModel(id);return m?{title:`${m.make} ${m.model} — характеристики по годам | АвтоЦена`,description:`Модификации ${m.make} ${m.model}: двигатели, мощность, кузов, привод и 30-минутная мощность.`,alternates:{canonical:modelHref(id)},robots:{index:true,follow:true}}:{title:'Модель не найдена',robots:{index:false}};}
export default async function ModelPage({params}:{params:Promise<{id:string}>}){const {id}=await params,[record,user]=await Promise.all([readModel(id),getCurrentUser()]);if(!record)notFound();const {key,...model}=summarize(record,'');
 return <main className="ac-ency-page ac-page-copy"><PublicHeader backHref={`/cars/autocatalog?make=${encodeURIComponent(record.make)}`} backLabel={`К моделям ${record.make}`}/><div className="ac-ency-container"><CatalogBreadcrumbs items={[{label:'Главная',href:'/'},{label:'Каталог автомобилей',href:'/cars'},{label:'Энциклопедия',href:'/cars/autocatalog'},{label:record.make,href:`/cars/autocatalog?make=${encodeURIComponent(record.make)}`},{label:record.model,href:modelHref(id)}]}/><header className="ac-ency-model-head">{record.photo&&<img src={protectedPhotoUrl(record.photo,record.photoMarket||'')} alt={`${record.make} ${record.model}`} decoding="async"/>}<div><h1>{record.make} {record.model}</h1><p>{counted(record.variants.length,'variant')} · обновлено {new Date(record.updatedAt).toLocaleDateString('ru-RU',{timeZone:'Asia/Krasnoyarsk'})}</p><Link href={`/cars?make=${encodeURIComponent(record.make)}&model=${encodeURIComponent(record.model)}`}>Автомобили в продаже<ArrowRight size={16} aria-hidden/></Link></div></header><Suspense><ModelWorkspace model={model} canEdit={canEditEncyclopedia(user)} standalone/></Suspense><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify({'@context':'https://schema.org','@type':'Dataset',name:`${record.make} ${record.model} — характеристики модификаций`,description:'Справочная таблица с указанием статуса проверки данных.',url:`https://avtocena.com${modelHref(id)}`,dateModified:record.updatedAt,creator:{'@type':'Organization',name:'АвтоЦена'}}).replace(/</g,'\\u003c')}}/></div></main>;
}
