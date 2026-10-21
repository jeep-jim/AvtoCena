import {randomUUID} from 'node:crypto';
import {getCurrentUser,isCrmRole} from '@/lib/auth';
import {hasCrmPermission} from '@/lib/crm-permissions';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {discussionEntity,addDiscussionMessage} from '@/lib/crm-discussion-store';
import {discussionMessages,type DiscussionType} from '@/lib/crm-discussion';
import {getJsonStorage} from '@/lib/data';
import {readDocumentForm,prepareClientDocument,encryptClientDocument,decryptClientDocument} from '@/lib/client-documents';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
const keyFor=(type:string,id:string,file:string)=>`crm/discussion-files/${type}/${encodeURIComponent(id)}/${file}.enc`;
export async function POST(request:Request){
 const user=await getCurrentUser();
 if(!user||!isCrmRole(user.role)||!isCalculationOriginAllowed(request))return Response.json({error:'Нет доступа.'},{status:403,headers});
 let key='',type:DiscussionType='lead',id='',attachmentId='';const storage=getJsonStorage();
 try{
  const form=await readDocumentForm(request);type=form.get('type') as DiscussionType;id=String(form.get('id')||'');
  const entity=await discussionEntity(user,type,id);
  if(!hasCrmPermission(user,type==='lead'?'editLeads':'editClients'))throw Error('discussion_forbidden');
  const operationId=String(form.get('operationId')||'');if(!/^[a-zA-Z0-9_-]{8,100}$/.test(operationId))throw Error('format');
  const upload=form.get('file');if(!(upload instanceof File))throw Error('format');
  const prepared=await prepareClientDocument(upload);
  if(discussionMessages(entity).filter(n=>n.attachment).length>=100)throw Error('limit');
  if(!storage.putBinary||!storage.deleteBinary)throw Error('storage');
  attachmentId=randomUUID();key=keyFor(type,id,attachmentId);
  await storage.putBinary(key,encryptClientDocument(prepared.data,key),'application/octet-stream');
  const result=await addDiscussionMessage(user,type,id,{text:String(form.get('text')||'').trim()||prepared.name,replyTo:String(form.get('replyTo')||''),operationId},{id:attachmentId,name:prepared.name,mime:prepared.mime,size:upload.size});
  if(!result.messages.some(n=>n.attachment?.id===attachmentId))await storage.deleteBinary(key);
  return Response.json(result,{headers});
 }catch(error){
  if(key){try{const current=await discussionEntity(user,type,id);if(!discussionMessages(current).some(n=>n.attachment?.id===attachmentId))await storage.deleteBinary?.(key);}catch{/* Do not remove a possibly committed attachment after a storage failure. */}}
  const code=error instanceof Error?error.message:'';
  return Response.json({error:code==='size'?'Файл должен быть не больше 5 МБ.':code==='format'?'Выберите JPG, PNG, WebP, PDF, DOC, DOCX или XLSX.':code==='limit'?'В обсуждении уже 100 вложений.':code==='discussion_forbidden'?'Нет доступа к обсуждению.':'Не удалось прикрепить файл. Повторите отправку.'},{status:code==='discussion_forbidden'?403:400,headers});
 }
}
export async function GET(request:Request){
 const user=await getCurrentUser();if(!user||!isCrmRole(user.role))return new Response(null,{status:401,headers});
 try{const q=new URL(request.url).searchParams,type=q.get('type') as DiscussionType,id=q.get('id')||'';
 const entity=await discussionEntity(user,type,id),attachment=discussionMessages(entity).find(n=>n.attachment?.id===q.get('file'))?.attachment;
 if(!attachment)return new Response(null,{status:404,headers});
 const key=keyFor(type,id,attachment.id),raw=await getJsonStorage().getBinary?.(key);if(!raw)return new Response(null,{status:404,headers});
 return new Response(new Uint8Array(decryptClientDocument(raw.data,key)),{headers:{...headers,'Content-Type':attachment.mime,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,'X-Content-Type-Options':'nosniff'}});
 }catch{return new Response(null,{status:404,headers});}
}
