import {getCurrentUser} from '@/lib/auth';
import {canEditCatalog} from '@/lib/catalog/editorial-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {readAccountJson} from '@/lib/account/request';
import {readCatalogEditorial,cleanEditorialInput,saveCatalogEditorial,EditorialConflict,EditorialInputError} from '@/lib/catalog/editorial';
import {getOfferFromCurrentShard} from '@/lib/catalog/storage';
import {catalogOfferTitle} from '@/lib/catalog/presentation';
import {getJsonStorage} from '@/lib/data';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const user=await getCurrentUser();
 if(!canEditCatalog(user)||!isCalculationOriginAllowed(request))return Response.json({error:'Доступ запрещён.'},{status:403,headers});
 let input;
 try{input=cleanEditorialInput(await readAccountJson(request));}catch(error){return Response.json({error:error instanceof Error?error.message:'Проверьте форму.'},{status:400,headers});}
 try{
  const {id}=await params;
  if(!id||id.length>200)return Response.json({error:'Объявление недоступно.'},{status:404,headers});
  const [current,index]=await Promise.all([getOfferFromCurrentShard(id),readCatalogEditorial()]);
  const previous=Object.hasOwn(index.entries,id)?index.entries[id]:undefined;
  if(!current&&(!previous||input.status==='visible'))return Response.json({error:'Объявление больше не доступно у продавца. Вернуть его на сайт пока нельзя.'},{status:409,headers});
  if(input.photos){
   const storage=getJsonStorage();
   for(const url of input.photos)if(!storage.binaryExists||!await storage.binaryExists(`settings/account-media/${url.split('/').at(-1)}.webp`))throw new EditorialInputError('Фотография не найдена. Загрузите её ещё раз.');
  }
  const offer=current||{...previous!,images:previous!.originalPhoto?[{url:previous!.originalPhoto}]:[]};
  const saved=await saveCatalogEditorial(offer,input,user!,current?catalogOfferTitle(current):previous!.originalTitle);
  return Response.json({entry:saved},{headers});
 }catch(error){
  if(error instanceof EditorialConflict||error instanceof EditorialInputError)return Response.json({error:error.message},{status:error instanceof EditorialConflict?409:400,headers});
  console.error('catalog_editorial_save_failed');
  return Response.json({error:'Не удалось подтвердить сохранение. Обновите страницу перед повторной попыткой.'},{status:503,headers});
 }
}
