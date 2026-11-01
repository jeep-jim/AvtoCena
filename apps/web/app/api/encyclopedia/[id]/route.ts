import {createHash} from 'node:crypto';
import {encyclopediaReviewDisplay} from '@/components/encyclopedia/review-state';
import {mechanicalRows} from '@/lib/encyclopedia/compact';
import {rememberEncyclopediaModel,encyclopediaWithManagement,readManagementKnowledge,managementModelKey,managementModelRevision} from '@/lib/catalog/management-knowledge';
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
  let management;
  if(input.action!=='sync'){
   const stored=await readModel(id),knowledge=await readManagementKnowledge(true);
   if(!stored)throw new EncyclopediaInputError('Модель не найдена.');
   if(input.managementRevision&&input.managementRevision!==managementModelRevision(stored.make,stored.model,knowledge))throw new EncyclopediaConflict('Параметры уже изменены в карточке. Обновите строку перед сохранением.');
   if(typeof input.variant?.id==='string'&&input.variant.id.startsWith('staff:')){
    if(!input.managementRevision)throw new EncyclopediaConflict('Обновите строку перед сохранением.');
    const fact=Object.values(knowledge.models[managementModelKey(stored.make,stored.model)]||{}).find(f=>!f.offerId.startsWith('encyclopedia:')&&`staff:${createHash('sha256').update(f.offerId).digest('hex').slice(0,24)}`===input.variant.id);
    if(!fact||fact.year!==Number(input.variant.year))throw new EncyclopediaConflict('Параметры карточки изменились. Обновите строку перед сохранением.');
    management={offerId:fact.offerId,values:fact.values};delete input.variant.id;
   }else if(input.variant?.id){
    const displayed=encyclopediaWithManagement(stored,knowledge).variants.find(v=>v.id===input.variant.id);
    if(displayed)management={values:displayed};
   }
  }
  const record=input.action==='sync'?await readModel(id):await editModel(id,input,user!,management);
  if(!record)throw new EncyclopediaInputError('Модель не найдена.');
  let knowledgeUpdated=true;try{await rememberEncyclopediaModel(record);}catch{knowledgeUpdated=false;}
  revalidatePath('/cars/autocatalog','layout');return Response.json({saved:true,knowledgeUpdated},{headers});}
 catch(error){if(error instanceof EncyclopediaConflict||error instanceof EncyclopediaInputError)return Response.json({error:error.message},{status:error instanceof EncyclopediaConflict?409:400,headers});console.error('encyclopedia_save_failed');return Response.json({error:'Сохранение не подтверждено. Обновите страницу перед повторной попыткой.'},{status:503,headers});}
}

export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const year=new URL(request.url).searchParams.get('year');
 if(year===null||year!=='unknown'&&!/^\d{4}$/.test(year))return Response.json({error:'Выберите год.'},{status:400,headers});
 const {id}=await params;
 const [stored,knowledge,user]=await Promise.all([readModel(id),readManagementKnowledge(true),getCurrentUser()]);
 if(!stored)return Response.json({error:'Модель не найдена.'},{status:404,headers});
 const record=encyclopediaReviewDisplay(stored,encyclopediaWithManagement(stored,knowledge,year==='unknown'?null:Number(year)));
 const {editedBy,previousKey,...publicRecord}=record;
 publicRecord.variants=mechanicalRows(record.variants.filter(v=>year==='unknown'?!v.year:v.year===Number(year)));
 return Response.json(canEditEncyclopedia(user)?{...publicRecord,managementRevision:managementModelRevision(record.make,record.model,knowledge)}:publicEncyclopediaRecord(publicRecord),{headers});
}
