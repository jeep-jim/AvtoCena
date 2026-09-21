import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CitySelector} from '../../apps/web/components/home/CitySelector';
import {LeadCityField} from '../../apps/web/components/leads/LeadCityField';
function Fixture(){
 const [city,setCity]=useState(''),[leadCity,setLeadCity]=useState(''),[lead,setLead]=useState(false);
 return <main style={{padding:16}}><h1>Город доставки</h1><CitySelector value={city} onChange={setCity}/><button type="button" onClick={()=>setLead(true)}>Оставить заявку</button>{lead?<section role="dialog" aria-label="Заявка" style={{position:'fixed',inset:0,zIndex:20000,background:'var(--ac-surface)',padding:16}}><label>Имя<input aria-label="Имя" defaultValue="Антон"/></label><LeadCityField value={leadCity} onChange={setLeadCity}/><button onClick={()=>setLead(false)}>Закрыть заявку</button></section>:null}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
