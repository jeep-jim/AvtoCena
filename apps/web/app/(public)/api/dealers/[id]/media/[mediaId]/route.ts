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
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public,max-age=31536000,immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
