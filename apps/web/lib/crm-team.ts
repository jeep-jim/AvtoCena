import {isCrmRole,type AuthUser} from './auth';
import {readDataJson,mutateDataJson} from './data';
import {readCrmUsers} from './crm-users';
import {notifyTeam} from './crm-notification-store';
import {recordCrmActivity} from './crm-activity';
export type StaffProfile={birthDate?:string};
export type Shift={date:string;userId:string;start:string;end:string;note:string;updatedAt:string;updatedBy:string};
export const teamToday=(now=new Date())=>new Date(now.getTime()+7*3600000).toISOString().slice(0,10);
export function validDay(value:string){const date=new Date(`${value}T00:00:00Z`);return /^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
export function validateBirthDate(value:string){if(value&&(!validDay(value)||value>teamToday()||value<'1900-01-01'))throw Error('Укажите корректную дату рождения.');return value;}
export async function readStaffProfiles(){return readDataJson<Record<string,StaffProfile>>('crm/staff-profiles.json',{});}
export async function saveStaffBirthDate(id:string,value:string){validateBirthDate(value);await mutateDataJson<Record<string,StaffProfile>>('crm/staff-profiles.json',{},rows=>({...rows,[id]:{...rows[id],birthDate:value}}));}
export function birthdayOn(birthDate:string,year:number){const md=birthDate.slice(5);const value=`${year}-${md}`;return md==='02-29'&&!validDay(value)?`${year}-02-28`:value;}
export function nextBirthday(birthDate:string,now=new Date()){if(!birthDate)return '';const today=teamToday(now),year=Number(today.slice(0,4)),date=birthdayOn(birthDate,year);return date>=today?date:birthdayOn(birthDate,year+1);}
export function scheduleKey(month:string){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Некорректный месяц.');return `crm/team-schedule/${month}.json`;}
export async function readSchedule(month:string){return readDataJson<Shift[]>(scheduleKey(month),[]);}
export async function saveShift(actor:AuthUser,input:any){
 if(!isCrmRole(actor.role)||actor.status==='disabled')throw Error('Нет доступа.');
 if(input.confirmed!==true)throw Error('Подтвердите изменение графика.');
 const {date,userId}=input;if(typeof date!=='string'||!validDay(date)||date<'2020-01-01'||date>'2100-12-31')throw Error('Некорректная дата.');
 const target=(await readCrmUsers()).find(u=>u.id===userId&&isCrmRole(u.role)&&u.status!=='disabled');if(!target)throw Error('Сотрудник не найден.');
 const start=String(input.start||''),end=String(input.end||''),off=input.off===true;
 if(!off&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||end<=start))throw Error('Укажите начало и конец смены в пределах дня.');
 const row:Shift={date,userId,start:off?'':start,end:off?'':end,note:String(input.note||'').trim().slice(0,300),updatedAt:new Date().toISOString(),updatedBy:actor.id};let previous:Shift|undefined;
 await mutateDataJson<Shift[]>(scheduleKey(date.slice(0,7)),[],rows=>{previous=rows.find(r=>r.date===date&&r.userId===userId);if((previous?.updatedAt||'')!==String(input.expectedUpdatedAt||''))throw Error('График уже изменён. Обновите календарь и повторите.');return [...rows.filter(r=>r.date!==date||r.userId!==userId),row];});
 const label=off?'Выходной':`${start}–${end}`,text=`${actor.displayName}: ${date.split('-').reverse().join('.')} — ${label}${row.note?`. ${row.note}`:''}`;
 await notifyTeam({id:`shift_${userId}_${date}_${row.updatedAt}`,recipientIds:userId===actor.id?[]:[userId],kind:'schedule',title:'Ваш рабочий график изменён',text,href:`/crm/managers?month=${date.slice(0,7)}&date=${date}#team-schedule`});
 await recordCrmActivity(actor,{type:'schedule_changed',title:`Изменён график: ${target.displayName}`,entityType:'staff',entityId:userId,entityLabel:target.displayName,target:{id:userId,name:target.displayName,avatarUrl:target.avatarUrl},href:`/crm/managers?month=${date.slice(0,7)}&date=${date}#team-schedule`,changes:[{label:date,before:previous?.start?`${previous.start}–${previous.end}`:previous?'Выходной':'Не указано',after:label}],text:row.note});return row;
}
