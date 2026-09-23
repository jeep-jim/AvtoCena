import {createHash} from 'node:crypto';
import {getCurrentUser,isAdminRole,isCrmRole} from '@/lib/auth';
import {readCrmUsers,updateCrmUser} from '@/lib/crm-users';
import {getJsonStorage} from '@/lib/data';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {MAX_AVATAR_BYTES,normalizeStaffAvatar} from '@/lib/staff-avatar';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(error:string,status:number)=>Response.json({error},{status});
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 if(!isCalculationOriginAllowed(request))return json('origin_forbidden',403);
 const actor=await getCurrentUser();if(!actor||!isCrmRole(actor.role))return json('auth_required',401);
 const {id}=await params;
 if(actor.id!==id&&!isAdminRole(actor.role))return json('forbidden',403);
 const user=(await readCrmUsers()).find(u=>u.id===id);if(!user)return json('not_found',404);
 if(actor.role!=='owner'&&actor.id!==id&&(user.role==='owner'||user.companyId!==actor.companyId))return json('forbidden',403);
 if(Number(request.headers.get('content-length'))>MAX_AVATAR_BYTES+65536)return json('Файл больше 5 МБ.',413);
 try{
   const form=await request.formData(),file=form.get('photo');
   if(!(file instanceof File))return json('Выберите фотографию.',400);
   if(file.size>MAX_AVATAR_BYTES)return json('Файл больше 5 МБ.',413);
   const data=await normalizeStaffAvatar(Buffer.from(await file.arrayBuffer()));
   const version=createHash('sha256').update(data).digest('hex').slice(0,24);
   const key=`auth/avatars/${encodeURIComponent(id)}/${version}.webp`;
   const storage=getJsonStorage();if(!storage.putBinary)throw Error('Хранилище недоступно.');
   await storage.putBinary(key,data,'image/webp');
   const avatarUrl=`/api/crm/users/${encodeURIComponent(id)}/avatar?v=${version}`;
   await updateCrmUser(id,{avatarUrl});
   return Response.json({ok:true,avatarUrl});
 }catch{return json('Не удалось обработать фотографию. Проверьте формат и размер файла (до 5 МБ).',400);}
}
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
 const actor=await getCurrentUser();if(!actor||!isCrmRole(actor.role))return json('auth_required',401);
 const {id}=await params,version=new URL(request.url).searchParams.get('v')||'';
 if(!/^[a-f0-9]{24}$/.test(version))return json('not_found',404);
 const user=(await readCrmUsers()).find(u=>u.id===id);
 if(!user || (actor.role!=='owner' && actor.companyId!==user.companyId))return json('not_found',404);
 try{const data=await getJsonStorage().getBinary?.(`auth/avatars/${encodeURIComponent(id)}/${version}.webp`);if(!data)return json('not_found',404);return new Response(new Uint8Array(data.data),{headers:{'content-type':'image/webp','cache-control':'private, max-age=3600','x-content-type-options':'nosniff'}});}catch{return json('not_found',404);}
}
