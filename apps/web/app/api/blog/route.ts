import {getCurrentUser} from '@/lib/auth';
import {canEditEncyclopedia} from '@/lib/encyclopedia/records';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {readAccountJson} from '@/lib/account/request';
import {saveBlogPost,BlogConflict} from '@/lib/blog/records';
import {BlogInputError} from '@/lib/blog/schema';
import {revalidatePath} from 'next/cache';
export const dynamic='force-dynamic';
export async function POST(request:Request){
 const headers={'Cache-Control':'no-store'},user=await getCurrentUser();
 if(!canEditEncyclopedia(user)||!isCalculationOriginAllowed(request))return Response.json({error:'Доступ запрещён.'},{status:403,headers});
 let input;try{input=await readAccountJson(request,65536);}catch{return Response.json({error:'Проверьте форму и размер статьи.'},{status:400,headers});}
 try{const post=await saveBlogPost(input);revalidatePath('/blog','layout');return Response.json({slug:post.slug,revision:post.revision},{headers});}
 catch(error){return Response.json({error:error instanceof BlogInputError||error instanceof BlogConflict?error.message:'Сохранение не подтверждено. Проверьте соединение.'},{status:error instanceof BlogConflict?409:error instanceof BlogInputError?400:503,headers});}
}
