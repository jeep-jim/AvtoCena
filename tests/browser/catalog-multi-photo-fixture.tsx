import {DealerBrowsingProvider} from '../../apps/web/components/dealers/DealerBrowsingContext';
import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogFilters} from '../../apps/web/components/catalog/CatalogFilters';
import {OverlayBackHistory} from '../../apps/web/components/layout/OverlayBackHistory';
import {Photos} from '../../apps/web/components/dealers/DealerEditorFields';
function App(){const [initial,setInitial]=useState<Record<string,string>>({});useEffect(()=>{const update=(event:Event)=>setInitial(Object.fromEntries(new URL((event as CustomEvent).detail,location.origin).searchParams));window.addEventListener('fixture-server',update);return()=>window.removeEventListener('fixture-server',update);},[]);const [photos,setPhotos]=useState<any[]>([]);return <main style={{padding:16}}><OverlayBackHistory/><CatalogFilters initial={initial} facets={{makes:['Toyota','Kia'],models:[]}}/><Photos dealerId="dealer_topavto" value={photos} onChange={setPhotos}/><output data-photos>{photos.length}</output></main>}
createRoot(document.getElementById('root')!).render(<DealerBrowsingProvider dealer={{id:'dealer_topavto',name:'Top Avto',logoLight:'',logoDark:'',href:'/dealers/dealer_topavto?preview=1',preview:true,markets:['japan','china','korea','uae','europe','georgia']}}><App/></DealerBrowsingProvider>);
