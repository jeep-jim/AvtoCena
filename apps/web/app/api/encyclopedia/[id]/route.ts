import {mechanicalRows} from '@/lib/encyclopedia/compact';
import {rememberEncyclopediaModel,encyclopediaWithManagement,readManagementKnowledge} from '@/lib/catalog/management-knowledge';
import {publicEncyclopediaRecord} from '@/lib/encyclopedia/public-record';
import {getCurrentUser} from '@/lib/auth';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {readAccountJson} from '@/lib/account/request';
import {readModel,canEditEncyclopedia,editModel,EncyclopediaConflict} from '@/lib/encyclopedia/records';
import {EncyclopediaInputError} from '@/lib/encyclopedia/schema';
import {revalidatePath} from 'next/cache';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store'};
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const user=await getCurrentUser();if(!canEditEncyclopedia(user)||!isCalculationOriginAllowed(request))return Response.json({error:'Доступ запрещён.'},{status:403,headers});
 let input;try{input=await readAccountJson(request);}catch{return Response.json({error:'Проверьте форму.'},{status:400,headers});}
 try{const {id}=await params;
  if(typeof input.variant?.id==='string'&&input.variant.id.startsWith('staff:'))delete input.variant.id;
  const record=input.action==='sync'?await readModel(id):await editModel(id,input,user!);
  if(!record)throw new EncyclopediaInputError('Модель не найдена.');
  let knowledgeUpdated=true;try{await rememberEncyclopediaModel(record);}catch{knowledgeUpdated=false;}
  revalidatePath('/cars/autocatalog','layout');return Response.json({saved:true,knowledgeUpdated},{headers});}
 catch(error){if(error instanceof EncyclopediaConflict||error instanceof EncyclopediaInputError)return Response.json({error:error.message},{status:error instanceof EncyclopediaConflict?409:400,headers});console.error('encyclopedia_save_failed');return Response.json({error:'Сохранение не подтверждено. Обновите страницу перед повторной попыткой.'},{status:503,headers});}
}

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const year=new URL(request.url).searchParams.get('year');
 if(year===null||year!=='unknown'&&!/^\d{4}$/.test(year))return Response.json({error:'Выберите год.'},{status:400,headers});
 const {id}=await params;
 const [stored,knowledge,user]=await Promise.all([readModel(id),readManagementKnowledge(),getCurrentUser()]);
 if(!stored)return Response.json({error:'Модель не найдена.'},{status:404,headers});
 const record=encyclopediaWithManagement(stored,knowledge,year==='unknown'?null:Number(year));
 const {editedBy,previousKey,...publicRecord}=record;
 publicRecord.variants=mechanicalRows(record.variants.filter(v=>year==='unknown'?!v.year:v.year===Number(year)));
 return Response.json(canEditEncyclopedia(user)?publicRecord:publicEncyclopediaRecord(publicRecord),{headers});
}
