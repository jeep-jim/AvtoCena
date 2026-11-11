import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RoutePreloader} from '../../apps/web/components/layout/RoutePreloader';
import {CatalogFilterPending} from '../../apps/web/components/catalog/CatalogFilterPending';
import {CatalogSectionLoading} from '../../apps/web/components/catalog/CatalogLoading';
function Fixture(){const [filter,setFilter]=useState(false),[stream,setStream]=useState(false);return <><RoutePreloader/><button onClick={()=>setFilter(!filter)}>Filter</button><button onClick={()=>setStream(!stream)}>Stream</button><form data-no-route-loader="true" onSubmit={event=>event.preventDefault()}><input aria-label="Цена"/><button type="submit">Submit filter</button></form><a href="/cars/offer/fixture">Plain car link</a><div id="unrelated-updates"/><CatalogFilterPending pending={filter}/><CatalogSectionLoading active={stream}/><CatalogSectionLoading active={stream}/><CatalogSectionLoading/></>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
