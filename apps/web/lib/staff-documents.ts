import {createHash} from 'node:crypto';
import {hasCrmPermission} from './crm-permissions';
import {isCrmRole,type AuthUser} from './auth';
import {readCrmUsers} from './crm-users';
import {readDataJson} from './data';
import type {ClientDocument} from './client-documents';
export const staffDocumentIndex=(id:string)=>`crm/staff-documents/${createHash('sha256').update(id).digest('hex')}.json`;
export const staffDocumentKey=(id:string,docId:string)=>`crm/staff-documents/files/${createHash('sha256').update(id).digest('hex')}/${docId}.enc`;
export function canReadStaffDocuments(actor:AuthUser,target:AuthUser){return isCrmRole(actor.role)&&actor.status!=='disabled'&&(actor.id===target.id||(hasCrmPermission(actor,'staff')&&(target.role!=='owner'||actor.role==='owner')));}
export function canManageStaffDocuments(actor:AuthUser,target:AuthUser){return canReadStaffDocuments(actor,target)&&hasCrmPermission(actor,'staff');}
export async function staffDocumentAccess(actor:AuthUser,id:string,write=false){const target=(await readCrmUsers()).find(u=>u.id===id&&isCrmRole(u.role));if(!target||!(write?canManageStaffDocuments(actor,target):canReadStaffDocuments(actor,target)))throw Error('forbidden');return target;}
export const readStaffDocuments=(id:string)=>readDataJson<ClientDocument[]>(staffDocumentIndex(id),[]);
