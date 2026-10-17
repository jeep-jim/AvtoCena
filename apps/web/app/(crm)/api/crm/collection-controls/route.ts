import {NextResponse} from 'next/server';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformOwner} from '@/lib/platform-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {readCollectionControls,saveCollectionSwitch,CollectionControlsConflict,CollectionControlsInputError} from '@/lib/catalog/collection-controls';
export const dynamic='force-dynamic';
const response=(body:unknown,status=200)=>NextResponse.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function GET(){
  if(!isPlatformOwner(await getCurrentUser()))return response({error:'Доступ запрещён'},403);
  try{return response(await readCollectionControls());}catch{return response({error:'Не удалось прочитать настройки. Состояние источников неизвестно.'},503);}
}
export async function PUT(req:Request){
  const user=await getCurrentUser();
  if(!isPlatformOwner(user)||!isCalculationOriginAllowed(req))return response({error:'Доступ запрещён'},403);
  let body:unknown;try{body=await req.json();}catch{return response({error:'Некорректный запрос'},400);}
  try{return response(await saveCollectionSwitch(body,user!.id));}
  catch(error){
    if(error instanceof CollectionControlsConflict)return response({error:error.message},409);
    if(error instanceof CollectionControlsInputError)return response({error:error.message},400);
    return response({error:'Не удалось подтвердить сохранение. Обновите список перед следующей попыткой.'},503);
  }
}
