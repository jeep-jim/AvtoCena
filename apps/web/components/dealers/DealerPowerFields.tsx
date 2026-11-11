'use client';
import {useEffect,useRef,useState} from 'react';
import {Field} from './DealerEditorFields';
const ratio=.73549875;
export function DealerPowerFields({value,onChange}:{value:number;onChange:(hp:number)=>void}){
 const [kw,setKw]=useState(value?String(Number((value*ratio).toFixed(8))):'');
 const last=useRef(value);
 useEffect(()=>{if(value!==last.current){last.current=value;setKw(value?String(Number((value*ratio).toFixed(8))):'');}},[value]);
 return <div className="dealer-power-pair"><Field label="Мощность ДВС / ЭВ, л.с." type="number" value={Math.round(value)} invalid={!(value>0)} onChange={hp=>{last.current=hp;setKw(hp?String(Number((hp*ratio).toFixed(8))):'');onChange(hp);}}/><span aria-hidden="true">/</span><Field label="Мощность ДВС / ЭВ, кВт" value={kw} invalid={!(value>0)} onChange={raw=>{setKw(raw);const n=Number(raw.replace(',','.'));if(Number.isFinite(n)&&n>=0){last.current=n?Number((n/ratio).toFixed(8)):0;onChange(last.current);}}}/></div>;
}
