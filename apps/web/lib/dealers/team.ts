import {randomBytes,randomUUID} from 'node:crypto';
import {getAuthUsers,normalizeTelegramUsername,type AuthUser} from '../auth';
import {mutateDataJson} from '../data';
import {digest,type StaffUser} from '../crm-access';
import {validStaffLogin} from '../../components/auth/staff-login';
export const DEALER_STAFF_LIMIT=10;
export function isDealerTeamOwner(user:AuthUser|null|undefined){return !!user&&user.role==='dealer'&&user.status!=='disabled'&&user.dealerApproved===true&&!!user.companyId&&user.companyId!=='dealer_topavto'&&user.dealerTeamRole==='owner';}
export function changeDealerTeam(users:StaffUser[],actorId:string,companyId:string,b:any,key:string):StaffUser[]{
 const actor=users.find(u=>u.id===actorId);if(!isDealerTeamOwner(actor)||actor!.companyId!==companyId)throw Error('Управление сотрудниками доступно владельцу компании');
 if(b.action==='create'){
  const name=String(b.name||'').trim(),login=normalizeTelegramUsername(String(b.login||''));
  if(!name||name.length>100||!validStaffLogin(login))throw Error('Укажите имя и логин: 5–32 латинских буквы, цифры или подчёркивания');
  if(users.some(u=>normalizeTelegramUsername(u.telegramUsername)===login))throw Error('Логин занят');
  if(users.filter(u=>u.companyId===companyId&&u.id!==actorId&&u.status!=='disabled').length>=DEALER_STAFF_LIMIT)throw Error('Доступно до 10 сотрудников. Для расширения обратитесь в поддержку АвтоЦены');
  return [...users,{id:randomUUID(),telegramUsername:login,displayName:name,companyId,role:'dealer',dealerTeamRole:'manager',dealerApproved:true,status:'active',accessKeyHash:digest(key),keyIssuedAt:new Date().toISOString(),updatedAt:new Date().toISOString()}];
 }
 const target=users.find(u=>u.id===b.id);if(!target||target.companyId!==companyId||target.role!=='dealer'||target.id===actorId||target.dealerTeamRole==='owner')throw Error('Недоступный сотрудник');
 if(!['disable','key'].includes(b.action))throw Error('Неизвестное действие');
 if(b.action==='key'&&target.status==='disabled')throw Error('Сотрудник отключён. Обратитесь в поддержку АвтоЦены');
 return users.map(u=>u.id!==target.id?u:{...u,sessionVersion:(u.sessionVersion||0)+1,updatedAt:new Date().toISOString(),...(b.action==='disable'?{status:'disabled' as const,dealerApproved:false,accessKeyHash:''}:{accessKeyHash:digest(key),keyIssuedAt:new Date().toISOString()})});
}
export async function updateDealerTeam(actor:AuthUser,b:any){const key=b.action==='disable'?'':randomBytes(32).toString('base64url');await mutateDataJson<StaffUser[]>('auth/users.json',getAuthUsers(),users=>changeDealerTeam(users,actor.id,actor.companyId!,b,key));return key;}
