import {createHash,randomUUID} from 'node:crypto';
import {appendChunkedDataJson,mutateDataJson,readDataJson,readRecentChunkedDataJson} from './data';
export type TeamNotice={id:string;createdAt:string;recipientIds:string[];title:string;text:string;href:string;kind:'schedule'|'assignment'|'staff';};
export const noticeReadKey=(id:string)=>`crm/notification-read/${createHash('sha256').update(id).digest('hex')}.json`;
export async function notifyTeam(input:Omit<TeamNotice,'id'|'createdAt'>&Partial<Pick<TeamNotice,'id'|'createdAt'>>){if(!input.recipientIds.length)return;await appendChunkedDataJson<TeamNotice>('crm/notifications.json',{...input,id:input.id||randomUUID(),createdAt:input.createdAt||new Date().toISOString(),recipientIds:[...new Set(input.recipientIds)]});}
export async function teamNotices(userId:string){return readRecentChunkedDataJson<TeamNotice>('crm/notifications.json',80,n=>n.recipientIds.includes(userId));}
export async function notificationReceipts(id:string){return readDataJson<Record<string,string>>(noticeReadKey(id),{});}
export async function markNotificationsRead(id:string,ids:string[]){await mutateDataJson<Record<string,string>>(noticeReadKey(id),{},rows=>Object.fromEntries(Object.entries({...rows,...Object.fromEntries(ids.slice(0,150).map(key=>[key,new Date().toISOString()]))}).filter(([,at])=>Date.parse(at)>Date.now()-120*86400000)));}
