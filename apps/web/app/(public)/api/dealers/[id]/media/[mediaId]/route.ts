import {renderSocialPhoto} from "@/lib/catalog/photo-rendition";
import {PhotoMemoryCache} from "@/lib/catalog/photo-memory-cache";
const socialCache=new PhotoMemoryCache(32*1024*1024);
import { getJsonStorage } from "@/lib/data";
import { validDealerId } from "@/lib/dealers/showcase-store";
export const runtime = "nodejs";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
) {
  const { id, mediaId } = await params;
  if (!validDealerId(id) || !/^[a-f0-9-]{36}$/.test(mediaId))
    return new Response(null, { status: 404 });
  try {
    const file = await getJsonStorage().getBinary?.(
      `dealers/showcase-media/${id}/${mediaId}.webp`,
    );
    if (!file) return new Response(null, { status: 404 });
    const social=new URL(_req.url).searchParams.get('format')==='jpeg';
    const image=social?await socialCache.read(`https://avtocena.com/api/dealers/${id}/media/${mediaId}`,async()=>({data:await renderSocialPhoto(Buffer.from(file.data)),type:'image/jpeg'}),'social-jpeg'):null;
    return new Response(new Uint8Array(image?.data||file.data), {
      headers: {
        "Content-Type": social?"image/jpeg":"image/webp",
        "Cache-Control": "public,max-age=31536000,immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
