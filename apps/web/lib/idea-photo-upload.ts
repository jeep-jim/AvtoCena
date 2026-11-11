'use client';
// Five screenshots plus text stay below the hosted gateway request limit.
export async function prepareIdeaScreenshot(file:File):Promise<File>{
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)throw Error('Выберите PNG, JPG или WebP до 5 МБ.');
 if(file.size<=450000)return file;
 const url=URL.createObjectURL(file);
 try{
  const image=new Image();await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(Error('Не удалось открыть скриншот.'));image.src=url;});
  const canvas=document.createElement('canvas'),context=canvas.getContext('2d');if(!context)throw Error('Не удалось подготовить скриншот.');
  let scale=Math.min(1,2400/Math.max(image.naturalWidth,image.naturalHeight));
  for(let attempt=0;attempt<6;attempt++,scale*=.8){
   canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
   context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
   for(const type of ['image/webp','image/jpeg'])for(const quality of [.9,.8,.7]){
    const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,type,quality));
    if(blob&&blob.type===type&&blob.size<=450000)return new File([blob],file.name.replace(/\.[^.]+$/,'')+(type==='image/webp'?'.webp':'.jpg'),{type});
   }
  }
  throw Error('Не удалось уменьшить скриншот для отправки.');
 }finally{URL.revokeObjectURL(url);}
}
