import {getCurrentUser,isCrmRole} from '@/lib/auth';
import {readNotifications} from '@/lib/crm-unified-notifications';
import {markNotificationsRead} from '@/lib/crm-notification-store';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
const headers={'Cache-Control':'private, no-store'};
export const dynamic='force-dynamic';
export async function GET(){const user=await getCurrentUser();if(!user||!isCrmRole(user.role))return Response.json({error:'auth_required'},{status:401,headers});return Response.json(await readNotifications(user),{headers});}
export async function POST(request:Request){if(!isCalculationOriginAllowed(request))return Response.json({error:'origin_forbidden'},{status:403});const user=await getCurrentUser();if(!user||!isCrmRole(user.role))return Response.json({error:'auth_required'},{status:401});try{const raw=await request.text();if(raw.length>24000)throw Error();const b=JSON.parse(raw);if(!Array.isArray(b.ids)||b.ids.length>150||b.ids.some((id:unknown)=>typeof id!=='string'||id.length>250))throw Error();const current=await readNotifications(user),allowed=new Set(current.notifications.map(n=>n.id));await markNotificationsRead(user.id,b.ids.filter((id:string)=>allowed.has(id)));return Response.json({ok:true},{headers});}catch{return Response.json({error:'Не удалось сохранить отметку.'},{status:400,headers});}}
