export const shiftKinds = {work:'Рабочий день',off:'Выходной',vacation:'Отпуск',sick:'Больничный',note:'Отметка'} as const;
export type ShiftKind = keyof typeof shiftKinds;
export const calendarToday = () => new Date(Date.now()+7*3600000).toISOString().slice(0,10);
export const addCalendarDays = (date:string,n:number) => new Date(Date.parse(`${date}T12:00:00Z`)+n*86400000).toISOString().slice(0,10);
export function monthDays(month:string){const count=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();return Array.from({length:count},(_,i)=>`${month}-${String(i+1).padStart(2,'0')}`);}
export function shiftKind(row?:{kind?:ShiftKind;start:string}):ShiftKind|undefined{return row?(row.kind||(row.start?'work':'off')):undefined;}
export function shiftLabel(row?:{kind?:ShiftKind;start:string;end:string;note?:string}){const kind=shiftKind(row);return kind==='work'?`${row!.start}–${row!.end}`:kind?shiftKinds[kind]:'Не заполнено';}
export function patternDates(month:string,pattern:'all'|'weekdays'|'2/2',anchor:string){return monthDays(month).filter(date=>{if(pattern==='all')return true;if(pattern==='weekdays'){const day=new Date(`${date}T12:00:00Z`).getUTCDay();return day!==0&&day!==6;}const diff=Math.round((Date.parse(date)-Date.parse(anchor))/86400000);return diff>=0&&diff%4<2;});}
