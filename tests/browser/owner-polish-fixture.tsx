import React from 'react';
import {createRoot} from 'react-dom/client';
import {PublicHeader} from '../../apps/web/components/layout/PublicHeader';
import {CitySelector} from '../../apps/web/components/home/CitySelector';
import {OfferDesktopActions,OfferMobileActions,OfferContactActionsStyles} from '../../apps/web/components/catalog/OfferContactActions';
import {OfferPdfButton} from '../../apps/web/components/catalog/OfferPdfButton';
import {CatalogBrandMultiSelect} from '../../apps/web/components/catalog/CatalogBrandMultiSelect';
const staff=new URLSearchParams(location.search).get('staff')==='1';
const favorite={offerId:'qa-owner',snapshot:{id:'qa-owner',title:'Honda Test'}};
function App(){return <><PublicHeader/><main className="ac-offer-page mx-auto max-w-[1500px] p-4 md:p-8"><CitySelector value="" onChange={()=>{}}/><div className="mt-6 max-w-[960px]"><OfferDesktopActions {...favorite} position="below"/><OfferMobileActions {...favorite}/>{staff?<OfferPdfButton offerId="qa-owner" draft={{year:'2026'}}/>:null}</div><div className="mt-6 max-w-sm"><CatalogBrandMultiSelect value="" options={[{value:'Abarth',label:'Abarth'},{value:'Acura',label:'Acura'}]} contextQuery="" onChange={()=>{}}/></div><OfferContactActionsStyles/></main></>}
createRoot(document.getElementById('root')!).render(<App/>);
