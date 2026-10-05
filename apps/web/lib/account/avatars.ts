const people = (start:number,group:string,label:string) => Array.from({length:6},(_,i)=>({id:`character-${start+i}`,url:`/avatars/customers/character-${start+i}.svg`,label:`${label} ${i+1}`,group}));
const cars = (group:string,label:string) => Array.from({length:6},(_,i)=>({id:`${group}-${i+1}`,url:`/avatars/customers/${group}-${i+1}.svg`,label:`${label} ${i+1}`,group}));
export const CUSTOMER_AVATARS=[...people(11,'women','Женский портрет'),...people(1,'men','Мужской портрет'),...cars('city-cars','Городской автомобиль'),...cars('offroad-cars','Внедорожник')];
export const DEFAULT_CUSTOMER_AVATAR='/key-logo.png';
// Previously selected portraits remain valid even when not in the new picker.
export function customerAvatar(_seed:string,avatarId?:string){if(avatarId&&/^character-([1-9]|1[0-9]|20)$/.test(avatarId))return `/avatars/customers/${avatarId}.svg`;return CUSTOMER_AVATARS.find(a=>a.id===avatarId)?.url||DEFAULT_CUSTOMER_AVATAR;}
export function validCustomerAvatar(id:unknown){return typeof id==='string'&&(id==='key'||/^character-([1-9]|1[0-9]|20)$/.test(id)||CUSTOMER_AVATARS.some(a=>a.id===id));}
