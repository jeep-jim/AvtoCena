import type { Metadata } from "next";
import Link from "next/link";
import { AutocatalogBrandDirectory, type AutocatalogBrandItem } from "@/components/catalog/AutocatalogBrandDirectory";
import { PublicHeader } from "@/components/layout/PublicHeader";
import { readCatalogBrandDirectory } from "@/lib/catalog/catalog-brand-directory";
import { canonicalCatalogBrand } from "@/lib/catalog/brands";
import { readEncyclopediaKnowledgeModels } from "@/lib/catalog/encyclopedia";
import { readSourceBackedEncyclopediaModels } from "@/lib/catalog/knowledge-source-master";
import { readCatalogBrandCounts } from "@/lib/catalog/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "Автокаталог — марки, модели и характеристики | АвтоЦена",
  description: "Автокаталог АвтоЦена: марки по алфавиту, модели, поколения, модификации и проверенные технические характеристики автомобилей.",
  alternates: { canonical: "/cars/autocatalog" },
  openGraph: {
    title: "Автокаталог АвтоЦена",
    description: "Марки, модели и проверенные технические характеристики в понятной базе автомобилей.",
    url: "/cars/autocatalog",
    type: "website",
  },
};

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function modelIdentity(make: unknown, model: unknown) {
  return `${canonicalCatalogBrand(clean(make)).toLocaleLowerCase("en-US")}\u0000${clean(model).toLocaleLowerCase("en-US")}`;
}

export default async function AutocatalogPage() {
  const [brands, canonicalModels, sourceModels, live] = await Promise.all([
    readCatalogBrandDirectory(),
    readEncyclopediaKnowledgeModels(),
    readSourceBackedEncyclopediaModels(),
    readCatalogBrandCounts().catch(() => ({ counts: {} as Record<string, number> })),
  ]);

  const mergedModels = new Map<string, { make: string; id: string }>();
  for (const model of sourceModels) {
    if (model.active === false) continue;
    const make = canonicalCatalogBrand(clean(model.make));
    if (!make || !clean(model.model)) continue;
    mergedModels.set(modelIdentity(make, model.model), { make, id: clean(model.id) || clean(model.model) });
  }
  // Canonical models win identity collisions but do not hide source-backed
  // models which are still waiting for a V2 link.
  for (const model of canonicalModels) {
    if (model.active === false) continue;
    const make = canonicalCatalogBrand(clean(model.make));
    if (!make || !clean(model.model)) continue;
    mergedModels.set(modelIdentity(make, model.model), { make, id: clean(model.id) || clean(model.model) });
  }

  const modelIdsByBrand = new Map<string, Set<string>>();
  for (const model of mergedModels.values()) {
    const ids = modelIdsByBrand.get(model.make) || new Set<string>();
    ids.add(model.id);
    modelIdsByBrand.set(model.make, ids);
  }

  const liveCounts = new Map<string, number>();
  for (const [rawMake, rawCount] of Object.entries(live.counts || {})) {
    const make = canonicalCatalogBrand(rawMake);
    liveCounts.set(make, (liveCounts.get(make) || 0) + Number(rawCount || 0));
  }

  const directory: AutocatalogBrandItem[] = brands.map((brand) => ({
    name: brand.name,
    slug: brand.slug,
    aliases: [...new Set((brand.aliases || []).map(clean).filter(Boolean))],
    modelCount: modelIdsByBrand.get(brand.name)?.size || 0,
    offerCount: liveCounts.get(brand.name) || 0,
  })).sort((left, right) => left.name.localeCompare(right.name, "en"));

  return <main className="ac-autocatalog-page ac-page-copy min-h-screen overflow-x-hidden bg-[#07080d] text-white">
    <PublicHeader backHref="/cars" backLabel="В каталог" />
    <section className="mx-auto w-full max-w-[1500px] px-4 py-7 md:px-8 md:py-10">
      <nav className="text-xs font-black uppercase tracking-[0.15em] text-[var(--ac-muted)]" aria-label="Хлебные крошки">
        <Link href="/cars" className="hover:text-red-500">Каталог предложений</Link><span className="mx-2">/</span><span>Автокаталог</span>
      </nav>
      <h1 className="mt-5 text-4xl font-black leading-[.95] tracking-[-0.05em] md:text-7xl">Автокаталог</h1>
      <AutocatalogBrandDirectory brands={directory} />
    </section>
  </main>;
}
