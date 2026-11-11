import type {AuthUser} from './auth';
import {hasCrmPermission} from './crm-permissions';
import {canSeeLead} from './crm-visibility';
import {canManageDealer} from './dealers/access';
export function documentCompany(user:AuthUser|null|undefined){return user?.role==='dealer'&&user.companyId&&user.companyId!=='dealer_topavto'?user.companyId:null;}
export function workspaceClientsPath(user:AuthUser|null|undefined){const id=documentCompany(user);return id?`dealers/${encodeURIComponent(id)}/clients.json`:'clients/clients.json';}
export function canAccessDocumentClient(user:AuthUser|null|undefined,client:any){const id=documentCompany(user);return id?Boolean(user?.status!=='disabled'&&user?.dealerApproved===true&&client?.companyId===id):canSeeLead(user,client);}
export async function canUseDocuments(user:AuthUser|null|undefined){if(!user||user.status==='disabled')return false;if(user.role==='dealer')return Boolean(documentCompany(user)&&await canManageDealer(user,user.companyId!));return hasCrmPermission(user,'documents');}
export function contractIndexPath(user:AuthUser){const id=documentCompany(user);return id?`dealers/${encodeURIComponent(id)}/contracts/index.json`:'contracts/index.json';}
export function contractBelongsToWorkspace(user:AuthUser,record:{companyId?:string;createdBy:string}){const company=documentCompany(user);return company?record.companyId===company:!record.companyId;}
