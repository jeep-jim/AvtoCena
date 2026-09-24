import {randomUUID} from "node:crypto";
import {getCurrentUser,isCrmRole} from "@/lib/auth";
import {canSeeLead} from "@/lib/crm-visibility";
import {getJsonStorage,readChunkedDataJson,updateChunkedDataJson} from "@/lib/data";
import {isCalculationOriginAllowed} from "@/lib/catalog/calculation-request-origin";
import {documentKey,encryptClientDocument,prepareClientDocument,readDocumentForm,MAX_CLIENT_FILE_BYTES,MAX_CLIENT_DOCUMENTS,type ClientDocument} from "@/lib/client-documents";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {
  if(!isCalculationOriginAllowed(request)) return Response.json({error:"Недопустимый источник запроса."},{status:403});
  const user=await getCurrentUser();
  if(!user||!isCrmRole(user.role)) return Response.json({error:"Войдите в CRM."},{status:401});
  const {id}=await params;
  const client=(await readChunkedDataJson<any>("clients/clients.json",[])).find(c=>c.id===id);
  if(!client||!canSeeLead(user,client)) return Response.json({error:"Клиент не найден."},{status:404});
  if(Number(request.headers.get("content-length"))>MAX_CLIENT_FILE_BYTES+65536) return Response.json({error:"Максимальный размер файла — 5 МБ."},{status:413});
  const storage=getJsonStorage();let key="",stored=false;
  try {
    const form=await readDocumentForm(request),file=form.get("file");
    if(!(file instanceof File)) return Response.json({error:"Выберите файл."},{status:400});
    const prepared=await prepareClientDocument(file);
    const document:ClientDocument={id:randomUUID(),name:prepared.name,mime:prepared.mime,size:file.size,createdAt:new Date().toISOString(),createdBy:user.id,hasThumbnail:Boolean(prepared.thumbnail)};
    key=documentKey(id,document.id);
    if(!storage.putBinary || !storage.deleteBinary) throw new Error("storage");
    const payload=Buffer.from(JSON.stringify({data:prepared.data.toString("base64"),thumbnail:prepared.thumbnail?.toString("base64")}));
    await storage.putBinary(key,encryptClientDocument(payload,key),"application/octet-stream");stored=true;
    const updated=await updateChunkedDataJson<any>("clients/clients.json",id,current=>{
      if(!canSeeLead(user,current)) throw new Error("forbidden");
      const documents:ClientDocument[]=current.documents||[];
      if(documents.length>=MAX_CLIENT_DOCUMENTS) throw new Error("limit");
      return {...current,documents:[...documents,document],documentsUpdatedAt:document.createdAt,documentsUpdatedByManagerId:user.id};
    });
    if(!updated) throw new Error("forbidden");
    return Response.json({ok:true,document},{headers:{"Cache-Control":"no-store"}});
  } catch(error) {
    if(stored) await storage.deleteBinary?.(key).catch(()=>undefined);
    const code=error instanceof Error?error.message:"storage";
    const messages:Record<string,string>={size:"Максимальный размер файла — 5 МБ.",format:"Поддерживаются JPG, PNG, WebP, PDF, DOC, DOCX и XLSX.",limit:"У клиента уже 50 документов, включая корзину. Очистите ненужные файлы в «Архиве».",forbidden:"Нет доступа к клиенту."};
    return Response.json({error:messages[code]||"Не удалось сохранить файл. Попробуйте ещё раз."},{status:code==="forbidden"?403:code==="size"?413:messages[code]?400:500});
  }
}
