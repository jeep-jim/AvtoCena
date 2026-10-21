import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
export const MAX_CLIENT_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_CLIENT_DOCUMENTS = 50;
export type ClientDocument = {id:string;name:string;mime:string;size:number;createdAt:string;createdBy:string;hasThumbnail:boolean;deletedAt?:string;deletedBy?:string;purgeToken?:string};
export function documentKey(clientId:string, documentId:string) {
  return `clients/documents/${encodeURIComponent(clientId)}/${documentId}.enc`;
}
// Retain this secret when rotating credentials; existing documents require the same key.
function encryptionKey() {
  const secret = process.env.CRM_DOCUMENTS_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("document_key_missing");
  return createHash("sha256").update(`avtocena-client-documents-v1:${secret}`).digest();
}
export function encryptClientDocument(data:Buffer, context:string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(data),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),body]);
}
export function decryptClientDocument(data:Buffer, context:string) {
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(),data.subarray(0,12));
  cipher.setAAD(Buffer.from(context));cipher.setAuthTag(data.subarray(12,28));
  return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]);
}
export async function prepareClientDocument(file:File) {
  if (!file.size || file.size > MAX_CLIENT_FILE_BYTES) throw new Error("size");
  const name = file.name.replace(/[\u0000-\u001f\u007f/\\]/g,"_").slice(0,180) || "Документ";
  const data = Buffer.from(await file.arrayBuffer());
  const extension = name.split(".").pop()?.toLowerCase();
  let mime = "";
  let thumbnail:Buffer|undefined;
  if (["jpg","jpeg","png","webp"].includes(extension || "")) {
    const image = sharp(data,{limitInputPixels:40_000_000,animated:false});
    const meta = await image.metadata();
    if (!["jpeg","png","webp"].includes(meta.format || "")) throw new Error("format");
    mime = `image/${meta.format}`;
    thumbnail = await image.rotate().resize(400,300,{fit:"inside",withoutEnlargement:true}).webp({quality:75}).toBuffer();
  } else if (extension === "pdf" && data.subarray(0,5).toString()==="%PDF-") mime="application/pdf";
  else if (extension === "doc" && data.subarray(0,8).equals(Buffer.from("d0cf11e0a1b11ae1","hex"))) mime="application/msword";
  else if (["docx","xlsx"].includes(extension || "") && data.subarray(0,4).equals(Buffer.from([80,75,3,4]))) mime=extension==="docx"?"application/vnd.openxmlformats-officedocument.wordprocessingml.document":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  else throw new Error("format");
  return {name,mime,data,thumbnail};
}

export async function readDocumentForm(request:Request) {
  const reader=request.body?.getReader();
  if(!reader) throw new Error("format");
  const chunks:Uint8Array[]=[];let size=0;
  try { while(true){const result=await reader.read();if(result.done)break;size+=result.value.byteLength;if(size>MAX_CLIENT_FILE_BYTES+65536){await reader.cancel();throw new Error("size");}chunks.push(result.value);} }
  finally {reader.releaseLock();}
  return new Response(Buffer.concat(chunks),{headers:{"Content-Type":request.headers.get("content-type")||""}}).formData();
}
