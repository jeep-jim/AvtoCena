import {getCurrentUser,isCrmRole} from "@/lib/auth";
import {canSeeLead} from "@/lib/crm-visibility";
import {getJsonStorage,readChunkedDataJson} from "@/lib/data";
import {documentKey,decryptClientDocument,type ClientDocument} from "@/lib/client-documents";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request,{params}:{params:Promise<{id:string;documentId:string}>}) {
 const user=await getCurrentUser();
 if(!user||!isCrmRole(user.role)) return new Response(null,{status:401});
 const {id,documentId}=await params;
 const client=(await readChunkedDataJson<any>("clients/clients.json",[])).find(c=>c.id===id);
 if(!client||!canSeeLead(user,client)) return new Response(null,{status:404});
 const doc:ClientDocument|undefined=client.documents?.find((d:ClientDocument)=>d.id===documentId);
 if(!doc||!/^[a-f0-9-]{36}$/.test(documentId)) return new Response(null,{status:404});
 try {
  const key=documentKey(id,documentId),stored=await getJsonStorage().getBinary?.(key);
  if(!stored) return new Response(null,{status:404});
  const payload=JSON.parse(decryptClientDocument(stored.data,key).toString());
  const query=new URL(request.url).searchParams, thumbnail=query.get("preview")==="1";
  if(thumbnail&&!payload.thumbnail) return new Response(null,{status:404});
  const data=Buffer.from(thumbnail?payload.thumbnail:payload.data,"base64");
  const inline=thumbnail||((doc.mime.startsWith("image/")||doc.mime==="application/pdf")&&query.get("download")!=="1");
  return new Response(new Uint8Array(data),{headers:{
   "Content-Type":thumbnail?"image/webp":doc.mime,"Content-Length":String(data.length),
   "Content-Disposition":`${inline?"inline":"attachment"}; filename="document"; filename*=UTF-8''${encodeURIComponent(doc.name).replace(/['()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
   "Cache-Control":"private, no-store, max-age=0","X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer",
   "Content-Security-Policy":"sandbox; default-src 'none'; frame-ancestors 'self'",
  }});
 } catch { return new Response(null,{status:500}); }
}
