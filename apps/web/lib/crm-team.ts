import {workOptions} from './staff-workplaces';
import {isCrmRole,type AuthUser} from './auth';
import {readDataJson,mutateDataJson} from './data';
import {readCrmUsers} from './crm-users';
import {notifyTeam} from './crm-notification-store';
import {recordCrmActivity} from './crm-activity';
export type StaffProfile={birthDate?:string};
import {shiftKinds,shiftLabel,type ShiftKind} from './crm-schedule-calendar';
export type Shift={workplace?:string;kind?:ShiftKind;date:string;userId:string;start:string;end:string;note:string;updatedAt:string;updatedBy:string};
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
 const rows=await saveShifts(actor,{...input,dates:[input.date],expectedUpdates:{[input.date]:input.expectedUpdatedAt||''}});return rows[0];
}
export async function saveShifts(actor:AuthUser,input:any){
 if(!isCrmRole(actor.role)||actor.status==='disabled')throw Error('Нет доступа.');
 if(input.confirmed!==true)throw Error('Подтвердите изменение графика.');
 const dates:unknown=input.dates;
 if(!Array.isArray(dates)||!dates.length||dates.length>31||dates.some(d=>typeof d!=='string'||!validDay(d)||d<'2020-01-01'||d>'2100-12-31')||new Set(dates).size!==dates.length)throw Error('Некорректная дата.');
 const ordered=(dates as string[]).slice().sort(),month=ordered[0].slice(0,7);
 if(ordered.some(d=>d.slice(0,7)!==month))throw Error('Выберите даты в пределах одного месяца.');
 const {userId}=input;
 const target=(await readCrmUsers()).find(u=>u.id===userId&&isCrmRole(u.role)&&u.status!=='disabled');if(!target)throw Error('Сотрудник не найден.');
 const kind:ShiftKind=input.kind??(input.off===true?'off':'work'),clear=input.clear===true;
 if(!Object.hasOwn(shiftKinds,kind))throw Error('Некорректная отметка.');
 const dayKinds=input.dayKinds;
 if(dayKinds!==undefined&&(!dayKinds||typeof dayKinds!=='object'||Array.isArray(dayKinds)||Object.keys(dayKinds).length!==ordered.length||Object.keys(dayKinds).some(d=>!ordered.includes(d))||ordered.some(d=>!['work','off'].includes(dayKinds[d]))))throw Error('Проверьте рабочие и выходные дни.');
 const kindFor=(date:string):ShiftKind=>dayKinds?.[date]??kind;
 const start=String(input.start||''),end=String(input.end||''),note=String(input.note||'').trim();
 if(note.length>300)throw Error('Заметка — не более 300 символов.');
 if(!clear&&ordered.some(d=>kindFor(d)==='note')&&!note)throw Error('Добавьте текст отметки.');
 if(!clear&&ordered.some(d=>kindFor(d)==='work')&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(end)||end<=start))throw Error('Укажите начало и конец смены в пределах дня.');
 const workplace=typeof input.workplace==='string'?input.workplace.trim():undefined;
 if(input.workplace!==undefined&&(workplace===undefined||workplace.length>240))throw Error('Проверьте место работы.');
 const updatedAt=new Date().toISOString();
 const changed:Shift[]=ordered.map(date=>({date,userId,kind:kindFor(date),start:kindFor(date)==='work'?start:'',end:kindFor(date)==='work'?end:'',note,updatedAt,updatedBy:actor.id}));
 let previous:Shift[]=[];
 await mutateDataJson<Shift[]>(scheduleKey(month),[],rows=>{
  previous=rows.filter(r=>r.userId===userId&&ordered.includes(r.date));
  if(!clear&&workplace&&ordered.some(date=>kindFor(date)==='work'&&!workOptions(target).includes(workplace)&&previous.find(r=>r.date===date)?.workplace!==workplace))throw Error('Добавьте этот адрес или удалённую работу в карточке сотрудника.');
  for(const row of changed){row.workplace=row.kind==='work'?(workplace??previous.find(r=>r.date===row.date)?.workplace??''):'';}
  if(ordered.some(date=>(previous.find(r=>r.date===date)?.updatedAt||'')!==String(input.expectedUpdates?.[date]||'')))throw Error('График уже изменён. Обновите календарь и повторите.');
  return [...rows.filter(r=>r.userId!==userId||!ordered.includes(r.date)),...(clear?[]:changed)];
 });
 const label=clear?'Не заполнено':dayKinds?`рабочих дней: ${changed.filter(s=>s.kind==='work').length}, выходных: ${changed.filter(s=>s.kind==='off').length}`:shiftLabel(changed[0]),dateLabel=ordered.length===1?ordered[0].split('-').reverse().join('.'):ordered.map(d=>d.slice(8)).join(', ')+'.'+month.slice(5)+'.'+month.slice(0,4);
 const text=`${actor.displayName}: ${dateLabel} — ${label}${!clear&&workplace&&changed.some(s=>s.kind==='work')?`. Место работы: ${workplace}`:''}${!clear&&note?`. ${note}`:''}`,href=`/crm/managers?month=${month}&date=${ordered[0]}#team-schedule`;
 await notifyTeam({id:`shift_${userId}_${ordered[0]}_${updatedAt}`,recipientIds:userId===actor.id?[]:[userId],kind:'schedule',title:'Ваш рабочий график изменён',text,href});
 await recordCrmActivity(actor,{type:'schedule_changed',title:`Изменён график: ${target.displayName}`,entityType:'staff',entityId:userId,entityLabel:target.displayName,target:{id:userId,name:target.displayName,avatarUrl:target.avatarUrl},href,changes:ordered.map(date=>({label:date,before:[shiftLabel(previous.find(r=>r.date===date)),previous.find(r=>r.date===date)?.workplace].filter(Boolean).join(' · '),after:clear?'Не заполнено':[shiftLabel(changed.find(r=>r.date===date)),changed.find(r=>r.date===date)?.workplace].filter(Boolean).join(' · ')})),text:clear?'Отметки удалены':note});
 return clear?[]:changed;
}
