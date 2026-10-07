import {defaultManagerAvatar} from './default-avatars';
import {randomUUID} from 'node:crypto';
import type {AuthUser} from './auth';
import {isPlatformTeam,isPlatformOwner} from './platform-access';
import {readDataJson,mutateDataJson} from './data';

export type IdeaComment={id:string;authorId:string;authorName:string;authorAvatarUrl?:string;text:string;createdAt:string;screenshots:string[]};
export type TeamIdea={comments?:IdeaComment[];id:string;revision?:number;editedAt?:string;number?:number;authorAvatarUrl?:string;downvotes?:string[];title:string;description:string;authorId:string;authorName:string;createdAt:string;updatedAt:string;progress:number;votes:string[];screenshots:string[]};
export const IDEAS_PATH='crm/team-ideas/items.json';
export function requireIdeaTeam(user:AuthUser|null|undefined):asserts user is AuthUser {if(!isPlatformTeam(user))throw Error('ideas_forbidden');}
export function ideaInput(input:{title:unknown;description:unknown}) {
 const title=typeof input.title==='string'?input.title.trim():'';
 const description=typeof input.description==='string'?input.description.trim():'';
 if(!title||title.length>160||!description||description.length>12000)throw Error('Заполните заголовок (до 160 символов) и описание (до 12 000 символов).');
 return {title,description};
}
export function changeIdea(row:TeamIdea,user:AuthUser,action:unknown,value:unknown):TeamIdea {
 requireIdeaTeam(user);
 if(action==='vote'){
  const choice=value===true?'for':value===false?null:value;
  if(choice!==null&&choice!=='for'&&choice!=='against')throw Error('Некорректный голос.');
  const votes=row.votes.filter(id=>id!==user.id),downvotes=(row.downvotes||[]).filter(id=>id!==user.id);
  if(choice==='for')votes.push(user.id);if(choice==='against')downvotes.push(user.id);
  return {...row,votes:[...new Set(votes)],downvotes:[...new Set(downvotes)]};
 }
 if(action==='progress'){
  if(!isPlatformOwner(user))throw Error('ideas_forbidden');
  if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>100)throw Error('Готовность — от 0 до 100%.');
  return {...row,progress:value,updatedAt:new Date().toISOString()};
 }
 throw Error('Неизвестное действие.');
}
export function numberIdeas(rows:TeamIdea[]):TeamIdea[]{
 let max=rows.reduce((n,r)=>Math.max(n,Number.isSafeInteger(r.number)&&(r.number??0)>0?r.number!:0),0);
 const missing=rows.filter(r=>!Number.isSafeInteger(r.number)||(r.number??0)<1).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
 const assigned=new Map(missing.map(r=>[r.id,++max]));
 return rows.map(r=>assigned.has(r.id)?{...r,number:assigned.get(r.id)}:r);
}
export async function listIdeas(user:AuthUser){requireIdeaTeam(user);const rows=await readDataJson<TeamIdea[]>(IDEAS_PATH,[]);return rows.some(r=>!Number.isSafeInteger(r.number)||(r.number??0)<1)?mutateDataJson<TeamIdea[]>(IDEAS_PATH,[],numberIdeas):rows;}
export async function createIdea(user:AuthUser,input:{title:unknown;description:unknown},screenshots:string[],id:string=randomUUID()){
 requireIdeaTeam(user);const fields=ideaInput(input);
 if(screenshots.length>5||screenshots.some(s=>!validIdeaScreenshot(id,s)))throw Error('Некорректные скриншоты.');
 const at=new Date().toISOString();const row:TeamIdea={id,...fields,authorId:user.id,authorName:user.displayName||'Сотрудник',authorAvatarUrl:user.avatarUrl,createdAt:at,updatedAt:at,progress:0,votes:[],screenshots};
 await mutateDataJson<TeamIdea[]>(IDEAS_PATH,[],rows=>{const numbered=numberIdeas(rows);row.number=numbered.reduce((n,r)=>Math.max(n,r.number!),0)+1;return [row,...numbered];});return row;
}
export async function updateIdea(user:AuthUser,id:string,action:unknown,value:unknown){
 requireIdeaTeam(user);
 await mutateDataJson<TeamIdea[]>(IDEAS_PATH,[],rows=>{if(!rows.some(r=>r.id===id))throw Error('ideas_missing');return rows.map(row=>row.id===id?changeIdea(row,user,action,value):row);});
}
export function publicIdea(row:TeamIdea,user:AuthUser,users:AuthUser[]=[]){
 const person=(id:string,name='Сотрудник',avatar?:string)=>{const found=users.find(u=>u.id===id&&u.companyId==='dealer_topavto')||(id===user.id?user:undefined);return {id,name:found?.displayName||name,avatar:found?.avatarUrl||avatar||defaultManagerAvatar(id)};};
 const votes=[...new Set(row.votes)],downvotes=[...new Set(row.downvotes||[])].filter(id=>!votes.includes(id));
 return {...row,comments:(row.comments||[]).map(c=>({...c,author:person(c.authorId,c.authorName,c.authorAvatarUrl)})),canEdit:canEditIdea(row,user),votes:undefined,downvotes:undefined,author:person(row.authorId,row.authorName,row.authorAvatarUrl),supporters:votes.map(id=>person(id)),opponents:downvotes.map(id=>person(id)),voteCount:votes.length,againstCount:downvotes.length,voted:votes.includes(user.id),choice:votes.includes(user.id)?'for':downvotes.includes(user.id)?'against':null};
}

