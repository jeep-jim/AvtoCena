import {MAX_IMAGE_BYTES,photoUrl} from '../../../lib/team-assistant/media';
import type {AssistantImage,AssistantPhoto} from '../../../lib/team-assistant/types';
async function jpeg(source:CanvasImageSource,width:number,height:number,name:string):Promise<AssistantImage>{
 if(!width||!height)throw Error('Не удалось прочитать изображение.');
 const scale=Math.min(1,1920/Math.max(width,height)),canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('Браузер не поддерживает снимки.');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(source,0,0,canvas.width,canvas.height);
 for(const quality of [.88,.72,.55,.35]){const dataUrl=canvas.toDataURL('image/jpeg',quality);if(dataUrl.length<=MAX_IMAGE_BYTES*4/3+23)return {name,dataUrl};}
 throw Error('Изображение слишком большое. Обрежьте его и попробуйте ещё раз.');
}
export async function prepareImage(file:File){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)throw Error('Выберите JPG, PNG или WebP до 15 МБ.');
 const image=await createImageBitmap(file);try{return await jpeg(image,image.width,image.height,file.name);}finally{image.close();}
}
export async function loadDraggedPhoto(photo:AssistantPhoto):Promise<File>{
 const source=new URL(photo.url,location.href);
 const url=photoUrl(source.origin===location.origin?source.pathname+source.search:source.href);if(!url)throw Error('Ссылка на фото недоступна.');
 const response=await fetch(url,{credentials:'same-origin',signal:AbortSignal.timeout(15000)});
 if(!response.ok||!response.body)throw Error('Не удалось загрузить фото. Сохраните его на устройство и прикрепите файлом.');
 const type=response.headers.get('content-type')?.split(';')[0]||'';
 if(!['image/jpeg','image/png','image/webp'].includes(type))throw Error('Прикрепите фото в формате JPG, PNG или WebP.');
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>15*1024*1024)throw Error('Выберите фото до 15 МБ.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 return new File(chunks as BlobPart[],photo.name||'Фото со страницы',{type});
}
export async function captureScreen(){
 if(!navigator.mediaDevices?.getDisplayMedia)throw Error('Сделайте скриншот на устройстве и прикрепите его кнопкой «Фото».');
 const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false});
 const video=document.createElement('video');video.muted=true;video.srcObject=stream;
 try{await video.play();await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Не удалось получить снимок.')),5000);if('requestVideoFrameCallback' in video)video.requestVideoFrameCallback(()=>{clearTimeout(timer);resolve();});else{clearTimeout(timer);resolve();}});return await jpeg(video,video.videoWidth,video.videoHeight,'Снимок экрана.jpg');}
 finally{stream.getTracks().forEach(t=>t.stop());video.srcObject=null;}
}
export async function downloadPhoto(photo:AssistantPhoto){
 const url=photoUrl(photo.url);if(!url)throw Error('Ссылка на фото недоступна.');
 const response=await fetch(url,{credentials:'same-origin',signal:AbortSignal.timeout(20000)});
 if(!response.ok||!response.body)throw Error('Не удалось скачать фото. Откройте оригинал и сохраните его через меню браузера.');
 const type=response.headers.get('content-type')?.split(';')[0]||'';
 if(!['image/jpeg','image/png','image/webp','image/gif','image/avif'].includes(type))throw Error('По этой ссылке нет поддерживаемого изображения.');
 const reader=response.body.getReader(),chunks:Uint8Array[]= [];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>20*1024*1024)throw Error('Фото больше 20 МБ. Откройте оригинал для сохранения.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const blob=new Blob(chunks as BlobPart[],{type}),href=URL.createObjectURL(blob),a=document.createElement('a');a.href=href;a.download=(photo.name.replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,70)||'Фото')+'.'+(type.split('/')[1]==='jpeg'?'jpg':type.split('/')[1]);document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(href),60000);
}
