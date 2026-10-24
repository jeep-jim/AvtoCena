import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RoutePreloader} from '../../apps/web/components/layout/RoutePreloader';
import {CatalogFilterPending} from '../../apps/web/components/catalog/CatalogFilterPending';
import {CatalogSectionLoading} from '../../apps/web/components/catalog/CatalogLoading';
function Fixture(){const [filter,setFilter]=useState(false),[stream,setStream]=useState(false);return <><RoutePreloader/><button onClick={()=>setFilter(!filter)}>Filter</button><button onClick={()=>setStream(!stream)}>Stream</button><CatalogFilterPending pending={filter}/><CatalogSectionLoading active={stream}/><CatalogSectionLoading active={stream}/><CatalogSectionLoading/></>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
