import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveCatalogBrandBySlug } from "@/lib/catalog/catalog-brand-directory";
import { catalogBrandSlug } from "@/lib/catalog/brands";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LOGO_ROOTS = [
  path.resolve(process.cwd(), "data/catalog/vehicle-encyclopedia-v2/assets/brand-logos"),
  path.resolve(process.cwd(), "apps/web/public/brand-logos/drom"),
];

async function localBrandLogo(values: string[], theme: "light" | "dark") {
  for (const root of LOGO_ROOTS) {
    for (const value of values) {
      const safeSlug = catalogBrandSlug(value);
      if (!/^[a-z0-9-]+$/.test(safeSlug)) continue;
      const file = path.resolve(root, theme, `${safeSlug}.png`);
      if (!file.startsWith(`${root}${path.sep}`)) continue;
      try { return await fs.readFile(file); } catch {}
    }
  }
  return null;
}

export async function GET(request: NextRequest, { params }: { params: { slug: string } }) {
  const brand = await resolveCatalogBrandBySlug(params.slug);
  const requestedSlug = catalogBrandSlug(params.slug);
  if (!/^[a-z0-9-]+$/.test(requestedSlug)) return new NextResponse(null, { status: 404 });

  const theme = request.nextUrl.searchParams.get("theme") === "dark" ? "dark" : "light";
  const logo = await localBrandLogo([
    requestedSlug,
    ...(brand ? [brand.slug, brand.name, ...(brand.aliases || [])] : []),
  ], theme);
  if (!logo) return new NextResponse(null, {
    status: 404,
    headers: { "cache-control": "public, max-age=3600, s-maxage=86400" },
  });

  return new NextResponse(logo, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
    },
  });
}
