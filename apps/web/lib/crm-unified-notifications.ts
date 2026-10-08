import {canReadRegisteredCustomers} from './account/crm-accounts';
import {isPlatformTeam} from './platform-access';
import {hasCrmPermission} from './crm-permissions';
import {notificationReplyTarget,type NotificationReplyTarget} from './notification-reply';
import {readChunkedDataJson} from './data';
import {canSeeLead} from './crm-visibility';
import {isAdminRole,type AuthUser} from './auth';
import {teamNotices,notificationReceipts} from './crm-notification-store';
import {readReminders} from './crm-reminders';
import {readStaffProfiles,nextBirthday,teamToday} from './crm-team';
import {readCrmUsers} from './crm-users';
export type CrmNotice={id:string;title:string;text:string;href?:string;createdAt:string;unread:boolean;kind:string;reminderId?:string;replyTarget?:NotificationReplyTarget};
export async function readNotifications(user:AuthUser){
 const [stored,receipts,reminders,profiles,users]=await Promise.all([teamNotices(user.id),notificationReceipts(user.id),readReminders(user),isAdminRole(user.role)?readStaffProfiles():Promise.resolve({}),isAdminRole(user.role)?readCrmUsers():Promise.resolve([])]);
 const commentNotices=stored.filter(n=>n.kind==='comment');
 const [leads,clients]=commentNotices.length?await Promise.all([readChunkedDataJson<any>('leads/leads.json',[]),readChunkedDataJson<any>('clients/clients.json',[])]):[[],[]];
 const accessible=stored.filter(n=>n.kind==='recovery'?canReadRegisteredCustomers(user):n.kind!=='comment'||canSeeLead(user,(n.entityType==='lead'?leads:clients).find(e=>e.id===n.entityId)));
 const notices:CrmNotice[]=accessible.map(n=>({id:n.id,title:n.title,text:n.text,href:n.kind==='registration'&&/^customer_registered:[a-f0-9]{64}$/.test(n.id)?`/crm/clients/registered/${n.id.split(':')[1]}`:n.href,createdAt:n.createdAt,kind:n.kind,unread:!receipts[n.id],replyTarget:notificationReplyTarget(n)}));
 const today=teamToday();
 for(const u of users){if(u.status==='disabled')continue;const birth=(profiles as Record<string,{birthDate?:string}>)[u.id]?.birthDate;if(!birth)continue;const day=nextBirthday(birth),days=Math.round((Date.parse(day)-Date.parse(today))/86400000);if(days>2)continue;const id=`birthday_${u.id}_${day}`;notices.push({id,title:days===0?`Сегодня день рождения: ${u.displayName}`:`День рождения через ${days===1?'1 день':'2 дня'}: ${u.displayName}`,text:day.split('-').reverse().join('.'),href:`/crm/managers?month=${day.slice(0,7)}&date=${day}#team-schedule`,createdAt:`${day}T00:00:00+07:00`,kind:'birthday',unread:!receipts[id]});}
 for(const row of reminders.filter(r=>!r.doneAt&&r.notify&&Date.parse(r.dueAt)<=Date.now())){const id=`reminder_${row.id}`;notices.push({id,title:`Напоминание: ${row.entityLabel}`,text:row.text,href:row.canOpen?(row.entityType==='client'?`/crm/clients/${encodeURIComponent(row.entityId)}`:`/crm/leads?id=${encodeURIComponent(row.entityId)}`):undefined,createdAt:row.dueAt,kind:'reminder',reminderId:row.id,unread:!receipts[id]});}
 if(isPlatformTeam(user)&&hasCrmPermission(user,'chat'))for(const n of notices)n.replyTarget||={kind:'notice',noticeId:n.id};
 return {notifications:notices.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,100),reminders:reminders.filter(r=>!r.doneAt)};
}
