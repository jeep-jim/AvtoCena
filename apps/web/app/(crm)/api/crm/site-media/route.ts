import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {hasCrmPermission} from '@/lib/crm-permissions';
import {isPlatformTeam} from '@/lib/platform-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {prepareDealerImage} from '@/lib/dealers/media';
import {readAccountUpload} from '@/lib/account/request';
import {getJsonStorage} from '@/lib/data';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isPlatformTeam(user) || !hasCrmPermission(user, 'site') || !isCalculationOriginAllowed(req)) {
    return NextResponse.json({error: 'Доступ запрещён'}, {status: 403});
  }
  try {
    const max=32*1024*1024;
    if(Number(req.headers.get('content-length'))>max+1024*1024)throw Error('Размер видео — до 32 МБ, фото — до 8 МБ');
    const file=(await readAccountUpload(req,max+1024*1024,'Размер видео — до 32 МБ, фото — до 8 МБ')).get('file');
    if(!(file instanceof File))throw Error('Выберите фото или видео');
    const video=file.type==='video/mp4';
    if(!video&&!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('Выберите JPG, PNG, WebP или MP4');
    if(file.size>(video?max:8*1024*1024))throw Error('Размер видео — до 32 МБ, фото — до 8 МБ');
    const bytes=Buffer.from(await file.arrayBuffer());
    if(video&&(bytes.length<24||bytes.toString('ascii',4,8)!=='ftyp'||!['isom','iso2','mp41','mp42','avc1','M4V '].some(brand=>bytes.subarray(8,Math.min(bytes.readUInt32BE(0),128)).includes(Buffer.from(brand)))))throw Error('Не удалось прочитать MP4. Выберите другое видео');
    const image=video?bytes:await prepareDealerImage(bytes);
    const id = createHash('sha256').update(image).digest('hex');
    const storage = getJsonStorage();
    if (!storage.putBinary) throw Error('Загрузка временно недоступна');
    await storage.putBinary(`settings/account-media/${id}.${video?'mp4':'webp'}`, image, video?'video/mp4':'image/webp');
    return NextResponse.json({url: `/api/site-media/${id}${video?'.mp4':''}`});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : 'Не удалось загрузить изображение'}, {status: 400});
  }
}
