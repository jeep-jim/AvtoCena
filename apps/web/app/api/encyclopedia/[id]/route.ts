import {getCurrentUser} from '@/lib/auth';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {readAccountJson} from '@/lib/account/request';
import {canEditEncyclopedia,editModel,EncyclopediaConflict} from '@/lib/encyclopedia/records';
import {EncyclopediaInputError} from '@/lib/encyclopedia/schema';
import {revalidatePath} from 'next/cache';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const user=await getCurrentUser();if(!canEditEncyclopedia(user)||!isCalculationOriginAllowed(request))return Response.json({error:'Доступ запрещён.'},{status:403,headers});
 let input;try{input=await readAccountJson(request);}catch{return Response.json({error:'Проверьте форму.'},{status:400,headers});}
 try{const {id}=await params;await editModel(id,input,user!);revalidatePath('/cars/autocatalog','layout');return Response.json({saved:true},{headers});}
 catch(error){if(error instanceof EncyclopediaConflict||error instanceof EncyclopediaInputError)return Response.json({error:error.message},{status:error instanceof EncyclopediaConflict?409:400,headers});console.error('encyclopedia_save_failed');return Response.json({error:'Сохранение не подтверждено. Обновите страницу перед повторной попыткой.'},{status:503,headers});}
}
