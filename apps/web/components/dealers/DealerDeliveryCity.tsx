'use client';
import {useId} from 'react';
import {searchRussianCities} from '@/lib/location/cities';
import {input} from './DealerEditorFields';
export function DealerDeliveryCity({label,value,onChange,invalid=false}:{invalid?:boolean;label:string;value:string;onChange:(v:string)=>void}){
 const id=useId();const options=searchRussianCities(value,20);
 return <label className="grid gap-2 text-sm"><span className="dealer-city-label">{label}</span><input aria-invalid={invalid||undefined} aria-label={label} className={input} list={id} value={value} onChange={e=>onChange(e.target.value)} autoComplete="off"/><datalist id={id}><option value="Бишкек"/>{options.map(c=><option key={c.value} value={c.value}>{c.region}</option>)}</datalist></label>;
}
