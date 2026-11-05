import React from 'react';
import {createRoot} from 'react-dom/client';
import {DealerDirectory} from '../../apps/web/components/dealers/DealerDirectory';
import {DealerBrowsingProvider} from '../../apps/web/components/dealers/DealerBrowsingContext';
import FavoritesPage from '../../apps/web/components/catalog/FavoritesContent';
const dealer={id:'dealer_topavto',name:'Топ Авто',description:'Подбор и доставка автомобилей',banner:'/dealers/topavto-banner-v3.webp',logoLight:'/brands/topavto-logo-black.png',logoDark:'/brands/topavto-logo.png',href:'/nvkz/topavto',cities:['Новокузнецк'],verified:true};
createRoot(document.getElementById('root')!).render(location.pathname==='/favorites'?<DealerBrowsingProvider dealer={new URLSearchParams(location.search).has('dealer')?{...dealer,preview:false,markets:[]}:null}><FavoritesPage/></DealerBrowsingProvider>:<DealerDirectory dealers={[dealer]}/>);
