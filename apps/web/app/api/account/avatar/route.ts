import {readAccountUpload} from '@/lib/account/request';
import sharp from 'sharp';
import {currentAccount,accountPath,accountRateLimit,publicAccount,type CustomerAccount} from '@/lib/account/auth';
import {getJsonStorage,mutateDataJson} from '@/lib/data';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export const runtime='nodejs';
export async function GET(){const a=await currentAccount();if(!a)return new Response(null,{status:401});const s=getJsonStorage();const file=await s.getBinary?.(`accounts/avatars/${a.id}.webp`).catch(()=>null);if(!file)return new Response(null,{status:404});return new Response(new Uint8Array(file.data),{headers:{'Content-Type':'image/webp','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});}
export async function POST(request:Request){if(!isCalculationOriginAllowed(request))return new Response(null,{status:403});const a=await currentAccount();if(!a)return new Response(null,{status:401});try{
 if(!await accountRateLimit('avatar:'+a.id,10,3600000))return new Response(null,{status:429});
 if(Number(request.headers.get('content-length'))>3*1024*1024)throw Error('Выберите изображение до 2 МБ.');
 const file=(await readAccountUpload(request)).get('file');if(!(file instanceof File)||!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>2*1024*1024)throw Error('Выберите JPG, PNG или WebP до 2 МБ.');
 const data=await sharp(Buffer.from(await file.arrayBuffer()),{limitInputPixels:16000000}).rotate().resize(256,256,{fit:'cover'}).webp({quality:85}).toBuffer();const storage=getJsonStorage();if(!storage.putBinary)throw Error('Загрузка временно недоступна.');await storage.putBinary(`accounts/avatars/${a.id}.webp`,data,'image/webp');
 let result=a;await mutateDataJson<CustomerAccount|null>(accountPath(a.id),null,c=>{if(!c||c.disabled)throw Error('Нет доступа.');result={...c,avatarVersion:crypto.randomUUID()};return result;});return Response.json({account:publicAccount(result)},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось загрузить фото.'},{status:400});}}
