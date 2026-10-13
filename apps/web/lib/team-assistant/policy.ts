import type {AuthUser} from '../auth';
import {isPlatformTeam} from '../platform-access';
import {hasCrmPermission} from '../crm-permissions';
import type {AssistantContext} from './types';

export const assistantAllowed=(u:AuthUser|null|undefined)=>isPlatformTeam(u)&&hasCrmPermission(u,'assistant');
export const assistantCodeAllowed=(u:AuthUser|null|undefined)=>assistantAllowed(u)&&hasCrmPermission(u,'assistantCode');
// Values of credentials, rights, money transfers and hidden controls must never be read or filled.
export const privateField = (name:string)=>/password|passwd|secret|token|api.?key|access.?key|кодовое|пароль|permission|роль|role|csrf|otp|cvv|номер карты|card.?number/i.test(name);
export function safePath(value:unknown){
 if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u001f]/.test(value)||value.length>600)return null;
 const u=new URL(value,'https://avtocena.com');
 if(u.origin!=='https://avtocena.com'||u.pathname.startsWith('/api/')||u.pathname.startsWith('/login'))return null;
 return u.pathname+u.search;
}
export function canFillPath(u:AuthUser,path:string){
 if(!assistantAllowed(u))return false;
 const p=path.split('?')[0];
 if(/^\/crm\/clients(?:\/|$)/.test(p))return hasCrmPermission(u,'editClients');
 if(/^\/crm\/leads(?:\/|$)/.test(p))return hasCrmPermission(u,'editLeads');
 if(/^\/crm\/catalog(?:\/|$)/.test(p))return hasCrmPermission(u,'catalog');
 if(/^\/cars(?:\/|$)/.test(p))return hasCrmPermission(u,'calculations');
 // Staff/roles, integration credentials, financial settings and forms with external side effects are excluded.
 return false;
}
export function cleanContext(raw:any):AssistantContext{
 const path=safePath(raw?.path);if(!path)throw Error('Откройте страницу сайта заново.');
 const fields=Array.isArray(raw.fields)?raw.fields.slice(0,50).filter((f:any)=>typeof f.id==='string'&&/^af-\d{1,3}$/.test(f.id)&&typeof f.label==='string'&&!privateField(f.label)).map((f:any)=>({id:f.id,label:f.label.slice(0,160),value:String(f.value??'').slice(0,2000),...(Array.isArray(f.options)?{options:f.options.slice(0,100).map((s:any)=>String(s).slice(0,200))}:{})})):[];
 return {path,title:String(raw.title||'').slice(0,200),text:String(raw.text||'').slice(0,14000),fields};
}
export function editableCodePath(path:unknown):path is string{
 return typeof path==='string'&&path.length<250&&!path.includes('..')&&!path.includes('\\')&&/^apps\/web\/(components\/|app\/).*\.(tsx|css)$/.test(path)&&!path.includes('/api/')&&!/assistant|permission|auth|middleware|layout\.tsx|SitePageAccess/i.test(path);
}
