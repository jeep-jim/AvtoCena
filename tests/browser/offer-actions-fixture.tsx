import React,{useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {OfferDesktopActions,OfferContactActionsStyles} from '../../apps/web/components/catalog/OfferContactActions';
function Fixture(){useEffect(()=>{for(const row of document.querySelectorAll<HTMLElement>('.ac-offer-action-row')){row.dataset.hasCopy='true';row.dataset.hasPdf='true';row.querySelector('[data-offer-copy-slot]')!.innerHTML='<button style="width:56px;height:56px;background:#7939e9;border-radius:16px">🌼</button>';row.querySelector('[data-offer-pdf-slot]')!.innerHTML='<button style="width:100px;height:56px;background:orange;border-radius:16px">PDF</button>';}},[]);return <main className="ac-offer-page" style={{width:'min(960px, calc((100vw - 60px) * .66))',margin:24}}><OfferContactActionsStyles/><OfferDesktopActions position="below" offerId="car" snapshot={{id:'car'}}/></main>}
createRoot(document.getElementById('root')!).render(<Fixture/>);
