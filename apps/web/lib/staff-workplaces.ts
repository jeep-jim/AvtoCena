export const REMOTE_WORKPLACE='Удалённо';
export function parseWorkAddresses(value:unknown):string[]{
 if(typeof value==='string'){try{value=JSON.parse(value);}catch{throw Error('Проверьте список адресов.');}}
 if(!Array.isArray(value)||value.length>10||value.some(v=>typeof v!=='string'||v.trim().length>240))throw Error('Укажите не более 10 адресов, до 240 символов каждый.');
 const addresses=value.map(v=>(v as string).trim().replace(/\s+/g,' ')).filter(Boolean);
 if(addresses.some(a=>a.toLocaleLowerCase('ru-RU')===REMOTE_WORKPLACE.toLocaleLowerCase('ru-RU')))throw Error('Для удалённой работы используйте отдельный переключатель.');
 return addresses.filter((a,i)=>addresses.findIndex(b=>a.toLocaleLowerCase('ru-RU')===b.toLocaleLowerCase('ru-RU'))===i);
}
export function workOptions(person?:{workAddresses?:string[];remoteWork?:boolean}){return [...(person?.workAddresses||[]),...(person?.remoteWork?[REMOTE_WORKPLACE]:[])];}
