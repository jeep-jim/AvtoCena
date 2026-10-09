import {createHash} from 'node:crypto';
import {getCurrentUser} from '@/lib/auth';
import {canEditCatalog} from '@/lib/catalog/editorial-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {readAccountUpload} from '@/lib/account/request';
import {prepareDealerImage} from '@/lib/dealers/media';
import {getJsonStorage} from '@/lib/data';
export const runtime='nodejs';
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'};
 if(!canEditCatalog(await getCurrentUser())||!isCalculationOriginAllowed(request))return Response.json({error:'Доступ запрещён.'},{status:403,headers});
 try{
  const file=(await readAccountUpload(request,1_600_000,'Уменьшите фотографию до 1,5 МБ.')).get('file');
  if(!(file instanceof File)||!/^image\/(jpeg|png|webp)$/.test(file.type))return Response.json({error:'Выберите JPG, PNG или WebP.'},{status:400,headers});
  const image=await prepareDealerImage(Buffer.from(await file.arrayBuffer()));
  const id=createHash('sha256').update(image).digest('hex');
  const storage=getJsonStorage();if(!storage.putBinary)throw Error('storage_unavailable');
  await storage.putBinary(`settings/account-media/${id}.webp`,image,'image/webp');
  return Response.json({id,url:`/api/site-media/${id}`},{headers});
 }catch{return Response.json({error:'Не удалось загрузить фотографию. Выберите JPG, PNG или WebP до 1,5 МБ.'},{status:400,headers});}
}
