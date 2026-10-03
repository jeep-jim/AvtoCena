import React from 'react';
import {createRoot} from 'react-dom/client';
import {DealerDirectory} from '../../apps/web/components/dealers/DealerDirectory';
import FavoritesPage from '../../apps/web/app/(public)/favorites/page';
const dealer={id:'dealer_topavto',name:'Топ Авто',description:'Подбор и доставка автомобилей',logoLight:'/brands/topavto-logo-black.png',logoDark:'/brands/topavto-logo.png',href:'/nvkz/topavto',cities:['Новокузнецк'],verified:true};
createRoot(document.getElementById('root')!).render(location.pathname==='/favorites'?<FavoritesPage/>:<DealerDirectory dealers={[dealer]}/>);
