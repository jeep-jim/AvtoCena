import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CatalogBrandMultiSelect} from '../../apps/web/components/catalog/CatalogBrandMultiSelect';
import {VehicleModelSearch} from '../../apps/web/components/catalog/VehicleModelSearch';
function App(){const params=new URLSearchParams(location.search),market=params.get('market')||'',emptyFacets=params.get('facets')==='empty';const [make,setMake]=useState(''),[model,setModel]=useState('');return <main style={{padding:20,maxWidth:700,margin:'auto'}}><h1>Поиск модели</h1><VehicleModelSearch multiple sourceItems={emptyFacets?[]:undefined} contextQuery={market?`market=${market}${market==='japan'?'&source=ajes':''}`:""} value={model} make={make} onMakeChange={setMake} onValueChange={setModel}/><CatalogBrandMultiSelect value={make} options={[]} contextQuery={market?`market=${market}`:""} onChange={setMake}/><output aria-label="Выбрано">{make} / {model}</output><button onClick={()=>{setMake("Toyota");setModel("");}}>Toyota</button><button onClick={()=>{setMake('');setModel('');}}>Сбросить</button></main>;}
createRoot(document.getElementById('root')!).render(<App/>);
