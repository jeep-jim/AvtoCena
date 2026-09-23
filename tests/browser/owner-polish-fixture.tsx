import React from 'react';
import {CrmShellView} from '../../apps/web/components/crm/CrmShellView';
import CarsLayout from '../../apps/web/app/(public)/cars/layout';
import {createRoot} from 'react-dom/client';
import {PublicHeader} from '../../apps/web/components/layout/PublicHeader';
import {CitySelector} from '../../apps/web/components/home/CitySelector';
import {OfferDesktopActions,OfferMobileActions,OfferContactActionsStyles} from '../../apps/web/components/catalog/OfferContactActions';
import {OfferPdfButton} from '../../apps/web/components/catalog/OfferPdfButton';
import {CatalogBrandMultiSelect} from '../../apps/web/components/catalog/CatalogBrandMultiSelect';
const staff=new URLSearchParams(location.search).get('staff')==='1';
const favorite={offerId:'qa-owner',snapshot:{id:'qa-owner',title:'Honda Test'}};
function App(){return <CarsLayout><PublicHeader/><main style={{paddingTop:96}} className="ac-offer-page mx-auto max-w-[1500px] p-4 md:p-8"><h1 className="text-3xl font-black">HONDA STEPWGN 7SEATS</h1><CitySelector value="" onChange={()=>{}}/><div className="mt-6 max-w-[960px]"><OfferDesktopActions {...favorite} position="below"/><OfferMobileActions {...favorite}/><div data-spec-desktop data-open="false"/><div style={{width:390,maxWidth:"100%"}}><OfferDesktopActions {...favorite}/></div>{staff?<OfferPdfButton offerId="qa-owner" draft={{year:'2026'}}/>:null}</div><div className="ac-mobile-filter-sheet mt-6 max-w-sm"><CatalogBrandMultiSelect value="" options={[{value:'Abarth',label:'Abarth'},{value:'Acura',label:'Acura'}]} contextQuery="" onChange={()=>{}}/></div><OfferContactActionsStyles/></main></CarsLayout>}
const crmLinks=[['/crm','Обзор'],['/crm/leads','Заявки'],['/crm/clients','Клиенты'],['/crm/managers','Команда и права'],['/crm/settings','Рынки и расчёт'],['/crm/dealers','Дилеры'],['/crm/telegram','Telegram']] as const;
createRoot(document.getElementById('root')!).render(new URLSearchParams(location.search).has('crm')?<CrmShellView title="Рынки и расчёт" subtitle="Настройки" activeHref="/crm/settings" user={{id:'owner',role:'owner',displayName:'Owner'}} links={[...crmLinks]} avatar="/logo/avtocena-mark-light.svg"><div/></CrmShellView>:<App/>);
