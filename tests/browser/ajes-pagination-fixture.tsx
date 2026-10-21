import React from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogLoadMore} from '../../apps/web/components/catalog/CatalogLoadMore';
const params=new URLSearchParams(location.search),market=params.get('market')||'china';
createRoot(document.getElementById('root')!).render(<CatalogLoadMore query={{market,make:'Volkswagen',bodyType:'suv'}} initialPage={1} initialTotal={market==='china'?null:345} initialCount={24} initialCards={<div>Первые 24 автомобиля</div>} initialHasMore initialNextCursor={market==='china'?'6.20':undefined}/>);
