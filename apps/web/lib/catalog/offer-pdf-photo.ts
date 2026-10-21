import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
import sharp from "sharp";

const blocked = new BlockList();
for (const [address,prefix] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",3]] as const) blocked.addSubnet(address,prefix,"ipv4");
const globalV6 = new BlockList();globalV6.addSubnet("2000::",3,"ipv6");
const blockedV6 = new BlockList();blockedV6.addSubnet("2001::",23,"ipv6");blockedV6.addSubnet("2001:db8::",32,"ipv6");blockedV6.addSubnet("2002::",16,"ipv6");
export function publicPhotoAddress(address:string) {
 const family=isIP(address);
 return family===4?!blocked.check(address,"ipv4"):family===6 && globalV6.check(address,"ipv6") && !blockedV6.check(address,"ipv6");
}
export function pdfPhotoUrl(raw:string) {
 try {const u=new URL(raw,"https://avtocena.com");if(!["http:","https:"].includes(u.protocol)||u.username||u.password||u.port||raw.length>2048)return null;return u;}catch{return null;}
}
async function download(raw:string,signal:AbortSignal,redirects=0):Promise<Buffer> {
 const url=pdfPhotoUrl(raw);if(!url)throw Error("invalid_photo_url");
 const records=await lookup(url.hostname.replace(/^\[|\]$/g,""),{all:true});
 if(signal.aborted || !records.length || records.some(r=>!publicPhotoAddress(r.address)))throw Error("non_public_photo_address");
 const record=records.find(r=>r.family===4) || records[0];
 // Pin the validated DNS result into the connection; redirects are validated again.
 const response=await new Promise<http.IncomingMessage>((resolve,reject)=>{
  const req=(url.protocol==="https:"?https:http).get(url,{signal,headers:{Accept:"image/jpeg,image/png,image/webp,image/avif"},lookup:((_host:unknown,options:any,callback:any)=>options?.all?callback(null,[record]):callback(null,record.address,record.family)) as any},resolve);req.on("error",reject);
 });
 if([301,302,303,307,308].includes(response.statusCode || 0)){
  response.destroy();if(redirects>=2 || !response.headers.location)throw Error("photo_redirect");
  return download(new URL(response.headers.location,url).href,signal,redirects+1);
 }
 if(response.statusCode!==200 || !/^image\/(jpeg|jpg|png|webp|avif)(;|$)/i.test(response.headers["content-type"]||"") || Number(response.headers["content-length"])>5*1024*1024){response.destroy();throw Error("invalid_photo_response");}
 const chunks:Buffer[]=[];let size=0;
 try{for await(const chunk of response){size+=chunk.length;if(size>5*1024*1024)throw Error("photo_too_large");chunks.push(Buffer.from(chunk));}}finally{response.destroy();}
 return Buffer.concat(chunks);
}
/** One bounded transient copy for staff export; never persist or cache source photographs. */
export async function fetchOfferPdfPhoto(raw?:string):Promise<Buffer|null> {
 if(!raw)return null;
 try{const signal=AbortSignal.timeout(7000);const bytes=await Promise.race([download(raw,signal),new Promise<never>((_,reject)=>signal.addEventListener("abort",()=>reject(Error("photo_timeout")),{once:true}))]);return await sharp(bytes,{limitInputPixels:32_000_000}).rotate().resize({width:900,height:600,fit:"inside",withoutEnlargement:true}).jpeg({quality:82}).toBuffer();}catch{return null;}
}
