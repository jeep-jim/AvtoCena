import cities from '../location/russian-cities.json';
import {normalizeCitySearch} from '../location/cities';
import type {DeliveryTariff} from './showcase-model';
// Bishkek: https://www.geonames.org/1528675/bishkek.html (42.87, 74.59).
// Distances below are geodesic, not road routes. Used only for a preliminary
// price calibrated with the dealer's quotes; no routing availability is implied.
const locations=[...cities,{city:'Бишкек',value:'Бишкек',region:'Кыргызстан',lat:42.87,lon:74.59}];
const byValue=new Map(locations.map(c=>[normalizeCitySearch(c.value),c]));
const byName=new Map<string,typeof locations>();
for(const c of locations){const key=normalizeCitySearch(c.city);byName.set(key,[...(byName.get(key)||[]),c]);}
export function deliveryLocation(value:string){
 const key=normalizeCitySearch(value),exact=byValue.get(key);
 if(exact)return exact;
 const matches=byName.get(key)||[];
 return matches.length===1?matches[0]:null;
}
export function deliveryDistance(origin:string,destination:string):number|null{
 const a=deliveryLocation(origin),b=deliveryLocation(destination);if(!a||!b)return null;
 const rad=(v:number)=>v*Math.PI/180;
 const h=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lon-a.lon)/2)**2;
 return 6371*2*Math.asin(Math.sqrt(Math.min(1,h)));
}
export function deliveryCalibrationError(origin:string,tariffs:DeliveryTariff[]):string|null{
 const anchors=tariffs.map(t=>({...t,distance:deliveryDistance(origin,t.city)}));
 if(anchors.length<2)return 'Укажите минимум два примера доставки';
 if(anchors.some(t=>t.distance===null||t.distance<100||!(t.usd>0)))return 'Для каждого примера выберите город не ближе 100 км и укажите стоимость';
 const sorted=anchors.sort((a,b)=>a.distance!-b.distance!);
 if(sorted.some((a,i)=>i>0&&a.distance!-sorted[i-1].distance!<1))return 'Выберите города с разными расстояниями от места отправки';
 if(sorted.some((a,i)=>i>0&&a.usd<sorted[i-1].usd))return 'Проверьте примеры: стоимость не должна уменьшаться с расстоянием';
 return null;
}
export function estimateDealerDelivery(origin:string,city:string,tariffs:DeliveryTariff[],automatic=false){
 const key=normalizeCitySearch(city);
 const direct=tariffs.find(t=>normalizeCitySearch(t.city)===key);
 if(direct)return {...direct,estimated:false};
 if(!automatic||!key)return null;
 const distance=deliveryDistance(origin,city);if(distance===null)return null;
 const anchors=tariffs.filter(t=>t.usd>0).map(t=>({...t,distance:deliveryDistance(origin,t.city)})).filter((t):t is DeliveryTariff&{distance:number}=>t.distance!==null&&t.distance>=100).sort((a,b)=>a.distance-b.distance);
 if(anchors.length<2)return null;
 // Reject contradictory anchors rather than producing falling/negative prices.
 if(anchors.some((a,i)=>i>0&&(a.distance-anchors[i-1].distance<1||a.usd<anchors[i-1].usd)))return null;
 let left=anchors[0],right=anchors[1];
 for(let i=1;i<anchors.length;i++){left=anchors[i-1];right=anchors[i];if(distance<=right.distance)break;}
 const usd=distance<anchors[0].distance?anchors[0].usd*distance/anchors[0].distance:left.usd+(right.usd-left.usd)*(distance-left.distance)/(right.distance-left.distance);
 if(!Number.isFinite(usd)||usd<0)return null;
 return {id:'estimate',city:deliveryLocation(city)!.value,usd:Math.round(usd),daysFrom:Math.min(left.daysFrom,right.daysFrom),daysTo:Math.max(left.daysTo,right.daysTo),estimated:true};
}
