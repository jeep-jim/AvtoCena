import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {OfferParameterEditors} from '../../apps/web/components/catalog/InlineOfferParameters';
import {commercialParameters} from '../../apps/web/lib/catalog/commercial-parameters';
const samples=[
 {market:'uae',make:'Toyota',model:'year 2021 Kilometers 35,202 Kms Regional',trim:'Toyota Hilux ADVENTURE'},
 {market:'korea',make:'SsangYong',model:'Rexton',trim:'Sports Khan'},
 {market:'europe',make:'Volkswagen',model:'Amarok',bodyType:'offroad'},
 {market:'georgia',make:'Ford',model:'F-150'},
 {market:'japan',make:'Toyota',model:'Hilux'},
 {market:'china',make:'Great Wall',model:'King Kong Pao',bodyType:'pickup'},
];
function App(){
 const offer=samples.find(s=>s.market===new URLSearchParams(location.search).get('market'))||samples[0];
 const commercial=commercialParameters(offer);
 const [draft,setDraft]=useState<Record<string,string>>({year:'2022',fuel:'diesel',engineCc:'2400',powerHp:'150',powerKw:'110.32',vehicleCategory:commercial.vehicleCategory,grossVehicleWeightKg:'',n1IceFuel:''});
 return <main style={{maxWidth:480,margin:'20px auto',padding:12}}><OfferParameterEditors draft={draft} change={(key,value)=>setDraft(s=>({...s,[key]:value}))} {...commercial}/><output data-draft>{JSON.stringify(draft)}</output></main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
