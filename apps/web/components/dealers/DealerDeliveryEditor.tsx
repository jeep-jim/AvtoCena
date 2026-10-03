'use client';
import {Plus,Trash2} from 'lucide-react';
import {useEffect,useRef,useState} from 'react';
import {DealerDeliveryCity} from './DealerDeliveryCity';
import {Field,button} from './DealerEditorFields';
import {estimateDealerDelivery,deliveryDistance,deliveryLocation,deliveryCalibrationError} from '@/lib/dealers/delivery-estimate';
import {normalizeCitySearch} from '@/lib/location/cities';
import type {DealerShowcase,DeliveryTariff} from '@/lib/dealers/showcase-model';
const empty=():DeliveryTariff=>({id:crypto.randomUUID(),city:'',usd:0,daysFrom:5,daysTo:10});
const padded=(rows:DeliveryTariff[])=>[...rows,...Array.from({length:Math.max(0,2-rows.length)},empty)];
export function DealerDeliveryEditor({value,city,onCityChange,onChange}:{value:DealerShowcase['pricing'];city:string;onCityChange:(city:string)=>void;onChange:(v:Partial<DealerShowcase['pricing']>)=>void;defaultDestination?:boolean}){
 const [rows,setRows]=useState(()=>padded(value.tariffs));
 const sent=useRef(JSON.stringify(value.tariffs));
 useEffect(()=>{const next=JSON.stringify(value.tariffs);if(next!==sent.current){sent.current=next;setRows(padded(value.tariffs));}},[value.tariffs]);
 const origin=value.originCity||'Бишкек';
 function change(next:DeliveryTariff[]){setRows(next);const tariffs=next.filter(t=>t.city.trim());sent.current=JSON.stringify(tariffs);onChange({tariffs,distancePricing:true});}
 function edit(id:string,patch:Partial<DeliveryTariff>){change(rows.map(t=>t.id===id?{...t,...patch}:t));}
 const estimate=estimateDealerDelivery(origin,city,rows,true);
 const distances=rows.map(t=>deliveryDistance(origin,t.city));
 const calibrationError=deliveryCalibrationError(origin,rows);
 return <div className="dealer-delivery-editor">
  <div className="dealer-pricing-heading"><div><h4>Расчёт доставки по России</h4><p className="dealer-pricing-note">Один город отправки → минимум два примера доставки</p></div><button type="button" className="dealer-route-add" onClick={()=>setRows([...rows,empty()])}><Plus size={19}/><span>Добавить город</span></button></div>
  <DealerDeliveryCity label="Откуда" value={origin} invalid={!deliveryLocation(origin)} onChange={originCity=>onChange({originCity,distancePricing:true})}/>
  <p className="dealer-pricing-note">Укажите минимум два города на разных расстояниях от места отправки — не ближе 100 км — и стоимость доставки в каждый. По этим примерам рассчитаем стоимость для города покупателя.</p>
  <div className="dealer-delivery-anchors">{rows.map((t,i)=><fieldset key={t.id} className="rounded-2xl border border-[var(--ac-border)] p-4 space-y-3"><legend className="px-2 text-sm font-bold">Пример доставки {i+1}</legend><div className="grid grid-cols-2 gap-3"><DealerDeliveryCity label={`Город ${i+1}`} value={t.city} invalid={distances[i]===null||distances[i]!<100||rows.some((r,j)=>j!==i&&normalizeCitySearch(r.city)===normalizeCitySearch(t.city))} onChange={city=>edit(t.id,{city})}/><Field label={`Стоимость ${i+1}, $`} type="number" value={t.usd} invalid={!(t.usd>0)} onChange={usd=>edit(t.id,{usd})}/><Field label={`От, дней (${i+1})`} type="number" value={t.daysFrom} onChange={daysFrom=>edit(t.id,{daysFrom})}/><Field label={`До, дней (${i+1})`} type="number" value={t.daysTo} onChange={daysTo=>edit(t.id,{daysTo})}/></div><p className="dealer-pricing-note">{distances[i]!==null?`Расстояние между городами: ${Math.round(distances[i]!)} км. Для примера нужно от 100 км.`:'Выберите город из списка.'}</p>{rows.length>2&&<button type="button" className={button} aria-label={`Удалить тариф ${t.city||'без города'}`} onClick={()=>change(rows.filter(r=>r.id!==t.id))}><Trash2 size={16}/> Удалить пример</button>}</fieldset>)}</div>
  {calibrationError&&<p className="text-sm text-red-500">{calibrationError}</p>}
  <DealerDeliveryCity label="Город для проверки расчёта" value={city} onChange={onCityChange}/>
  <p className="dealer-pricing-note">{estimate?`${estimate.estimated?'Ориентировочно':'По тарифу'}: ${estimate.usd.toLocaleString('ru-RU')} $ · ${estimate.daysFrom}–${estimate.daysTo} дней`:'Для расчёта нужны известные города, разные расстояния и цены, не уменьшающиеся с расстоянием.'}</p>
  <p className="dealer-pricing-note">Примеры общие для автомобилей компании. Покупатель увидит доставку в свой город. Оценка по расстоянию между городами требует подтверждения перевозчика.</p>
 </div>;
}
