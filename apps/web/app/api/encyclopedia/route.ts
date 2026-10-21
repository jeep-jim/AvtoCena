import {getCurrentUser} from '@/lib/auth';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {readAccountJson} from '@/lib/account/request';
import {canEditEncyclopedia,createModel} from '@/lib/encyclopedia/records';
import {EncyclopediaInputError} from '@/lib/encyclopedia/schema';
import {revalidatePath} from 'next/cache';
export const dynamic='force-dynamic';
export async function POST(request:Request){const headers={'Cache-Control':'no-store'},user=await getCurrentUser();if(!canEditEncyclopedia(user)||!isCalculationOriginAllowed(request))return Response.json({error:'Доступ запрещён.'},{status:403,headers});let input;try{input=await readAccountJson(request);}catch{return Response.json({error:'Проверьте форму.'},{status:400,headers});}try{const record=await createModel(input,user!);revalidatePath('/cars/autocatalog','layout');return Response.json({id:record.id},{headers});}catch(error){return Response.json({error:error instanceof EncyclopediaInputError?error.message:'Сохранение не подтверждено.'},{status:error instanceof EncyclopediaInputError?400:503,headers});}}
