// Values of credentials, rights, money transfers and hidden controls must never be read or filled.
export const privateField = (name:string)=>/password|passwd|secret|token|api.?key|access.?key|кодовое|пароль|permission|роль|role|csrf|otp|cvv|номер карты|card.?number/i.test(name);
export function safePath(value:unknown){
 if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u001f]/.test(value)||value.length>600)return null;
 const u=new URL(value,'https://avtocena.com');
 if(u.origin!=='https://avtocena.com'||u.pathname.startsWith('/api/')||u.pathname.startsWith('/login'))return null;
 return u.pathname+u.search;
}
