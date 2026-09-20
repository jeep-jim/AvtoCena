import React from 'react';
import { createRoot } from 'react-dom/client';
import { CatalogFilters } from '../../apps/web/components/catalog/CatalogFilters';
import { CatalogFilterUiEnhancer } from '../../apps/web/components/catalog/CatalogFilterUiEnhancer';
const initial = {};
const facets = {makes:['Toyota','BMW','Mazda'],models:[{make:'Toyota',model:'Corolla'}],bodyTypes:['suv','offroad','sedan','hatchback','wagon','minivan','coupe','convertible','pickup','van'],transmissions:['automatic','manual','cvt','dct'],fuels:['petrol','diesel','hybrid','electric','lpg'],drives:['fwd','rwd','awd']};
createRoot(document.getElementById('root')!).render(<><main className="ac-page-copy ac-cars-page" style={{padding:16,minHeight:'100vh'}}><h1>Каталог автомобилей</h1><p>Найдено: 37 718</p><CatalogFilters initial={initial} facets={facets}/><CatalogFilterUiEnhancer/><div style={{height:600}}>Проверка фильтров</div></main><aside className="ac-notice-stack" aria-label="Выбор города для расчёта" style={{position:'fixed',zIndex:10090,bottom:12,left:12,right:12,height:100,background:'#174b83'}}>Выберите ваш город для точного расчёта</aside></>);
