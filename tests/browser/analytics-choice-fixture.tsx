import React, {useState} from 'react';
import {createRoot,hydrateRoot} from 'react-dom/client';
import {renderToString} from 'react-dom/server';
import {Autobot} from '../../apps/web/components/autobot/Autobot';
import {PublicLegalFooter} from '../../apps/web/components/layout/PublicLegalFooter';
import {AnalyticsChoiceNotice} from '../../apps/web/components/analytics/AnalyticsChoiceNotice';
import {PublicHeader} from '../../apps/web/components/layout/PublicHeader';
import {EditorialHeader} from '../../apps/web/components/layout/EditorialHeader';
import {StickyCatalogControls} from '../../apps/web/components/catalog/StickyCatalogControls';
import {OfferMobileActions,OfferContactActionsStyles} from '../../apps/web/components/catalog/OfferContactActions';
import {LocalDirectory} from '../../apps/web/components/encyclopedia/LocalDirectory';
import '../../apps/web/components/catalog/catalog-sidebar.css';
import '../../apps/web/app/(public)/cars/autocatalog/encyclopedia.css';
function App(){
 const [route,setRoute]=useState(location.pathname);
 const go=(path:string)=>{history.pushState(null,'',path);setRoute(path);window.dispatchEvent(new Event('fixture-route'));window.scrollTo(0,0);};
 const editorial=route==='/cars/autocatalog'||route==='/blog';
 return <><AnalyticsChoiceNotice/>{editorial&&<EditorialHeader backHref="/"/>}<main className={`ac-page-copy ${route==='/cars/autocatalog'?'ac-ency-page':''}`}>
 {!editorial&&<PublicHeader/>}<div style={{padding:16}}><h1>Проверка cookie и шапки</h1><nav>{['/','/cars','/cars/autocatalog','/blog','/cars/offer/test','/privacy/request'].map(path=><button key={path} onClick={()=>go(path)} data-route={path}>{path}</button>)}</nav>
 {route==='/cars'&&<><StickyCatalogControls chips={[]} sort="" onRemove={()=>{}} onSort={()=>{}} onOpenFilters={()=>{}}/><div className="ac-catalog-layout"><aside className="ac-catalog-sidebar"><button>Фильтры</button></aside><div className="ac-catalog-results"><div className="ac-catalog-toolbar"><button>Сортировка</button></div><div style={{height:2000}}>Автомобили</div></div></div></>}
 {route==='/cars/autocatalog'&&<LocalDirectory data={{models:[],specs:[]}} canEdit={false}/>}
 {route==='/cars/offer/test'&&<><OfferContactActionsStyles/><div style={{height:400}}/><OfferMobileActions offerId="test" snapshot={{title:'Тестовый автомобиль',imageUrl:''}}/></>}
 <div style={{height:2000}}/></div></main><PublicLegalFooter/><Autobot/></>;
}
const container=document.getElementById('root')!;
if(new URLSearchParams(location.search).has('hydrate')){
 // esbuild does not run Next's styled-jsx transform. Decode only style text
 // escaped by renderToString so fixture hydration matches the compiled Next styles.
 container.innerHTML=renderToString(<App/>).replace(/<style([^>]*)>([\s\S]*?)<\/style>/g,(_,attrs,css)=>`<style${attrs}>${css.replaceAll('&gt;','>').replaceAll('&lt;','<').replaceAll('&quot;','"').replaceAll('&#x27;',"'").replaceAll('&amp;','&')}</style>`);
 (window as any).hydrateFixture=()=>hydrateRoot(container,<App/>);
}else createRoot(container).render(<App/>);
