import {getJsonStorage} from '@/lib/data';
export const runtime = 'nodejs';
export async function GET(req: Request, {params}: {params: Promise<{id: string}>}) {
  const {id}=await params;
  if(!/^[a-f0-9]{64}(\.mp4)?$/.test(id))return new Response(null,{status:404});
  try {
    const video=id.endsWith('.mp4');
    const file=await getJsonStorage().getBinary?.(`settings/account-media/${video?id:id+'.webp'}`);
    if(!file)return new Response(null,{status:404});
    const bytes=new Uint8Array(file.data);
    const headers:Record<string,string>={'Content-Type':video?'video/mp4':'image/webp','Cache-Control':'public,max-age=31536000,immutable','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes'};
    const range=req.headers.get('range');
    if(range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!match||(!match[1]&&!match[2]))return new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes.length}`}});
      const start=match[1]?Number(match[1]):Math.max(0,bytes.length-Number(match[2]));
      const end=match[1]?(match[2]?Math.min(Number(match[2]),bytes.length-1):bytes.length-1):bytes.length-1;
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=bytes.length)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${bytes.length}`}});
      return new Response(bytes.slice(start,end+1),{status:206,headers:{...headers,'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(end-start+1)}});
    }
    return new Response(bytes,{headers:{...headers,'Content-Length':String(bytes.length)}});
  }catch{return new Response(null,{status:404});}
}
