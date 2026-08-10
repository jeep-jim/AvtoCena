import { NextResponse } from "next/server";
import { readCatalogFacets } from "@/lib/catalog/storage";
import { resolveVehicleModelQuery, vehicleKnowledgeFacets } from "@/lib/catalog/vehicle-knowledge";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = String(url.searchParams.get("q") || "").trim();
  const make = String(url.searchParams.get("make") || "").trim();
  const scope = String(url.searchParams.get("scope") || "").trim();
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit") || 30)));

  if (!query) {
    if (!make) {
      if (scope !== "makes") return NextResponse.json({ items: [] });
      const facets = await readCatalogFacets();
      return NextResponse.json({
        items: facets.makes.slice(0, limit).map((item) => ({ value: item, label: item })),
      });
    }
    const facets = await vehicleKnowledgeFacets(make);
    return NextResponse.json({
      items: facets.models.slice(0, limit).map((item) => ({
        make: item.make,
        model: item.model,
        aliases: item.aliases || [],
        label: item.model,
      })),
    });
  }

  const matches = await resolveVehicleModelQuery(query, make || undefined, limit);
  return NextResponse.json({
    items: matches.map((item) => ({
      id: item.id,
      make: item.make,
      model: item.model,
      aliases: item.aliases || [],
      label: make ? item.model : `${item.make} ${item.model}`,
    })),
  });
}
