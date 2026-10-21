import {PublicLegalFooter} from '../../apps/web/components/layout/PublicLegalFooter';
import {OverlayBackHistory} from '../../apps/web/components/layout/OverlayBackHistory';
import React,{useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {DealerProfileContent} from '../../apps/web/components/dealers/DealerProfileContent';
import {DealerBrowsingProvider} from '../../apps/web/components/dealers/DealerBrowsingContext';
import {CatalogFilters} from '../../apps/web/components/catalog/CatalogFilters';
import {useSelectedCity} from '../../apps/web/lib/location/selected-city';
const dealer:any={id:'external',name:'Тестовая компания',href:new URLSearchParams(location.search).has('canonical')?'/test/canonical':'/test/dealer',markets:['china','japan'],logoLight:'',logoDark:'',preview:false};
const profile:any={dealerId:'external',name:dealer.name,description:'Автомобили под заказ. '+('Помогаем выбрать автомобиль и организовать доставку в ваш город. '.repeat(20)),banner:'',bannerMobile:'',extraBanners:[],logoLight:'',logoDark:'',headerIcon:'',profileEnabled:true,buyersEnabled:false,buyerPhotos:[],catalogMarkets:dealer.markets,specialHeading:'Предложения',offices:[],requisites:{legalName:'',inn:'',ogrn:'',kpp:'',legalAddress:''}};
function Fixture(){
 const [initial,setInitial]=useState(()=>Object.fromEntries(new URLSearchParams(location.search)));const city=useSelectedCity();
 useEffect(()=>{const update=()=>setInitial(Object.fromEntries(new URLSearchParams(location.search)));window.addEventListener('fixture:navigate',update);return()=>window.removeEventListener('fixture:navigate',update);},[]);
 const staff=new URLSearchParams(location.search).get('visitor')!=='1';
 return <DealerBrowsingProvider dealer={dealer} profile><OverlayBackHistory/><DealerProfileContent s={profile} canShareSelection={staff} initialSelectionQuery={new URLSearchParams(initial).toString()} catalog={<div className="dealer-shared-catalog"><CatalogFilters initial={initial} resultCount={12} facets={{makes:['Audi','Honda'],models:[{make:'Audi',model:'Q5'},{make:'Honda',model:'Fit'}],markets:['china','japan'],bodyTypes:['sedan','hatchback'],transmissions:['automatic','cvt'],fuels:['petrol','diesel','electric','hybrid'],drives:['fwd','awd']}}/><p data-city>{city}</p><div style={{height:1400}}>Каталог: Audi Q5 — тестовое предложение</div></div>}/><PublicLegalFooter/></DealerBrowsingProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
