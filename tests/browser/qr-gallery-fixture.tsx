import React from 'react';
import {createRoot} from 'react-dom/client';
import {VehicleGallery} from '../../apps/web/components/catalog/VehicleGallery';
import {PublicLegalFooter} from '../../apps/web/components/layout/PublicLegalFooter';
const photos=[1,2,3,4,5].map(n=>`/buyers/webp/${n}-1280.webp`);
createRoot(document.getElementById('root')!).render(<><main className="mx-auto max-w-4xl p-4"><h1 className="text-2xl font-bold">Автомобиль — проверка галереи</h1><span data-offer-saved-version="qa-saved"/><VehicleGallery images={[...photos,'/pdf-flags/japan.svg']} title="Автомобиль" auctionSheetUrls={['/pdf-flags/japan.svg']} offerId="qr-gallery-test" snapshot={{id:'qr-gallery-test',title:'Автомобиль',imageUrl:photos[0]}}/></main><PublicLegalFooter/></>);
