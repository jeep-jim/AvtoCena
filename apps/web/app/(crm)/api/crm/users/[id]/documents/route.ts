import {randomUUID} from 'node:crypto';
import {getCurrentUser} from '@/lib/auth';
import {getJsonStorage,mutateDataJson} from '@/lib/data';
import {staffDocumentAccess,staffDocumentIndex,staffDocumentKey,readStaffDocuments} from '@/lib/staff-documents';
import {encryptClientDocument,prepareClientDocument,readDocumentForm,MAX_CLIENT_DOCUMENTS,type ClientDocument} from '@/lib/client-documents';
import {isCalculationOriginAllowed} from '@/lib/catalog/calculation-request-origin';
import {recordCrmActivity} from '@/lib/crm-activity';
export const runtime='nodejs';export const dynamic='force-dynamic';
const headers={'Cache-Control':'private, no-store'};
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){const actor=await getCurrentUser();if(!actor)return Response.json({error:'Войдите в CRM.'},{status:401,headers});try{const {id}=await params;await staffDocumentAccess(actor,id);return Response.json({documents:(await readStaffDocuments(id)).filter(d=>!d.deletedAt)},{headers});}catch{return Response.json({error:'Нет доступа к документам сотрудника.'},{status:403,headers});}}
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 if(!isCalculationOriginAllowed(request))return Response.json({error:'Недопустимый источник.'},{status:403});const actor=await getCurrentUser();if(!actor)return Response.json({error:'Войдите в CRM.'},{status:401});const storage=getJsonStorage();let key='',stored=false;
 try{const {id}=await params;await staffDocumentAccess(actor,id,true);const form=await readDocumentForm(request),file=form.get('file');if(!(file instanceof File))throw Error('format');const prepared=await prepareClientDocument(file);const doc:ClientDocument={id:randomUUID(),name:prepared.name,mime:prepared.mime,size:file.size,createdAt:new Date().toISOString(),createdBy:actor.id,hasThumbnail:false};key=staffDocumentKey(id,doc.id);if(!storage.putBinary||!storage.deleteBinary)throw Error('storage');await storage.putBinary(key,encryptClientDocument(Buffer.from(JSON.stringify({data:prepared.data.toString('base64')})),key),'application/octet-stream');stored=true;
 await mutateDataJson<ClientDocument[]>(staffDocumentIndex(id),[],rows=>{if(rows.filter(d=>!d.deletedAt).length>=MAX_CLIENT_DOCUMENTS)throw Error('limit');return [...rows,doc];});stored=false;
 await recordCrmActivity(actor,{type:'staff_document_uploaded',title:'Добавлен документ сотрудника',visibility:'management',entityType:'staff',entityId:id,href:`/crm/managers/${encodeURIComponent(id)}#staff-documents`,text:'Файл сохранён в защищённом разделе сотрудника.'});return Response.json({document:doc},{headers});
 }catch(e){if(stored)await storage.deleteBinary?.(key).catch(()=>{});const code=e instanceof Error?e.message:'';return Response.json({error:({forbidden:'Нет доступа к документам сотрудника.',format:'Поддерживаются JPG, PNG, WebP, PDF, DOC, DOCX и XLSX.',size:'Максимальный размер — 5 МБ.',limit:'Допускается до 50 документов.'} as Record<string,string>)[code]||'Не удалось загрузить документ.'},{status:code==='forbidden'?403:400,headers});}
}
