import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogSidebar} from '../../apps/web/components/catalog/CatalogSidebar';
import {CatalogSidebarBaseline} from './catalog-sidebar-baseline.generated';
import {BrandLogoRail} from '../../apps/web/components/catalog/BrandLogoRail';
import {CATALOG_BRANDS,canonicalCatalogBrand} from '../../apps/web/lib/catalog/brands';
const params=new URLSearchParams(location.search),baseline=params.get('baseline')==='1';
const brands=[...new Set(CATALOG_BRANDS.map(v=>canonicalCatalogBrand(v.name)).filter(Boolean))];
const initial={market:'china',city:'Новокузнецк',powerTo:'160'};
function Fixture(){
 const [error,setError]=useState(false);
 (window as any).__setCatalogError=setError;
 const rail=<BrandLogoRail initial={initial} brands={brands}/>;
 const count=<p data-test-count className="ac-catalog-result-count mt-3 flex items-center gap-2 text-base font-bold">Автомобилей: 100</p>;
 const top=<div className="max-w-4xl"><nav className="mb-4 text-xs">Главная / Каталог</nav><h1 data-test-heading className="text-[30px] font-black leading-none md:text-6xl">Каталог автомобилей</h1>{baseline&&!error&&<div className="lg:hidden">{rail}</div>}</div>;
 const header=<>{top}{baseline&&!error&&count}</>;
 const filters=<div className="ac-catalog-filter-panel" data-test-filter-panel style={{height:620}}><button type="button">Фильтры</button></div>;
 const body=<div data-test-cards className="mt-8 grid gap-10 md:mt-9" style={{minHeight:2400}}><article data-test-card style={{height:180}}>Сохранённая карточка</article></div>;
 const Component=baseline?CatalogSidebarBaseline:CatalogSidebar;
 const extra=baseline||error?{}:{brandRail:rail,headerAfterBrands:count};
 return <main className="ac-page-copy ac-catalog-page"><section className="ac-catalog-shell mx-auto w-full max-w-[1500px] px-4 py-6 md:px-8 md:py-10"><Component {...extra} header={header} filters={filters} resultScope="fixture-public-china" resultError={error?'Проверка сохранения карточек':undefined}>{error?null:<>{baseline&&<div className="hidden lg:block">{rail}</div>}{body}</>}</Component></section></main>;
}
(window as any).__brandCount=brands.length;
createRoot(document.getElementById('root')!).render(<Fixture/>);
