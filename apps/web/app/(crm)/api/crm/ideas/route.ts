import {removeIdea} from '@/lib/team-ideas-retention';
import {canDeleteIdea} from '@/lib/team-ideas';
import {readCrmUsers} from '@/lib/crm-users';
import {randomUUID} from 'node:crypto';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformTeam,isPlatformOwner} from '@/lib/platform-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {readAccountJson,readAccountUpload} from '@/lib/account/request';
import {prepareDealerImage} from '@/lib/dealers/media';
import {getJsonStorage} from '@/lib/data';
import {addIdeaComment,commentText,createIdea,ideaInput,listIdeas,publicIdea,updateIdea,canEditIdea,editIdea} from '@/lib/team-ideas';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const denied=()=>Response.json({error:'Нет доступа'},{status:403,headers});
export async function GET(req?:Request){const user=await getCurrentUser();if(!user||!isPlatformTeam(user))return denied();const [rows,users]=await Promise.all([listIdeas(user),readCrmUsers()]);const number=req?new URL(req.url).searchParams.get('number'):null;const selected=number?rows.filter(r=>String(r.number)===number):rows;if(number&&!selected.length)return Response.json({error:'Идея не найдена.'},{status:404,headers});return Response.json({ideas:selected.map(r=>publicIdea(r,user,users)),owner:isPlatformOwner(user)},{headers});}
export async function POST(req:Request){
 const user=await getCurrentUser();if(!user||!isPlatformTeam(user)||!isCalculationOriginAllowed(req))return denied();
 try{
  if(req.headers.get('content-type')?.startsWith('application/json')){
   const b=await readAccountJson(req);if(b.action==='delete'){if(!canDeleteIdea(user))throw Error('ideas_forbidden');if(b.confirm!==true)throw Error('Подтвердите удаление.');await removeIdea(String(b.id||''));}else await updateIdea(user,String(b.id||''),b.action,b.value);
  }else{
   const form=await readAccountUpload(req,26*1024*1024,'Суммарный размер скриншотов — до 25 МБ.');
   const commenting=form.get('action')==='comment';
   const text=commenting?commentText(form.get('text')):'';
   const input=commenting?null:ideaInput({title:form.get('title'),description:form.get('description')});
   const files=form.getAll('screenshots');
   if(files.length>5||files.some(f=>!(f instanceof File)||f.size>5*1024*1024||!['image/png','image/jpeg','image/webp'].includes(f.type)))throw Error('Можно прикрепить до 5 скриншотов PNG, JPG или WebP, каждый до 5 МБ.');
   const storage=getJsonStorage();if(files.length&&!storage.putBinary)throw Error('Загрузка временно недоступна.');
   const editing=String(form.get('id')||'');
   const existing=editing?(await listIdeas(user)).find(row=>row.id===editing):undefined;
   if(editing&&!existing)throw Error('ideas_missing');if(commenting&&!existing)throw Error('ideas_missing');if(existing&&!commenting&&!canEditIdea(existing,user))throw Error('ideas_forbidden');
   const retain=form.getAll('retain').map(String);if(retain.length+files.length>5)throw Error('Можно прикрепить до 5 скриншотов.');
   const id=editing||randomUUID(),saved:string[]=[];
   try{
    for(let i=0;i<files.length;i++){const bytes=await prepareDealerImage(Buffer.from(await (files[i] as File).arrayBuffer()));const key=`${id}/${randomUUID()}.webp`;await storage.putBinary!(`crm/team-ideas/media/${key}`,bytes,'image/webp');saved.push(key);}
    if(commenting)await addIdeaComment(user,id,text,saved);
    else if(existing){await editIdea(user,id,input!,retain,saved,Number(form.get('revision')));await Promise.allSettled(existing.screenshots.filter(key=>!retain.includes(key)).map(key=>storage.deleteBinary?.(`crm/team-ideas/media/${key}`)));}
    else await createIdea(user,input!,saved,id);
   }catch(e){await Promise.allSettled(saved.map(key=>storage.deleteBinary?.(`crm/team-ideas/media/${key}`)));throw e;}
  }
  return Response.json({ok:true},{headers});
 }catch(e){const message=e instanceof Error?e.message:'';return Response.json({error:message==='ideas_forbidden'?'Нет прав на это изменение.':message==='ideas_conflict'?'Идею уже отредактировали. Обновите список и откройте редактирование заново.':message==='ideas_missing'?'Идея не найдена.':message.startsWith('Заполните')||message.startsWith('Можно')||message.startsWith('Готовность')||message.startsWith('Суммарный')?message:'Не удалось сохранить. Повторите попытку.'},{status:message==='ideas_forbidden'?403:message==='ideas_missing'?404:message==='ideas_conflict'?409:400,headers});}
}
