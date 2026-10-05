import {createHash} from 'node:crypto';
import {NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {hasCrmPermission} from '@/lib/crm-permissions';
import {isPlatformTeam} from '@/lib/platform-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {prepareDealerImage} from '@/lib/dealers/media';
import {getJsonStorage} from '@/lib/data';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!isPlatformTeam(user) || !hasCrmPermission(user, 'site') || !isCalculationOriginAllowed(req)) {
    return NextResponse.json({error: 'Доступ запрещён'}, {status: 403});
  }
  try {
    if (Number(req.headers.get('content-length')) > 9 * 1024 * 1024) throw Error('Размер изображения — до 8 МБ');
    const file = (await req.formData()).get('file');
    if (!(file instanceof File) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw Error('Выберите JPG, PNG или WebP');
    if (file.size > 8 * 1024 * 1024) throw Error('Размер изображения — до 8 МБ');
    const image = await prepareDealerImage(Buffer.from(await file.arrayBuffer()));
    const id = createHash('sha256').update(image).digest('hex');
    const storage = getJsonStorage();
    if (!storage.putBinary) throw Error('Загрузка временно недоступна');
    await storage.putBinary(`settings/account-media/${id}.webp`, image, 'image/webp');
    return NextResponse.json({url: `/api/site-media/${id}`});
  } catch (error) {
    return NextResponse.json({error: error instanceof Error ? error.message : 'Не удалось загрузить изображение'}, {status: 400});
  }
}
