export const vehicleColors = [
 ['Белый','#ffffff','#ffffff'],['Чёрный','#151515','#151515'],['Серый','#81858b','#81858b'],
 ['Серебристый','linear-gradient(135deg,#9299a1,#f0f3f7,#a5adb7)','#c0c5cb'],
 ['Красный','#cf292f','#cf292f'],['Бордовый','#742333','#742333'],['Синий','#2458ac','#2458ac'],
 ['Голубой','#79bce1','#79bce1'],['Зелёный','#33794c','#33794c'],['Оливковый','#7a8046','#7a8046'],
 ['Жёлтый','#f2ce37','#f2ce37'],['Оранжевый','#ed8a2c','#ed8a2c'],['Коричневый','#815338','#815338'],
 ['Бежевый','#d7c3a0','#d7c3a0'],['Золотистый','linear-gradient(135deg,#af8842,#f2d88f,#b39148)','#d6b768'],
 ['Бронзовый','#a77447','#a77447'],['Фиолетовый','#8154a0','#8154a0'],['Розовый','#e394af','#e394af'],
 ['Перламутровый','linear-gradient(135deg,#faf5e9,#e0e9f2,#f6e6eb)','#ecebf0'],
 ['Двухцветный','linear-gradient(135deg,#fff 50%,#20252b 50%)','#81858b'],
] as const;
const key=(value:string)=>value.toLowerCase().replaceAll('ё','е').trim();
const english:Record<string,string>={white:'Белый',black:'Чёрный',gray:'Серый',grey:'Серый',silver:'Серебристый',red:'Красный',blue:'Синий',green:'Зелёный',yellow:'Жёлтый',orange:'Оранжевый',brown:'Коричневый',beige:'Бежевый',gold:'Золотистый',purple:'Фиолетовый',pink:'Розовый'};
export function namedVehicleColor(value:string){const name=english[key(value)]||value;return vehicleColors.find(color=>key(color[0])===key(name));}
export function vehicleColorHex(value:string){return value.match(/#[a-f0-9]{6}\b/i)?.[0].toLowerCase()||namedVehicleColor(value)?.[2]||null;}
export function hsvToHex(h:number,s:number,v:number){s/=100;v/=100;const f=(n:number)=>{const k=(n+h/60)%6;return Math.round(255*(v-v*s*Math.max(0,Math.min(k,4-k,1)))).toString(16).padStart(2,'0');};return '#'+f(5)+f(3)+f(1);}
export function hexToHsv(hex:string){const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255),max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;const h=d===0?0:max===r?60*((g-b)/d%6):max===g?60*((b-r)/d+2):60*((r-g)/d+4);return {h:(h+360)%360,s:max===0?0:d/max*100,v:max*100};}
export function nearestVehicleColor(hex:string){const rgb=(h:string)=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));const [r,g,b]=rgb(hex);return vehicleColors.filter(color=>!color[1].startsWith('linear')).map(color=>{const [cr,cg,cb]=rgb(color[2]);return {name:color[0],distance:2*(r-cr)**2+4*(g-cg)**2+3*(b-cb)**2};}).sort((a,b)=>a.distance-b.distance)[0].name;}
