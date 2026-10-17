import {NextResponse} from 'next/server';
import {isIP} from 'node:net';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {ajesClient} from '@/lib/catalog/ajes-runtime';
import {AjesInputError} from '@/lib/catalog/ajes-query';
export const dynamic='force-dynamic';
const response=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});

/** Owner-only acceptance endpoint. No public proxy, raw SQL, automatic crawling or publishing. */
export async function POST(req:Request) {
  if(!isPlatformOwner(await getCurrentUser())||!isCalculationOriginAllowed(req))return response({error:'Доступ запрещён'},403);
  // Nginx must overwrite X-Real-IP; do not trust arbitrary X-Forwarded-For chains.
  const ip=req.headers.get('x-real-ip')||'';
  if(!isIP(ip))return response({error:'Не удалось определить адрес запроса'},400);
  let query:unknown;
  try{const raw=await req.text();if(Buffer.byteLength(raw)>4096)return response({error:'Слишком большой запрос'},413);query=JSON.parse(raw);}catch{return response({error:'Некорректный запрос'},400);}
  try{return response({ok:true,...await ajesClient.read(query,ip)});}
  catch(error){
    if(error instanceof AjesInputError)return response({error:'Проверьте параметры поиска'},400);
    return response({error:'Источник временно недоступен. Проверьте подключение и настройки источника.'},503);
  }
}
