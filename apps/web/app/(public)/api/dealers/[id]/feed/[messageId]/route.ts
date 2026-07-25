import { getJsonStorage, readChunkedDataJson } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string; messageId: string }> }) {
  const { id, messageId } = await params;
  const feed = await readChunkedDataJson<any>("dealers/feed.json", []);
  const item = feed.find((entry) => entry.dealerId === id && String(entry.telegramMessageId || "") === messageId && entry.status === "published");
  const objectKey = String(item?.mediaObjectKey || "");
  if (!objectKey) return new Response("Not found", { status: 404 });

  const storage = getJsonStorage();
  if (!storage.getBinary) return new Response("Not found", { status: 404 });
  try {
    const file = await storage.getBinary(objectKey);
    return new Response(file.data, {
      headers: {
        "content-type": file.mimeType || "image/jpeg",
        "cache-control": "public, max-age=300, stale-while-revalidate=3600",
        etag: `"${file.checksum}"`,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
