import {readEncyclopedia} from '@/lib/encyclopedia/records';
import {modelHref} from '@/lib/encyclopedia/schema';
export const dynamic='force-dynamic';
export async function GET(){const m=await readEncyclopedia();const entries=(m?.models||[]).map(row=>`<url><loc>https://avtocena.com${modelHref(row.id)}</loc><lastmod>${new Date(row.updatedAt).toISOString()}</lastmod></url>`);return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entries.join('')}</urlset>`,{headers:{'Content-Type':'application/xml; charset=utf-8','Cache-Control':'public, max-age=300'}});}