export function canEditIdea(row:TeamIdea,user:AuthUser){return isPlatformTeam(user)&&(isPlatformOwner(user)||row.authorId===user.id);}
export function validIdeaScreenshot(id:string,key:string){return key.startsWith(id+'/')&&/^(?:[0-4]|[a-f0-9-]{36})\.webp$/.test(key.slice(id.length+1));}
export async function editIdea(user:AuthUser,id:string,input:{title:unknown;description:unknown},retain:string[],added:string[],revision:number){
 requireIdeaTeam(user);const fields=ideaInput(input);
 await mutateDataJson<TeamIdea[]>(IDEAS_PATH,[],rows=>{
  const row=rows.find(r=>r.id===id);if(!row)throw Error('ideas_missing');if(!canEditIdea(row,user))throw Error('ideas_forbidden');
  if(!Number.isInteger(revision)||revision!==(row.revision||0))throw Error('ideas_conflict');
  if(retain.length+added.length>5||retain.some(key=>!row.screenshots.includes(key))||added.some(key=>!validIdeaScreenshot(id,key)))throw Error('Некорректные скриншоты.');
  const at=new Date().toISOString();return rows.map(r=>r.id===id?{...r,...fields,screenshots:[...new Set([...retain,...added])],revision:revision+1,editedAt:at,updatedAt:at}:r);
 });
}

export function commentText(value:unknown){
 const text=typeof value==='string'?value.trim():'';
 if(!text||text.length>12000)throw Error('Заполните комментарий (до 12 000 символов).');
 return text;
}
export async function addIdeaComment(user:AuthUser,id:string,value:unknown,screenshots:string[]){
 requireIdeaTeam(user);const text=commentText(value);
 if(screenshots.length>5||screenshots.some(key=>!validIdeaScreenshot(id,key)))throw Error('Некорректные скриншоты.');
 const comment:IdeaComment={id:randomUUID(),authorId:user.id,authorName:user.displayName||'Сотрудник',authorAvatarUrl:user.avatarUrl,text,createdAt:new Date().toISOString(),screenshots};
 await mutateDataJson<TeamIdea[]>(IDEAS_PATH,[],rows=>{
  if(!rows.some(r=>r.id===id))throw Error('ideas_missing');
  return rows.map(r=>r.id===id?{...r,comments:[...(r.comments||[]),comment]}:r);
 });
}
