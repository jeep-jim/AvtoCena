export const shiftKinds = {work:'Рабочий день',off:'Выходной',vacation:'Отпуск',sick:'Больничный',note:'Отметка'} as const;
export type ShiftKind = keyof typeof shiftKinds;
export const calendarToday = () => new Date(Date.now()+7*3600000).toISOString().slice(0,10);
export const addCalendarDays = (date:string,n:number) => new Date(Date.parse(`${date}T12:00:00Z`)+n*86400000).toISOString().slice(0,10);
export function monthDays(month:string){const count=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();return Array.from({length:count},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);}
export function shiftKind(row?:{kind?:ShiftKind;start:string}):ShiftKind|undefined{return row?(row.kind||(row.start?'work':'off')):undefined;}
export function shiftLabel(row?:{kind?:ShiftKind;start:string;end:string;note?:string}){const kind=shiftKind(row);return kind==='work'?`${row!.start}–${row!.end}`:kind?shiftKinds[kind]:'Не заполнено';}
export function patternDates(month:string,pattern:'all'|'weekdays'|'2/2',anchor:string){return monthDays(month).filter(date=>{if(pattern==='all')return true;if(pattern==='weekdays'){const day=new Date(`${date}T12:00:00Z`).getUTCDay();return day!==0&&day!==6;}const diff=Math.round((Date.parse(date)-Date.parse(anchor))/86400000);return diff>=0&&diff%4<2;});}
export function defaultScheduleStart(month:string,today=calendarToday()){return today.slice(0,7)===month?today:`${month}-01`;}
export type SchedulePattern={from:string;to:string;anchor:string;workDays:number;restDays:number;mode:'cycle'|'weekdays'};
export function schedulePattern(input:SchedulePattern):{date:string;kind:'work'|'off'}[]{
 const valid=(d:string)=>/^\d{4}-(0[1-9]|1[0-2])-\d{2}$/.test(d)&&monthDays(d.slice(0,7)).includes(d);
 if(!valid(input.from)||!valid(input.to)||input.from>input.to||input.from.slice(0,7)!==input.to.slice(0,7))return [];
 if(input.mode==='cycle'&&(!valid(input.anchor)||![input.workDays,input.restDays].every(n=>Number.isInteger(n)&&n>=1&&n<=31)))return [];
 const cycle=input.workDays+input.restDays;
 return monthDays(input.from.slice(0,7)).filter(d=>d>=input.from&&d<=input.to).map(date=>{
  const elapsed=Math.round((Date.parse(date)-Date.parse(input.anchor))/86400000),weekday=new Date(`${date}T12:00:00Z`).getUTCDay();
  const work=input.mode==='weekdays'?weekday!==0&&weekday!==6:((elapsed%cycle)+cycle)%cycle<input.workDays;
  return {date,kind:work?'work':'off'};
 });
}
