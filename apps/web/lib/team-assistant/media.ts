import type {AssistantImage,AssistantPhoto} from './types';
export const MAX_IMAGES=4;
export const MAX_IMAGE_BYTES=750000;
export const MAX_REQUEST_BYTES=4300000;
export function photoUrl(raw:unknown):string|null{
 if(typeof raw!=='string'||raw.length>3000||/[\\\u0000-\u001f]/.test(raw))return null;
 if(raw.startsWith('/')&&!raw.startsWith('//'))return raw;
 try{const u=new URL(raw);if(u.protocol!=='https:'||u.username||u.password)return null;return u.href;}catch{return null;}
}
export function cleanPhotos(raw:unknown):AssistantPhoto[]{
 if(!Array.isArray(raw))return [];
 const seen=new Set<string>();return raw.slice(0,30).flatMap(p=>{const url=photoUrl(p?.url);if(!url||seen.has(url))return [];seen.add(url);return [{url,name:String(p.name||'Фото').slice(0,100)}];});
}
export function cleanImages(raw:unknown):AssistantImage[]{
 if(raw===undefined)return [];
 if(!Array.isArray(raw)||raw.length>MAX_IMAGES)throw Error('Прикрепите не больше четырёх изображений.');
 return raw.map(i=>{
  if(typeof i?.dataUrl!=='string'||i.dataUrl.length>MAX_IMAGE_BYTES*4/3+32||!/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(i.dataUrl))throw Error('Изображение не подходит. Выберите фото ещё раз.');
  return {name:String(i.name||'Изображение').replace(/[\u0000-\u001f]/g,'').slice(0,100),dataUrl:i.dataUrl};
 });
}
export async function readAssistantBody(request:Request){
 if(Number(request.headers.get('content-length'))>MAX_REQUEST_BYTES)throw Error('Сообщение слишком большое.');
 const reader=request.body?.getReader();if(!reader)throw Error('Пустое сообщение.');
 const decoder=new TextDecoder();let size=0,text='';
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_REQUEST_BYTES)throw Error('Сообщение слишком большое.');text+=decoder.decode(value,{stream:true});}text+=decoder.decode();return JSON.parse(text);}finally{await reader.cancel().catch(()=>{});}
}
