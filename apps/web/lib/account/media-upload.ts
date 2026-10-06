import {createHmac,randomUUID,timingSafeEqual} from 'node:crypto';
import {getJsonStorage} from '@/lib/data';
import {ACCOUNT_MEDIA_CHUNK,validateAccountMedia} from './media-format';
type Ticket={id:string;owner:string;name:string;type:string;size:number;expires:number};
const prefix='settings/account-media-pending/';
function secret(){const value=process.env.AUTH_SECRET||process.env.NEXTAUTH_SECRET;if(!value&&process.env.NODE_ENV==='production')throw Error('Загрузка временно недоступна');return value||'avtocena-dev-media';}
function signature(payload:string){return createHmac('sha256',secret()).update(payload).digest('base64url');}
export function createMediaTicket(owner:string,file:{name:string;type:string;size:number}){
 validateAccountMedia(file);
 if(file.name.length>255||file.type.length>100)throw Error('Слишком длинное имя файла');
 const payload=Buffer.from(JSON.stringify({...file,owner,id:randomUUID(),expires:Date.now()+3600000})).toString('base64url');
 return `${payload}.${signature(payload)}`;
}
export function readMediaTicket(token:string,owner:string):Ticket{
 if(token.length>2048)throw Error('Начните загрузку заново');
 const [payload,sig,...rest]=token.split('.');const expected=signature(payload||'');
 if(rest.length||!sig||sig.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))throw Error('Начните загрузку заново');
 const ticket=JSON.parse(Buffer.from(payload,'base64url').toString()) as Ticket;
 if(ticket.owner!==owner||ticket.expires<Date.now()||!/^[-a-f0-9]{36}$/.test(ticket.id))throw Error('Начните загрузку заново');
 validateAccountMedia(ticket);return ticket;
}
const count=(ticket:Ticket)=>Math.ceil(ticket.size/ACCOUNT_MEDIA_CHUNK);
const key=(ticket:Ticket,index:number)=>`${prefix}${ticket.id}/${index}`;
export async function storeMediaPart(ticket:Ticket,index:number,bytes:Buffer){
 const expected=Math.min(ACCOUNT_MEDIA_CHUNK,ticket.size-index*ACCOUNT_MEDIA_CHUNK);
 if(!Number.isInteger(index)||index<0||index>=count(ticket)||bytes.length!==expected)throw Error('Часть файла не загрузилась. Повторите загрузку');
 const storage=getJsonStorage();if(!storage.putBinary)throw Error('Загрузка временно недоступна');
 await storage.putBinary(key(ticket,index),bytes,'application/octet-stream');
}
export async function joinMediaParts(ticket:Ticket){
 const storage=getJsonStorage();if(!storage.getBinary)throw Error('Загрузка временно недоступна');
 const parts:Buffer[]=[];
 for(let i=0;i<count(ticket);i++){
  const part=await storage.getBinary(key(ticket,i));
  if(part.data.length!==Math.min(ACCOUNT_MEDIA_CHUNK,ticket.size-i*ACCOUNT_MEDIA_CHUNK))throw Error('Файл загрузился не полностью. Повторите загрузку');
  parts.push(part.data);
 }
 return Buffer.concat(parts,ticket.size);
}
export async function removeMediaParts(ticket:Ticket){
 const storage=getJsonStorage();if(!storage.deleteBinary)return;
 await Promise.allSettled(Array.from({length:count(ticket)},(_,i)=>storage.deleteBinary!(key(ticket,i))));
}
/** Collect interrupted uploads on the next upload, after their one-hour ticket expires. */
export async function cleanExpiredMediaParts(){
 const storage=getJsonStorage();if(!storage.listObjects||!storage.deleteBinary)return;
 const objects=await storage.listObjects(prefix);
 const expired=objects.filter(o=>o.key.startsWith(prefix)&&o.lastModified&&Date.parse(o.lastModified)<Date.now()-2*3600000);
 for(const object of expired)await storage.deleteBinary(object.key);
}
