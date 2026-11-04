import {getCurrentUser} from '@/lib/auth';
import {assertWorkspace} from '@/lib/crm-workspace-access';
import {isDealerWorkspace} from '@/lib/crm-workspace';
import {readReminders,createReminder,finishReminder} from '@/lib/crm-reminders';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
const headers={'Cache-Control':'private, no-store'};
export const dynamic='force-dynamic';
export async function GET(request:Request){const user=await getCurrentUser();if(!isDealerWorkspace(user))return Response.json({error:'auth_required'},{status:401,headers});try{await assertWorkspace(user);const q=new URL(request.url).searchParams;return Response.json({reminders:(await readReminders(user)).filter(r=>!r.doneAt&&(!q.get('entityId')||r.entityId===q.get('entityId')))},{headers});}catch{return Response.json({error:'forbidden'},{status:403,headers});}}
export async function POST(request:Request){if(!isCalculationOriginAllowed(request))return Response.json({error:'origin_forbidden'},{status:403,headers});const user=await getCurrentUser();if(!isDealerWorkspace(user))return Response.json({error:'auth_required'},{status:401,headers});try{await assertWorkspace(user);const raw=await request.text();if(raw.length>4000)throw Error('invalid_reminder');const body=JSON.parse(raw);if(body.action==='done'){await finishReminder(user,String(body.id||''));return Response.json({ok:true},{headers});}return Response.json({reminder:await createReminder(user,body)},{headers});}catch{return Response.json({error:'Проверьте текст, дату и доступ к записи.'},{status:400,headers});}}
