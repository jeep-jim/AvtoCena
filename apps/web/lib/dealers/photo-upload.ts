"use client";
/** Keep multipart uploads small enough for the hosted request gateway. */
export async function preparePhotoUpload(file: File): Promise<File> {
 if (file.size > 8*1024*1024) throw Error("Размер фотографии — до 8 МБ.");
 if (!/^(image\/(jpeg|png|webp|heic|heif))$/i.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) throw Error("Выберите JPG, PNG, WebP или HEIC.");
 if (file.size <= 1500000) return file;
 const url=URL.createObjectURL(file);
 try {
  const image=new Image();
  await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(Error("Не удалось открыть фото. Сохраните его в JPG и повторите загрузку."));image.src=url;});
  const scale=Math.min(1,2200/Math.max(image.naturalWidth,image.naturalHeight));
  const canvas=document.createElement("canvas");canvas.width=Math.max(1,Math.round(image.naturalWidth*scale));canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
  const context=canvas.getContext("2d");if(!context)throw Error("Не удалось подготовить фото. Попробуйте другое изображение.");
  context.drawImage(image,0,0,canvas.width,canvas.height);
  for(const quality of [.88,.75,.6]) {
   const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/webp",quality));
   if(blob && blob.size<=1500000)return new File([blob],file.name.replace(/\.[^.]+$/,".webp"),{type:blob.type});
  }
  throw Error("Фото слишком большое для отправки. Уменьшите его размер и повторите загрузку.");
 }finally{URL.revokeObjectURL(url);}
}
export async function readPhotoUploadResponse(response: Response) {
 const payload=await response.json().catch(()=>null);
 if(!response.ok) {
  const fallback=response.status===413?"Фото слишком большое для отправки. Уменьшите его размер.":response.status===401||response.status===403?"Нет доступа к загрузке. Проверьте вход в кабинет.":response.status===429?"Слишком много загрузок. Повторите через минуту.":"Сервис загрузки временно недоступен. Повторите попытку.";
  throw Error(typeof payload?.error === "string" ? payload.error : `${fallback} (HTTP ${response.status})`);
 }
 if(!payload?.id || !payload?.url)throw Error("Сервер не подтвердил загрузку. Повторите попытку.");
 return payload;
}
