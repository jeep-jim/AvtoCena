export const ACCOUNT_MEDIA_CHUNK = 2 * 1024 * 1024;
export function isAccountVideo(file: {type:string;name:string}) {
  return ['video/mp4','video/quicktime','video/x-m4v','video/webm'].includes(file.type.toLowerCase()) || ((!file.type||file.type==='application/octet-stream') && /\.(mp4|mov|m4v|webm)$/i.test(file.name));
}
export function validateAccountMedia(file:{type:string;name:string;size:number}) {
  const video=isAccountVideo(file);
  if(!video&&!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Выберите JPG, PNG, WebP, MP4, MOV, M4V или WebM');
  if(!Number.isSafeInteger(file.size)||file.size<=0||file.size>(video?32:8)*1024*1024)throw Error('Размер видео — до 32 МБ, фото — до 8 МБ');
  return video;
}
