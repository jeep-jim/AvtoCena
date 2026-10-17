import {ACCOUNT_MEDIA_CHUNK,validateAccountMedia} from './media-format';
async function result(response:Response){
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw Error(typeof data?.error==='string'?data.error:response.status===413?'Файл слишком большой для отправки. Обновите страницу и повторите загрузку':'Не удалось загрузить файл. Попробуйте ещё раз');
 return data;
}
export async function uploadAccountMedia(file:File,progress:(percent:number)=>void){
 validateAccountMedia(file);
 const endpoint='/api/crm/site-media';
 const command=(body:unknown)=>fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}).then(result);
 const {token}=await command({action:'start',name:file.name,type:file.type,size:file.size});
 try{
  for(let offset=0,index=0;offset<file.size;offset+=ACCOUNT_MEDIA_CHUNK,index++){
   const form=new FormData();form.set('file',file.slice(offset,offset+ACCOUNT_MEDIA_CHUNK),'part');
   await result(await fetch(endpoint,{method:'POST',headers:{'x-media-upload':token,'x-media-part':String(index)},body:form}));
   progress(Math.round(Math.min(offset+ACCOUNT_MEDIA_CHUNK,file.size)/file.size*100));
  }
  return await command({action:'finish',token});
 }catch(error){await command({action:'cancel',token}).catch(()=>{});throw error;}
}
