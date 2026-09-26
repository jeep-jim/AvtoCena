import {isAdminRole,type AuthUser} from './auth';
import {teamNotices,notificationReceipts} from './crm-notification-store';
import {readReminders} from './crm-reminders';
import {readStaffProfiles,nextBirthday,teamToday} from './crm-team';
import {readCrmUsers} from './crm-users';
export type CrmNotice={id:string;title:string;text:string;href?:string;createdAt:string;unread:boolean;kind:string;reminderId?:string};
export async function readNotifications(user:AuthUser){
 const [stored,receipts,reminders,profiles,users]=await Promise.all([teamNotices(user.id),notificationReceipts(user.id),readReminders(user),isAdminRole(user.role)?readStaffProfiles():Promise.resolve({}),isAdminRole(user.role)?readCrmUsers():Promise.resolve([])]);
 const notices:CrmNotice[]=stored.map(n=>({id:n.id,title:n.title,text:n.text,href:n.href,createdAt:n.createdAt,kind:n.kind,unread:!receipts[n.id]}));
 const today=teamToday();
 for(const u of users){if(u.status==='disabled')continue;const birth=(profiles as Record<string,{birthDate?:string}>)[u.id]?.birthDate;if(!birth)continue;const day=nextBirthday(birth),days=Math.round((Date.parse(day)-Date.parse(today))/86400000);if(days>2)continue;const id=`birthday_${u.id}_${day}`;notices.push({id,title:days===0?`Сегодня день рождения: ${u.displayName}`:`День рождения через ${days===1?'1 день':'2 дня'}: ${u.displayName}`,text:day.split('-').reverse().join('.'),href:`/crm/managers?month=${day.slice(0,7)}&date=${day}#team-schedule`,createdAt:`${day}T00:00:00+07:00`,kind:'birthday',unread:!receipts[id]});}
 for(const row of reminders.filter(r=>!r.doneAt&&r.notify&&Date.parse(r.dueAt)<=Date.now())){const id=`reminder_${row.id}`;notices.push({id,title:`Напоминание: ${row.entityLabel}`,text:row.text,href:row.canOpen?(row.entityType==='client'?`/crm/clients/${encodeURIComponent(row.entityId)}`:`/crm/leads?id=${encodeURIComponent(row.entityId)}`):undefined,createdAt:row.dueAt,kind:'reminder',reminderId:row.id,unread:!receipts[id]});}
 return {notifications:notices.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100),reminders:reminders.filter(r=>!r.doneAt)};
}
