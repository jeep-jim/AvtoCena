import {getJsonStorage} from '@/lib/data';
export const runtime = 'nodejs';
export async function GET(_req: Request, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params;
  if (!/^[a-f0-9]{64}$/.test(id)) return new Response(null, {status: 404});
  try {
    const file = await getJsonStorage().getBinary?.(`settings/account-media/${id}.webp`);
    if (!file) return new Response(null, {status: 404});
    return new Response(new Uint8Array(file.data), {headers: {
      'Content-Type': 'image/webp', 'Cache-Control': 'public,max-age=31536000,immutable', 'X-Content-Type-Options': 'nosniff',
    }});
  } catch { return new Response(null, {status: 404}); }
}
