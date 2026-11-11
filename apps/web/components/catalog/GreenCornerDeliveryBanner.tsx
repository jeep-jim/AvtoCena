"use client";
import {useEffect,useState} from "react";
import {CityPickerDialog,LocationIcon} from "../home/CitySelector";
import {useSelectedCity} from "../../lib/location/selected-city";

export function GreenCornerDeliveryBanner(){
 const city=useSelectedCity();const [closed,setClosed]=useState(false),[picker,setPicker]=useState(false);
 useEffect(()=>{try{setClosed(sessionStorage.getItem('ac-green-delivery-dismissed')==='1');}catch{}},[]);
 if(closed)return null;
 return <aside className="ac-green-delivery" aria-label="Доставка автомобилей в наличии">
  <LocationIcon className="ac-green-delivery-pin"/>
  <p>Доставка {city?'в город ':'до '}<button type="button" onClick={()=>setPicker(true)}>{city||'вашего города'}</button> будет быстрее в среднем на 10 дней, так как эти автомобили не нужно выкупать с аукциона.</p>
  <img src="/avatars/manager-green.webp" alt="" width={128} height={128}/>
  <button type="button" className="ac-green-delivery-close" aria-label="Закрыть баннер доставки" onClick={()=>{setClosed(true);try{sessionStorage.setItem('ac-green-delivery-dismissed','1');}catch{}}}>×</button>
  {picker?<CityPickerDialog onChange={()=>{}} onClose={()=>setPicker(false)}/>:null}
 </aside>;
}
