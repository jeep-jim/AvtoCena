import { createHash } from 'node:crypto';
import { getJsonStorage } from '@/lib/data';
import { DetailReadCache } from '@/lib/catalog/detail-read-cache';
import { DIRECT_FEED_META, DIRECT_FEED_MAX_AGE_MS, DIRECT_MARKETS, type DirectFeedMetadata } from '@/lib/catalog/yandex-direct-feed';
export const dynamic='force-dynamic';
export const runtime='nodejs';
const cache=new DetailReadCache<{data:Buffer;checksum:string}>({maxEntries:7,maxBytes:20*1024*1024,ttlMs:60_000,concurrency:1});
export async function GET(request:Request,{params}:{params:Promise<{file:string}>}) {
  const {file}=await params;
  if(!['all.xml',...DIRECT_MARKETS.map(m=>`${m}.xml`)].includes(file))return new Response('Not found',{status:404});
  try {
    const storage=getJsonStorage();
    const metadata=await storage.readJson<DirectFeedMetadata|null>(DIRECT_FEED_META,null);
    const age=Date.now()-Date.parse(metadata?.generatedAt || '');
    if(!metadata || !Number.isFinite(age) || age<0 || age>DIRECT_FEED_MAX_AGE_MS)throw Error('feed_stale');
    const entry=metadata.files[file];
    if(!entry || !entry.count || !storage.getBinary)throw Error('feed_unavailable');
    const payload=await cache.get(entry.sha256,async()=>{
      const binary=await storage.getBinary!(entry.path);
      if(createHash('sha256').update(binary.data).digest('hex')!==entry.sha256)throw Error('feed_checksum');
      return {data:binary.data,checksum:entry.sha256};
    });
    const headers={'Content-Type':'application/xml; charset=utf-8','Content-Encoding':'gzip',
      'Cache-Control':'public, max-age=60, s-maxage=60',ETag:`"${payload.checksum}"`,
      'Last-Modified':new Date(metadata.generatedAt).toUTCString(),'X-Feed-Offers':String(entry.count)};
    if(request.headers.get('if-none-match')===headers.ETag)return new Response(null,{status:304,headers});
    return new Response(new Uint8Array(payload.data),{headers});
  }catch(error){console.error('yandex_feed_unavailable',error);return new Response('Feed temporarily unavailable',{status:503,headers:{'Cache-Control':'no-store','Retry-After':'300'}});}
}
