import {getCurrentUser} from '@/lib/auth';
import {canManageDealer} from '@/lib/dealers/access';
import {updateCrmUser} from '@/lib/crm-users';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
export async function POST(request:Request){const user=await getCurrentUser();if(!isCalculationOriginAllowed(request)||!user?.companyId||!await canManageDealer(user,user.companyId))return Response.json({error:'Нет доступа'},{status:403});try{const raw=await request.text();if(raw.length>2000)throw Error('Слишком большой запрос');const b=JSON.parse(raw),name=String(b.name||'').trim(),phone=String(b.phone||'').trim();if(!name||name.length>100||phone.length>30)throw Error('Проверьте имя и телефон');await updateCrmUser(user.id,{displayName:name,personalPhone:phone});return Response.json({ok:true});}catch(e){return Response.json({error:e instanceof Error?e.message:'Не удалось сохранить'},{status:400});}}
