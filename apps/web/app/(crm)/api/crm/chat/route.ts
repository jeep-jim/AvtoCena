import {getCurrentUser} from '@/lib/auth';
import {isPlatformTeam} from '@/lib/platform-access';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {chatList,chatDetail,createDirectChat,sendChatMessage} from '@/lib/crm-chat';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
function failure(e:unknown){const code=e instanceof Error?e.message:'';return Response.json({error:code==='chat_forbidden'?'Нет доступа к этой переписке или отправке сообщения.':code==='message_conflict'?'Этот запрос уже отправлен с другим текстом. Обновите переписку.':'Не удалось выполнить действие. Проверьте сообщение и повторите.'},{status:code==='chat_forbidden'?403:code==='message_conflict'?409:400,headers});}
export async function GET(req:Request){const user=await getCurrentUser();if(!user||!isPlatformTeam(user))return Response.json({error:'Нет доступа'},{status:403,headers});try{const id=new URL(req.url).searchParams.get('thread');return Response.json(id?await chatDetail(user,id):await chatList(user),{headers});}catch(e){return failure(e);}}
export async function POST(req:Request){const user=await getCurrentUser();if(!isCalculationOriginAllowed(req)||!user||!isPlatformTeam(user))return Response.json({error:'Нет доступа'},{status:403,headers});try{const raw=await req.text();if(raw.length>16000)throw Error();const b=JSON.parse(raw);return Response.json(b.action==='create'?await createDirectChat(user,b.recipientId):await sendChatMessage(user,String(b.thread||''),b),{headers});}catch(e){return failure(e);}}
