import {createHash} from 'node:crypto';
import {getCurrentUser} from '@/lib/auth';
import {canEditCatalog} from '@/lib/catalog/editorial-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {readAccountJson,readAccountUpload} from '@/lib/account/request';
import {downloadDealerImage,prepareDealerImage} from '@/lib/dealers/media';
import {getJsonStorage} from '@/lib/data';
export const runtime='nodejs';
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};
 if(!canEditCatalog(await getCurrentUser())||!isCalculationOriginAllowed(request))return Response.json({error:'Доступ запрещён.'},{status:403,headers});
 const fromUrl=request.headers.get('content-type')?.toLowerCase().startsWith('application/json');
 try{
  let bytes:Buffer;
  if(fromUrl){
   const {url}=await readAccountJson(request);
   if(typeof url!=='string'||url.length>2048)throw Error('invalid_url');
   bytes=await downloadDealerImage(url.trim());
  }else{
   const file=(await readAccountUpload(request,1_600_000,'Уменьшите фотографию до 1,5 МБ.')).get('file');
   if(!(file instanceof File)||!/^image\/(jpeg|png|webp)$/.test(file.type))return Response.json({error:'Выберите JPG, PNG или WebP.'},{status:400,headers});
   bytes=Buffer.from(await file.arrayBuffer());
  }
  const image=await prepareDealerImage(bytes);
  const id=createHash('sha256').update(image).digest('hex');
  const storage=getJsonStorage();if(!storage.putBinary)throw Error('storage_unavailable');
  await storage.putBinary(`settings/account-media/${id}.webp`,image,'image/webp');
  return Response.json({id,url:`/api/site-media/${id}`},{headers});
 }catch{return Response.json({error:fromUrl?'Не удалось загрузить фото по ссылке. Нужна прямая HTTPS-ссылка на JPG, PNG или WebP до 8 МБ.':'Не удалось загрузить фотографию. Выберите JPG, PNG или WebP до 1,5 МБ.'},{status:400,headers});}
}
