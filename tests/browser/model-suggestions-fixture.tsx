import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {VehicleModelSearch} from '../../apps/web/components/catalog/VehicleModelSearch';
function App(){const [make,setMake]=useState(''),[model,setModel]=useState('');return <main style={{padding:20,maxWidth:700,margin:'auto'}}><h1>Поиск модели</h1><VehicleModelSearch multiple value={model} make={make} onMakeChange={setMake} onValueChange={setModel}/><output aria-label="Выбрано">{make} / {model}</output><button onClick={()=>{setMake('');setModel('');}}>Сбросить</button></main>;}
createRoot(document.getElementById('root')!).render(<App/>);
