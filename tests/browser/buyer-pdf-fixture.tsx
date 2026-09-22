import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OfferPdfButton } from '../../apps/web/components/catalog/OfferPdfButton';
import { BuyerGallery } from '../../apps/web/components/home/BuyerGallery';
function App() {
 const [year, setYear] = useState('2020');
 return <main className="mx-auto max-w-6xl p-4"><label>Год <input aria-label="Год автомобиля" value={year} onChange={event => setYear(event.target.value)}/></label><div className="mt-3 hidden w-28 xl:flex"><div data-offer-pdf-slot className="w-full"/></div><OfferPdfButton offerId="qa-preview" draft={{year,engineCc:'1499',fuel:'petrol',powerHp:'150'}}/><BuyerGallery images={Array.from({length:24},(_,i)=>`/buyers/${i+1}.jpg`)}/></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
