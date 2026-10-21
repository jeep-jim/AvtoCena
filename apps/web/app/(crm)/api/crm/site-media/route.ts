import {ACCOUNT_MEDIA_CHUNK,validateAccountMedia} from '@/lib/account/media-format';
import {createMediaTicket,readMediaTicket,storeMediaPart,joinMediaParts,removeMediaParts,cleanExpiredMediaParts} from '@/lib/account/media-upload';
import {prepareAccountVideo} from '@/lib/account/video';
import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {hasCrmPermission} from '@/lib/crm-permissions';
import {isPlatformTeam} from '@/lib/platform-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {prepareDealerImage} from '@/lib/dealers/media';
import {readAccountJson,readAccountUpload} from '@/lib/account/request';
import {getJsonStorage} from '@/lib/data';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isPlatformTeam(user) || !hasCrmPermission(user, 'site') || !isCalculationOriginAllowed(req)) {
    return NextResponse.json({error: 'Доступ запрещён'}, {status: 403});
  }
  try {
    if(req.headers.get('content-type')?.startsWith('application/json')){
      const data=await readAccountJson(req);
      if(data.action==='start'){
        if(typeof data.name!=='string'||typeof data.type!=='string'||typeof data.size!=='number')throw Error('Выберите фото или видео');
        const token=createMediaTicket(user!.id,{name:data.name,type:data.type,size:data.size});
        await cleanExpiredMediaParts();
        return NextResponse.json({token,chunkSize:ACCOUNT_MEDIA_CHUNK});
      }
      const ticket=readMediaTicket(String(data.token||''),user!.id);
      if(data.action==='cancel'){await removeMediaParts(ticket);return NextResponse.json({ok:true});}
      if(data.action!=='finish')throw Error('Повторите загрузку файла');
      try{return await saveMedia(ticket,await joinMediaParts(ticket));}
      finally{await removeMediaParts(ticket);}
    }
    const token=req.headers.get('x-media-upload');
    if(token){
      const ticket=readMediaTicket(token,user!.id);
      const form=await readAccountUpload(req,ACCOUNT_MEDIA_CHUNK+65536,'Часть файла слишком большая');
      const part=form.get('file');if(!(part instanceof File))throw Error('Выберите файл');
      await storeMediaPart(ticket,Number(req.headers.get('x-media-part')),Buffer.from(await part.arrayBuffer()));
      return NextResponse.json({ok:true});
    }
    const file=(await readAccountUpload(req,33*1024*1024,'Размер видео — до 32 МБ, фото — до 8 МБ')).get('file');
    if(!(file instanceof File))throw Error('Выберите фото или видео');
    validateAccountMedia(file);
    return await saveMedia(file,Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : 'Не удалось загрузить файл. Попробуйте ещё раз'}, {status: 400});
  }
}
async function saveMedia(file:{type:string;name:string;size:number},bytes:Buffer){
    const video=validateAccountMedia(file);
    const image=video?await prepareAccountVideo(bytes,file.type==='video/quicktime'||/\.mov$/i.test(file.name)):await prepareDealerImage(bytes);
    const id = createHash('sha256').update(image).digest('hex');
    const storage = getJsonStorage();
    if (!storage.putBinary) throw Error('Загрузка временно недоступна');
    await storage.putBinary(`settings/account-media/${id}.${video?'mp4':'webp'}`, image, video?'video/mp4':'image/webp');
    return NextResponse.json({url: `/api/site-media/${id}${video?'.mp4':''}`});
}
