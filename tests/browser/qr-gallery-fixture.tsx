import React, {useEffect, useState} from 'react';
import {CatalogFilters} from '../../apps/web/components/catalog/CatalogFilters';
import {createRoot} from 'react-dom/client';
import {VehicleGallery} from '../../apps/web/components/catalog/VehicleGallery';
import {PublicLegalFooter} from '../../apps/web/components/layout/PublicLegalFooter';
const photos=[1,2,3,4,5].map(n=>`/buyers/${n}.jpg`);
function FilterDemo(){const [initial,setInitial]=useState(()=>Object.fromEntries(new URLSearchParams(location.search)));useEffect(()=>{const sync=()=>setInitial(Object.fromEntries(new URLSearchParams(location.search)));window.addEventListener('popstate',sync);return()=>window.removeEventListener('popstate',sync);},[]);return <CatalogFilters initial={initial}/>;}
createRoot(document.getElementById('root')!).render(['/filters','/cars'].includes(location.pathname) ? <FilterDemo/> : <><main className="mx-auto max-w-4xl p-4"><h1 className="text-2xl font-bold">Автомобиль — проверка галереи</h1><span data-offer-saved-version="qa-saved"/><VehicleGallery images={[...photos,'/buyers/6.jpg']} title="Автомобиль" auctionSheetUrls={['/buyers/6.jpg']} offerId="qr-gallery-test" snapshot={{id:'qr-gallery-test',title:'Автомобиль',imageUrl:photos[0]}}/></main><PublicLegalFooter/></>);
