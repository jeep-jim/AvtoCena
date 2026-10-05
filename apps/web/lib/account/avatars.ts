export const CUSTOMER_AVATARS=Array.from({length:20},(_,i)=>({id:`character-${i+1}`,url:`/avatars/customers/character-${i+1}.svg`,label:`Персонаж ${i+1}`}));
export function customerAvatar(seed:string,avatarId?:string){return CUSTOMER_AVATARS.find(a=>a.id===avatarId)?.url||CUSTOMER_AVATARS[Array.from(seed).reduce((n,c)=>(n*31+c.charCodeAt(0))>>>0,0)%20].url;}
export function validCustomerAvatar(id:unknown){return typeof id==='string'&&CUSTOMER_AVATARS.some(a=>a.id===id);}
