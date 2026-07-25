import { getJsonStorage, readDataJson } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dealers = await readDataJson<any[]>("dealers/dealers.json", []);
  const dealer = dealers.find((item) => item.id === id);
  const objectKey = String(dealer?.logoObjectKey || "");
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
