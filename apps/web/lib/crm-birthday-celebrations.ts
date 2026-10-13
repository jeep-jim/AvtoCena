import type {AuthUser} from './auth';
import {isPlatformTeam} from './platform-access';
import {birthdayOn,teamToday,validDay,type StaffProfile} from './crm-team';
import {mutateDataJson} from './data';
import {noticeReadKey} from './crm-notification-store';
export type BirthdayCelebration={id:string;name:string;avatarUrl?:string;day:string};
export function birthdayCelebrations(viewer:AuthUser,users:AuthUser[],profiles:Record<string,StaffProfile>,receipts:Record<string,string>,now=new Date()):BirthdayCelebration[]{
 if(!isPlatformTeam(viewer))return [];
 const day=teamToday(now),year=Number(day.slice(0,4));
 return users.filter(isPlatformTeam).flatMap(user=>{
  const birth=profiles[user.id]?.birthDate;
  if(!birth||!validDay(birth)||birthdayOn(birth,year)!==day)return [];
  const id=`birthday-card:${day}:${user.id}`;
  return receipts[id]?[]:[{id,day,name:user.displayName,avatarUrl:user.avatarUrl}];
 });
}
// Separate from the bell, with conditional storage updates across tabs/devices.
export async function claimBirthdayCelebration(viewerId:string,id:string){
 let claimed=false;
 await mutateDataJson<Record<string,string>>(noticeReadKey(viewerId),{},rows=>{
  claimed=!rows[id];
  if(!claimed)return rows;
  return {...Object.fromEntries(Object.entries(rows).filter(([,at])=>Date.parse(at)>Date.now()-120*86400000)),[id]:new Date().toISOString()};
 });
 return claimed;
}
