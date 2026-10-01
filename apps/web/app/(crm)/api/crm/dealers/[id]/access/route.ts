import {getCurrentUser,getAuthUsers,normalizeTelegramUsername,type AuthUser} from '@/lib/auth';
import {isPlatformOwner,isPlatformTeam} from '@/lib/platform-access';
import {readDataJson,mutateDataJson} from '@/lib/data';
import {findDealer} from '@/lib/dealers/showcase-store';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {recordCrmActivity} from '@/lib/crm-activity';
export async function GET(_req:Request,{params}:{params:Promise<{id:string}>}){
 if(!isPlatformOwner(await getCurrentUser()))return Response.json({error:'Доступ запрещён'},{status:403});
 const {id}=await params;
 const users=await readDataJson<AuthUser[]>('auth/users.json',getAuthUsers());
 return Response.json({users:users.filter(u=>u.companyId===id&&!isPlatformTeam(u)).map(u=>({id:u.id,name:u.displayName,username:u.telegramUsername,approved:u.dealerApproved===true,status:u.status}))},{headers:{'Cache-Control':'no-store'}});
}
export async function PUT(req:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await getCurrentUser();
 if(!actor||!isPlatformOwner(actor)||!isCalculationOriginAllowed(req))return Response.json({error:'Доступ запрещён'},{status:403});
 const {id}=await params;if(!await findDealer(id))return Response.json({error:'Компания не найдена'},{status:404});
 try{
  const body=await req.json();const username=normalizeTelegramUsername(String(body.username||''));
  if(!/^[a-z0-9_]{5,32}$/.test(username))throw Error('Проверьте Telegram username сотрудника');
  let targetId='';
  await mutateDataJson<AuthUser[]>('auth/users.json',getAuthUsers(),users=>{
   const target=users.find(u=>normalizeTelegramUsername(u.telegramUsername)===username);
   if(!target)throw Error('Сначала создайте сотрудника с ролью «Дилер — только свой кабинет» в разделе «Команда и права»');
   if(isPlatformTeam(target)||target.role!=='dealer')throw Error('Этот аккаунт не является аккаунтом дилера');
   if(target.companyId!==id)throw Error('Сотрудник закреплён за другой компанией. Проверьте его карточку в разделе «Команда и права»');
   targetId=target.id;
   return users.map(u=>u.id===target.id?{...u,dealerApproved:body.approved===true,sessionVersion:(u.sessionVersion||0)+1,updatedAt:new Date().toISOString()}:u);
  });
  await recordCrmActivity(actor,{type:'dealer_access_updated',title:body.approved===true?'Подтверждён доступ дилера':'Отключён доступ дилера',visibility:'management',entityType:'dealer',entityId:id,href:`/crm/dealers/${id}`,text:`Аккаунт: ${targetId}`});
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось сохранить доступ'},{status:400});}
}
