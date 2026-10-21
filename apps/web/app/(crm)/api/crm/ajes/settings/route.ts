import {NextResponse} from 'next/server';
import {isIP} from 'node:net';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {ajesPassword,saveAjesPassword} from '@/lib/catalog/ajes-settings';
import {createAjesClient} from '@/lib/catalog/ajes-client';
import {reserveAjesRequest} from '@/lib/catalog/ajes-quota';
import {readCollectionControls} from '@/lib/catalog/collection-controls';
import {getJsonStorage} from '@/lib/data';
export const dynamic='force-dynamic';
const response=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(){if(!isPlatformOwner(await getCurrentUser()))return response({error:'Доступ запрещён'},403);try{return response({configured:Boolean(await ajesPassword())});}catch{return response({error:'Не удалось прочитать подключение'},503);}}
export async function PUT(req:Request){
 if(!isPlatformOwner(await getCurrentUser())||!isCalculationOriginAllowed(req))return response({error:'Доступ запрещён'},403);
 const ip=req.headers.get('x-real-ip')||'';if(!isIP(ip))return response({error:'Не удалось определить адрес запроса'},400);
 let password:string;
 try{const raw=await req.text();if(Buffer.byteLength(raw)>1024)return response({error:'Слишком большой запрос'},413);password=JSON.parse(raw).password;if(typeof password!=='string'||!/^[A-Za-z0-9_-]{8,128}$/.test(password))throw Error();}catch{return response({error:'Проверьте API-пароль'},400);}
 try{
  // Explicit owner connection test may probe the disabled source, never a disabled market.
  const probe=createAjesClient({password:()=>password,assertEnabled:async()=>{if(!(await readCollectionControls()).markets.japan.enabled)throw Error('market_disabled');},reserve:table=>reserveAjesRequest(getJsonStorage(),table)});
  await probe.read({table:'stats',pageSize:1},ip);
  await saveAjesPassword(password);
  return response({configured:true});
 }catch{return response({error:'Подключение не подтверждено. Проверьте пароль и включение рынка Японии.'},503);}
}
