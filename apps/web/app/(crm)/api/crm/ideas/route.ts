import {readCrmUsers} from '@/lib/crm-users';
import {randomUUID} from 'node:crypto';
import {getCurrentUser} from '@/lib/auth';
import {isPlatformTeam,isPlatformOwner} from '@/lib/platform-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {readAccountJson,readAccountUpload} from '@/lib/account/request';
import {prepareDealerImage} from '@/lib/dealers/media';
import {getJsonStorage} from '@/lib/data';
import {createIdea,ideaInput,listIdeas,publicIdea,updateIdea} from '@/lib/team-ideas';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const denied=()=>Response.json({error:'Нет доступа'},{status:403,headers});
export async function GET(){const user=await getCurrentUser();if(!user||!isPlatformTeam(user))return denied();const [rows,users]=await Promise.all([listIdeas(user),readCrmUsers()]);return Response.json({ideas:rows.map(r=>publicIdea(r,user,users)),owner:isPlatformOwner(user)},{headers});}
export async function POST(req:Request){
 const user=await getCurrentUser();if(!user||!isPlatformTeam(user)||!isCalculationOriginAllowed(req))return denied();
 try{
  if(req.headers.get('content-type')?.startsWith('application/json')){
   const b=await readAccountJson(req);await updateIdea(user,String(b.id||''),b.action,b.value);
  }else{
   const form=await readAccountUpload(req,26*1024*1024,'Суммарный размер скриншотов — до 25 МБ.');
   const input=ideaInput({title:form.get('title'),description:form.get('description')});
   const files=form.getAll('screenshots');
   if(files.length>5||files.some(f=>!(f instanceof File)||f.size>5*1024*1024||!['image/png','image/jpeg','image/webp'].includes(f.type)))throw Error('Можно прикрепить до 5 скриншотов PNG, JPG или WebP, каждый до 5 МБ.');
   const storage=getJsonStorage();if(files.length&&!storage.putBinary)throw Error('Загрузка временно недоступна.');
   const id=randomUUID(),saved:string[]=[];
   try{
    for(let i=0;i<files.length;i++){const bytes=await prepareDealerImage(Buffer.from(await (files[i] as File).arrayBuffer()));const key=`${id}/${i}.webp`;await storage.putBinary!(`crm/team-ideas/media/${key}`,bytes,'image/webp');saved.push(key);}
    await createIdea(user,input,saved,id);
   }catch(e){await Promise.allSettled(saved.map(key=>storage.deleteBinary?.(`crm/team-ideas/media/${key}`)));throw e;}
  }
  return Response.json({ok:true},{headers});
 }catch(e){const message=e instanceof Error?e.message:'';return Response.json({error:message==='ideas_forbidden'?'Только владелец может менять готовность.':message==='ideas_missing'?'Идея не найдена.':message.startsWith('Заполните')||message.startsWith('Можно')||message.startsWith('Готовность')||message.startsWith('Суммарный')?message:'Не удалось сохранить. Повторите попытку.'},{status:message==='ideas_forbidden'?403:message==='ideas_missing'?404:400,headers});}
}
