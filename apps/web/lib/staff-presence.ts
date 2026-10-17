import {mutateDataJson,readDataJson} from './data';
export const STAFF_ONLINE_WINDOW_MS=120_000;
const key=(id:string)=>`auth/presence/${encodeURIComponent(id)}.json`;
export async function touchStaffPresence(id:string,now=Date.now()){
 await mutateDataJson<{lastSeenAt?:string}>(key(id),{},current=>({lastSeenAt:new Date(Math.max(Date.parse(current.lastSeenAt||'')||0,now)).toISOString()}));
}
export async function readStaffPresence(id:string){return readDataJson<{lastSeenAt?:string}>(key(id),{});}
export function staffIsOnline(lastSeenAt:string|undefined,now=Date.now()){const at=Date.parse(lastSeenAt||'');return Number.isFinite(at)&&at<=now&&now-at<STAFF_ONLINE_WINDOW_MS;}
