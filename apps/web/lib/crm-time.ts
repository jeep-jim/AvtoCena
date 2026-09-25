export const CRM_TIME_ZONE = 'Asia/Novokuznetsk';
export function crmDateTime(value: unknown) {
 const date = new Date(String(value || ''));
 return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('ru-RU', {timeZone:CRM_TIME_ZONE,dateStyle:'short',timeStyle:'short'}).format(date) : '';
}
export function crmDateKey(value: unknown) {
 const date = new Date(String(value || ''));
 return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', {timeZone:CRM_TIME_ZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(date) : '';
}
export const clientManagerId = (client: {assignedManagerId?:string;createdByManagerId?:string}) => client.assignedManagerId || client.createdByManagerId || '';
