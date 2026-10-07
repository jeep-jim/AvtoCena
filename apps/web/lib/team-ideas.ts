import {randomUUID} from 'node:crypto';
import type {AuthUser} from './auth';
import {isPlatformTeam,isPlatformOwner} from './platform-access';
import {readDataJson,mutateDataJson} from './data';

export type TeamIdea={id:string;title:string;description:string;authorId:string;authorName:string;createdAt:string;updatedAt:string;progress:number;votes:string[];screenshots:string[]};
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
  if(typeof value!=='boolean')throw Error('Некорректный голос.');
  return {...row,votes:value?[...new Set([...row.votes,user.id])]:row.votes.filter(id=>id!==user.id)};
 }
 if(action==='progress'){
  if(!isPlatformOwner(user))throw Error('ideas_forbidden');
  if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>100)throw Error('Готовность — от 0 до 100%.');
  return {...row,progress:value,updatedAt:new Date().toISOString()};
 }
 throw Error('Неизвестное действие.');
}
export async function listIdeas(user:AuthUser){requireIdeaTeam(user);return readDataJson<TeamIdea[]>(IDEAS_PATH,[]);}
export async function createIdea(user:AuthUser,input:{title:unknown;description:unknown},screenshots:string[],id=randomUUID()){
 requireIdeaTeam(user);const fields=ideaInput(input);
 if(screenshots.length>5||screenshots.some(s=>!new RegExp(`^${id}/[0-4]\\.webp$`).test(s)))throw Error('Некорректные скриншоты.');
 const at=new Date().toISOString();const row:TeamIdea={id,...fields,authorId:user.id,authorName:user.displayName||'Сотрудник',createdAt:at,updatedAt:at,progress:0,votes:[],screenshots};
 await mutateDataJson<TeamIdea[]>(IDEAS_PATH,[],rows=>[row,...rows]);return row;
}
export async function updateIdea(user:AuthUser,id:string,action:unknown,value:unknown){
 requireIdeaTeam(user);
 await mutateDataJson<TeamIdea[]>(IDEAS_PATH,[],rows=>{if(!rows.some(r=>r.id===id))throw Error('ideas_missing');return rows.map(row=>row.id===id?changeIdea(row,user,action,value):row);});
}
export function publicIdea(row:TeamIdea,user:AuthUser){return {...row,votes:undefined,voteCount:row.votes.length,voted:row.votes.includes(user.id)};}
