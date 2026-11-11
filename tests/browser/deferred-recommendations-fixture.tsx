import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DeferredOfferRecommendations} from '../../apps/web/components/catalog/DeferredOfferRecommendations';
import {DealerBrowsingProvider} from '../../apps/web/components/dealers/DealerBrowsingContext';

function Fixture(){
  const [id,setId]=useState('first');
  const kind=new URLSearchParams(location.search).has('alternatives')?'alternatives':'related';
  useEffect(()=>{document.documentElement.dataset.ready='true';},[]);
  return <DealerBrowsingProvider dealer={{id:'dealer_topavto',name:'Top Avto',logoLight:'',logoDark:'',href:'/dealers/dealer_topavto',preview:false,markets:['china','japan']}}>
    <header style={{position:'fixed',top:0,zIndex:99,background:'white'}}><button id="next-offer" onClick={()=>setId('second')}>Другая карточка</button></header>
    <main><h1>Основная карточка</h1><div style={{height:2000}}>Цена и характеристики доступны сразу</div><DeferredOfferRecommendations offerId={id} markets={['china','japan']} kind={kind}/></main>
  </DealerBrowsingProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
