from pathlib import Path
import re


def load(path):
    return Path(path).read_text(encoding="utf-8")


def save(path, text):
    Path(path).write_text(text, encoding="utf-8")


def once(text, old, new, label):
    if old not in text:
        raise RuntimeError(f"missing patch target: {label}")
    return text.replace(old, new, 1)

# 1. Normalize fuel/body without reading unrelated page text as vehicle specs.
path = "apps/web/lib/catalog/spec-normalization.ts"
text = load(path)
old = '''function inferBody(text: string) {
  if (/pickup|pick-up|double cab|single cab|crew cab|пикап|皮卡/.test(text)) return "pickup";
  if (/panel van|cargo van|commercial van|фургон/.test(text)) return "van";
  if (/minivan|\\bmpv\\b|staria|starex|carnival|odyssey|sienna|alphard|vellfire|serena|stepwgn|noah|voxy|freed|минивэн/.test(text)) return "minivan";
  if (/convertible|cabrio|roadster|кабриолет/.test(text)) return "convertible";
  if (/coupe|coupé|купе|쿠페/.test(text)) return "coupe";
  if (/wagon|estate|touring|avant|универсал|旅行车/.test(text)) return "wagon";
  if (/hatchback|hatch|fastback|хэтчбек|两厢/.test(text)) return "hatchback";
  if (/sedan|saloon|limousine|седан|轿车|三厢/.test(text)) return "sedan";
  if (/suv|crossover|offroad|4x4|land cruiser|rav4|harrier|cr-v|vezel|cx-5|glc|gle|gls|x[1-7]|q[23578]|кроссовер|внедорожник|越野车/.test(text)) return "suv";
  return undefined;
}'''
new = '''function inferBody(text: string) {
  if (/pickup|pick-up|double cab|single cab|crew cab|пикап|皮卡/.test(text)) return "pickup";
  if (/panel van|cargo van|commercial van|фургон/.test(text)) return "van";
  if (/minivan|\\bmpv\\b|staria|starex|carnival|odyssey|sienna|alphard|vellfire|serena|stepwgn|noah|voxy|freed|минивэн/.test(text)) return "minivan";
  if (/convertible|cabrio|roadster|кабриолет/.test(text)) return "convertible";
  if (/coupe|coupé|купе|쿠페/.test(text)) return "coupe";
  if (/wagon|estate|touring|avant|универсал|旅行车/.test(text)) return "wagon";
  if (/hatchback|hatch|fastback|хэтчбек|两厢/.test(text)) return "hatchback";
  if (/sedan|saloon|limousine|седан|轿车|三厢/.test(text)) return "sedan";
  if (/\\boff[ -]?road\\b|внедорожник|越野车|land cruiser|\\bprado\\b|\\bpatrol\\b|\\bdefender\\b|\\bwrangler\\b|\\bbronco\\b|\\bfortuner\\b|\\bpajero\\b|\\bmontero\\b|\\bjimny\\b|\\b4runner\\b|g[- ]?class|\\bg\\s?(?:350|400|500|550|580|63)\\b|\\bhummer\\b/.test(text)) return "offroad";
  if (/suv|crossover|rav4|harrier|cr-v|vezel|cx-5|glc|gle|gls|\\bx[1-7]\\b|\\bq[23578]\\b|кроссовер/.test(text)) return "suv";
  return undefined;
}'''
text = once(text, old, new, "body inference")
old = '''  let fuel = inferFuel(primary) || inferFuel(full) || offer.fuel;
  if (engineCc && fuel === "electric" && !/hybrid|hev|phev|plug[ -]?in|гибрид/.test(primary)) fuel = inferFuel(primary.replace(/electric|\\bev\\b|электро/g, " ")) || "petrol";'''
new = '''  let fuel = inferFuel(primary) || offer.fuel || inferFuel(full.replace(/electric|battery electric|\\bbev\\b|\\bev\\b|электро|纯电|전기/g, " "));
  const strongElectric = /electric|battery electric|\\bbev\\b|\\bev\\b|электро|纯电|전기/.test(primary);
  if (engineCc && fuel === "electric" && !strongElectric) fuel = inferFuel(primary.replace(/electric|\\bbev\\b|\\bev\\b|электро/g, " ")) || "petrol";
  if (engineCc && fuel === "electric" && /diesel|tdi|crdi|d-4d|d4d|дизел/.test(primary)) fuel = "diesel";'''
text = once(text, old, new, "fuel inference")
save(path, text)

# 2. Public quality: only trusted clean sources for the two contaminated markets.
path = "apps/web/lib/catalog/offer-quality.ts"
text = load(path)
text = once(text,
'''const DISALLOWED_GENERIC_SOURCES = new Set(["dubicars_uae", "autouncle_europe"]);''',
'''const DISALLOWED_GENERIC_SOURCES = new Set(["dubicars_uae", "dubicars_clean", "autouncle_europe", "autoscout_europe"]);
const TRUSTED_MARKET_SOURCES: Partial<Record<string, Set<string>>> = {
  europe: new Set(["otomoto_europe_exact"]),
  uae: new Set(["dubicars_uae_exact"]),
};''', "trusted sources")
text = once(text,
'''  if (DISALLOWED_GENERIC_SOURCES.has(String(offer.sourceId || ""))) return false;
  if (!meaningfulName(offer.make) || !meaningfulName(offer.model)) return false;''',
'''  const sourceId = String(offer.sourceId || "");
  if (DISALLOWED_GENERIC_SOURCES.has(sourceId)) return false;
  const trusted = TRUSTED_MARKET_SOURCES[String(offer.market || "")];
  if (trusted && sourceId && !trusted.has(sourceId)) return false;
  const raw = offer.operational?.raw as any;
  const rawImages = Array.isArray(raw?.images) ? raw.images.map(String).filter(Boolean) : [];
  if (sourceId === "dubicars_uae_exact" && rawImages.length && !rawImages.some((url: string) => /\\/images\\/[a-f0-9]{6}\\/(?:w_?\\d+x\\d+|\\d+x\\d+)\\/[^/?#]+\\/[a-f0-9-]+\\.(?:jpe?g|webp)/i.test(url))) return false;
  if (!meaningfulName(offer.make) || !meaningfulName(offer.model)) return false;''', "market source quality")
save(path, text)

# 3. Storage invariants, dynamic facets and Guazi CDN.
path = "apps/web/lib/catalog/storage.ts"
text = load(path)
text = once(text,
'''import type { CatalogImage, CatalogMarket, CatalogSearchParams, PublicVehicleOffer, VehicleOffer } from "./types";''',
'''import type { CatalogImage, CatalogMarket, CatalogSearchParams, PublicVehicleOffer, VehicleOffer } from "./types";
import { hasCredibleOfferContent } from "./offer-quality";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";''', "storage imports")
text = once(text,
'''  /^(.*\\.)?guazi\\.com$/i,''',
'''  /^(.+\\.)?guazi\\.com$/i,
  /^(.+\\.)?guazistatic-global\\.com$/i,''', "Guazi image CDN")
text = once(text,
'''export type CatalogFacets = { generationId: string; makes: string[]; models: Array<{ make: string; model: string }> };''',
'''export type CatalogFacets = { generationId: string; makes: string[]; models: Array<{ make: string; model: string }>; markets: string[]; bodyTypes: string[]; fuels: string[]; transmissions: string[]; drives: string[] };''', "facet type")
text = once(text,
'''export async function readCatalogFacets(): Promise<CatalogFacets> { const manifest = await readManifest(); return readIndex<CatalogFacets>(manifest.generationId, "facets.json", { generationId: manifest.generationId, makes: [], models: [] }); }''',
'''export async function readCatalogFacets(params: Pick<CatalogSearchParams, "market" | "make"> = {}): Promise<CatalogFacets> {
  const manifest = await readManifest();
  const fallback: CatalogFacets = { generationId: manifest.generationId, makes: [], models: [], markets: [], bodyTypes: [], fuels: [], transmissions: [], drives: [] };
  if (!params.market && !params.make) return readIndex<CatalogFacets>(manifest.generationId, "facets.json", fallback);
  const marketIds = params.market && params.market !== "any" ? [String(params.market)] : MARKETS;
  const rows = (await Promise.all(marketIds.map((market) => readMarketOffers(market)))).flat().filter(isPublicOffer);
  const offers = params.make ? rows.filter((offer) => cleanFacet(offer.make) === cleanFacet(params.make)) : rows;
  const values = (selector: (offer: VehicleOffer) => unknown) => [...new Set(offers.map(selector).map(cleanFacet).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ru"));
  const makes = values((offer) => offer.make);
  const models = [...new Map(offers.map((offer) => [`${cleanFacet(offer.make)}:${cleanFacet(offer.model)}`, { make: cleanFacet(offer.make), model: cleanFacet(offer.model) }])).values()].filter((item) => item.make && item.model).sort((a, b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`, "ru"));
  return { generationId: manifest.generationId, makes, models, markets: values((offer) => offer.market), bodyTypes: values((offer) => offer.bodyType), fuels: values((offer) => offer.fuel), transmissions: values((offer) => offer.transmission), drives: values((offer) => offer.drive) };
}''', "dynamic read facets")
text = once(text,
'''function isPublicOffer(o: VehicleOffer) { return o.status === "active" && o.images.length > 0 && Boolean(o.totalRub || o.calculationStatus === "needs_data" || o.calculationStatus === "auction_start"); }''',
'''function isPublicOffer(o: VehicleOffer) { return o.status === "active" && hasCredibleOfferContent(o) && Boolean(o.totalRub || o.calculationStatus === "needs_data" || o.calculationStatus === "auction_start"); }''', "public quality gate")
text = once(text,
'''export async function persistCatalogOffers(nextOffers: VehicleOffer[]) {
  const storage = getJsonStorage();''',
'''export async function persistCatalogOffers(nextOffers: VehicleOffer[]) {
  const storage = getJsonStorage();
  const growOnlyMarkets = new Set(String(process.env.CATALOG_GROW_ONLY_MARKETS ?? "korea").split(",").map((value) => value.trim()).filter(Boolean));
  const normalized = nextOffers.map((offer) => normalizeVehicleOfferSpecs(offer));
  if (growOnlyMarkets.size) {
    const current = await readAllOffersForMaintenance();
    const merged = new Map(normalized.map((offer) => [offer.id, offer]));
    for (const offer of current) {
      if (!growOnlyMarkets.has(String(offer.market)) || !hasCredibleOfferContent({ ...offer, status: "active" })) continue;
      const incoming = merged.get(offer.id);
      if (!incoming || incoming.status !== "active" || !hasCredibleOfferContent({ ...incoming, status: "active" })) merged.set(offer.id, normalizeVehicleOfferSpecs({ ...offer, status: "active" }));
    }
    nextOffers = [...merged.values()];
  } else {
    nextOffers = normalized;
  }''', "grow-only Korea")
text = once(text,
'''const maps: Record<string, Map<string, string[]>> = { market: new Map(), make: new Map(), model: new Map(), year: new Map(), budget: new Map(), fuel: new Map(), body: new Map(), drive: new Map(), hasPrice: new Map() };''',
'''const maps: Record<string, Map<string, string[]>> = { market: new Map(), make: new Map(), model: new Map(), year: new Map(), budget: new Map(), fuel: new Map(), body: new Map(), transmission: new Map(), drive: new Map(), hasPrice: new Map() };''', "transmission index")
text = once(text,
'''const pairs = { market: o.market, make, model: `${make}:${model}`, year: o.year, budget: budgetBucket(o.totalRub), fuel: o.fuel, body: o.bodyType, drive: o.drive, hasPrice: o.totalRub ? "yes" : "no" };''',
'''const pairs = { market: o.market, make, model: `${make}:${model}`, year: o.year, budget: budgetBucket(o.totalRub), fuel: o.fuel, body: o.bodyType, transmission: o.transmission, drive: o.drive, hasPrice: o.totalRub ? "yes" : "no" };''', "transmission pair")
text = once(text,
'''await writeJsonAtomic(generationPath(generationId, "indexes/facets.json"), { generationId, makes: [...makes.values()].sort((a,b) => a.localeCompare(b, "ru")), models: [...models.values()].sort((a,b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`, "ru")) });''',
'''await writeJsonAtomic(generationPath(generationId, "indexes/facets.json"), {
    generationId,
    makes: [...makes.values()].sort((a,b) => a.localeCompare(b, "ru")),
    models: [...models.values()].sort((a,b) => `${a.make} ${a.model}`.localeCompare(`${b.make} ${b.model}`, "ru")),
    markets: [...new Set(offers.map((offer) => cleanFacet(offer.market)).filter(Boolean))].sort(),
    bodyTypes: [...new Set(offers.map((offer) => cleanFacet(offer.bodyType)).filter(Boolean))].sort(),
    fuels: [...new Set(offers.map((offer) => cleanFacet(offer.fuel)).filter(Boolean))].sort(),
    transmissions: [...new Set(offers.map((offer) => cleanFacet(offer.transmission)).filter(Boolean))].sort(),
    drives: [...new Set(offers.map((offer) => cleanFacet(offer.drive)).filter(Boolean))].sort(),
  });''', "facet index contents")
save(path, text)

# 4. Catalog filters use only actual facets, never fallback values.
path = "apps/web/components/catalog/CatalogFilters.tsx"
text = load(path)
text = once(text,
'''type Facets = { makes: string[]; models: Array<{ make: string; model: string }> };''',
'''type Facets = { makes: string[]; models: Array<{ make: string; model: string }>; markets?: string[]; bodyTypes?: string[]; fuels?: string[]; transmissions?: string[]; drives?: string[] };''', "filter facet type")
text = re.sub(r'\nconst fallbackMakes = \[[\s\S]*?\n};\n', '\n', text, count=1)
text = once(text,
'''const prices: Option[] = [{ value: "", label: "С ценой и без" }, { value: "yes", label: "Только с ценой" }, { value: "no", label: "Цена уточняется" }];''',
'''const prices: Option[] = [{ value: "", label: "С ценой и без" }, { value: "yes", label: "Только с ценой" }, { value: "no", label: "Цена уточняется" }];
function onlyAvailable(options: Option[], values?: string[]) { const allowed = new Set((values || []).map(clean)); return [options[0], ...options.slice(1).filter((option) => allowed.has(clean(option.value)))]; }''', "available options helper")
old_adv = '''function AdvancedFields({ initial, make, makeOptions, modelOptions, setMake, includePrimary = true }: { initial: Record<string, string>; make: string; makeOptions: Option[]; modelOptions: Option[]; setMake: (value: string) => void; includePrimary?: boolean }) { return <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{includePrimary ? <><SearchSelect name="make" value={make} placeholder="Любая марка" searchPlaceholder="Найти марку" options={makeOptions} onChange={setMake} /><SearchSelect key={`advanced-${make}`} name="model" value={initial.make === make ? initial.model || "" : ""} placeholder="Любая модель" searchPlaceholder="Найти модель" options={modelOptions} /><SimpleSelect name="market" value={initial.market || ""} placeholder="Все рынки" options={markets} /></> : null}<SimpleSelect name="bodyType" value={initial.bodyType || ""} placeholder="Любой кузов" options={bodies} /><SimpleSelect name="transmission" value={initial.transmission || ""} placeholder="Любая трансмиссия" options={transmissions} /><RangeFields fromName="yearFrom" toName="yearTo" fromValue={initial.yearFrom} toValue={initial.yearTo} fromPlaceholder="Год от" toPlaceholder="до" /><RangeFields fromName="budgetFrom" toName="budget" fromValue={initial.budgetFrom} toValue={initial.budget} fromPlaceholder="Цена от, ₽" toPlaceholder="до" /><RangeFields fromName="mileageFrom" toName="mileageTo" fromValue={initial.mileageFrom} toValue={initial.mileageTo} fromPlaceholder="Пробег от, км" toPlaceholder="до" /><RangeFields fromName="engineFrom" toName="engineTo" fromValue={initial.engineFrom} toValue={initial.engineTo} fromPlaceholder="Объём от, см³" toPlaceholder="до" /><SimpleSelect name="fuel" value={initial.fuel || ""} placeholder="Любое топливо" options={fuels} /><SimpleSelect name="drive" value={initial.drive || ""} placeholder="Любой привод" options={drives} /><SimpleSelect name="hasPrice" value={initial.hasPrice || ""} placeholder="С ценой и без" options={prices} /></div>; }'''
new_adv = '''function AdvancedFields({ initial, make, makeOptions, modelOptions, marketOptions, bodyOptions, transmissionOptions, fuelOptions, driveOptions, setMake, includePrimary = true }: { initial: Record<string, string>; make: string; makeOptions: Option[]; modelOptions: Option[]; marketOptions: Option[]; bodyOptions: Option[]; transmissionOptions: Option[]; fuelOptions: Option[]; driveOptions: Option[]; setMake: (value: string) => void; includePrimary?: boolean }) { return <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{includePrimary ? <><SearchSelect name="make" value={make} placeholder="Любая марка" searchPlaceholder="Найти марку" options={makeOptions} onChange={setMake} /><SearchSelect key={`advanced-${make}`} name="model" value={initial.make === make ? initial.model || "" : ""} placeholder="Любая модель" searchPlaceholder="Найти модель" options={modelOptions} /><SimpleSelect name="market" value={initial.market || ""} placeholder="Все рынки" options={marketOptions} /></> : null}{bodyOptions.length > 1 ? <SimpleSelect name="bodyType" value={initial.bodyType || ""} placeholder="Любой кузов" options={bodyOptions} /> : null}{transmissionOptions.length > 1 ? <SimpleSelect name="transmission" value={initial.transmission || ""} placeholder="Любая трансмиссия" options={transmissionOptions} /> : null}<RangeFields fromName="yearFrom" toName="yearTo" fromValue={initial.yearFrom} toValue={initial.yearTo} fromPlaceholder="Год от" toPlaceholder="до" /><RangeFields fromName="budgetFrom" toName="budget" fromValue={initial.budgetFrom} toValue={initial.budget} fromPlaceholder="Цена от, ₽" toPlaceholder="до" /><RangeFields fromName="mileageFrom" toName="mileageTo" fromValue={initial.mileageFrom} toValue={initial.mileageTo} fromPlaceholder="Пробег от, км" toPlaceholder="до" /><RangeFields fromName="engineFrom" toName="engineTo" fromValue={initial.engineFrom} toValue={initial.engineTo} fromPlaceholder="Объём от, см³" toPlaceholder="до" />{fuelOptions.length > 1 ? <SimpleSelect name="fuel" value={initial.fuel || ""} placeholder="Любое топливо" options={fuelOptions} /> : null}{driveOptions.length > 1 ? <SimpleSelect name="drive" value={initial.drive || ""} placeholder="Любой привод" options={driveOptions} /> : null}<SimpleSelect name="hasPrice" value={initial.hasPrice || ""} placeholder="С ценой и без" options={prices} /></div>; }'''
text = once(text, old_adv, new_adv, "advanced fields")
old_opts = '''  const makeOptions = useMemo<Option[]>(() => { const values = facets?.makes?.length ? facets.makes : fallbackMakes; return [{ value: "", label: "Любая марка" }, ...[...new Set(values.map(clean).filter(Boolean))].sort((a, b) => label(a).localeCompare(label(b), "ru")).map((value) => ({ value, label: label(value) }))]; }, [facets]);
  const modelOptions = useMemo<Option[]>(() => { if (!make) return [{ value: "", label: "Любая модель" }]; const actual = (facets?.models || []).filter((item) => clean(item.make) === clean(make)).map((item) => clean(item.model)); const values = actual.length ? actual : fallbackModels[make] || []; return [{ value: "", label: "Любая модель" }, ...[...new Set(values.filter(Boolean))].sort((a, b) => label(a).localeCompare(label(b), "ru")).map((value) => ({ value, label: label(value) }))]; }, [facets, make]);'''
new_opts = '''  const makeOptions = useMemo<Option[]>(() => [{ value: "", label: "Любая марка" }, ...[...new Set((facets?.makes || []).map(clean).filter(Boolean))].sort((a, b) => label(a).localeCompare(label(b), "ru")).map((value) => ({ value, label: label(value) }))], [facets]);
  const modelOptions = useMemo<Option[]>(() => { if (!make) return [{ value: "", label: "Любая модель" }]; const values = (facets?.models || []).filter((item) => clean(item.make) === clean(make)).map((item) => clean(item.model)); return [{ value: "", label: "Любая модель" }, ...[...new Set(values.filter(Boolean))].sort((a, b) => label(a).localeCompare(label(b), "ru")).map((value) => ({ value, label: label(value) }))]; }, [facets, make]);
  const marketOptions = useMemo(() => onlyAvailable(markets, facets?.markets), [facets]);
  const bodyOptions = useMemo(() => onlyAvailable(bodies, facets?.bodyTypes), [facets]);
  const fuelOptions = useMemo(() => onlyAvailable(fuels, facets?.fuels), [facets]);
  const transmissionOptions = useMemo(() => onlyAvailable(transmissions, facets?.transmissions), [facets]);
  const driveOptions = useMemo(() => onlyAvailable(drives, facets?.drives), [facets]);'''
text = once(text, old_opts, new_opts, "catalog dynamic options")
text = text.replace('options={markets} />{!expanded', 'options={marketOptions} />{!expanded', 1)
props = 'marketOptions={marketOptions} bodyOptions={bodyOptions} transmissionOptions={transmissionOptions} fuelOptions={fuelOptions} driveOptions={driveOptions}'
text = text.replace('setMake={setMake} includePrimary={false}', f'{props} setMake={{setMake}} includePrimary={{false}}', 1)
text = text.replace('setMake={setMake} /><button className="avto-button mt-8', f'{props} setMake={{setMake}} /><button className="avto-button mt-8', 1)
save(path, text)

# 5. Catalog page requests facets for the visible market/make.
path = "apps/web/app/(public)/cars/page.tsx"
text = load(path)
text = once(text, 'readCatalogFacets(),', 'readCatalogFacets({ market: selectedMarket || undefined, make: common.make || undefined }),', "market facets")
save(path, text)

# 6. Homepage refreshes live data and exposes only body types that exist.
path = "apps/web/components/home/HomePageClient.tsx"
text = load(path)
text = once(text,
'''type Item = { raw: any; id: string; make: string; model: string; market: string };''',
'''type Item = { raw: any; id: string; make: string; model: string; market: string; bodyType?: string };''', "home item type")
pattern = re.compile(r'''  useEffect\(\(\) => \{\n    Promise\.all\(\[\n      fetch\("/api/catalog/search\?pageSize=30&sort=updatedAt&includeRates=1", \{ cache: "no-store" \}\)\.then\(\(response\) => response\.json\(\)\),\n      \.\.\.marketIds\.map\(\(id\) => fetch\(`/api/catalog/search\?market=\$\{id\}&pageSize=30&sort=updatedAt`, \{ cache: "no-store" \}\)\.then\(\(response\) => response\.json\(\)\)\),\n    \]\)\.then\(\(responses\) => \{[\s\S]*?\n    \}\)\.catch\(\(\) => setItems\(\[\]\)\);\n  \}, \[\]\);''')
replacement = '''  useEffect(() => {
    let cancelled = false;
    const loadCatalog = async () => {
      const stamp = Date.now();
      try {
        const responses = await Promise.all([
          fetch(`/api/catalog/search?pageSize=48&sort=updatedAt&includeRates=1&_=${stamp}`, { cache: "no-store", headers: { "cache-control": "no-cache" } }).then((response) => response.json()),
          ...marketIds.map((id) => fetch(`/api/catalog/search?market=${id}&pageSize=48&sort=updatedAt&_=${stamp}`, { cache: "no-store", headers: { "cache-control": "no-cache" } }).then((response) => response.json())),
        ]);
        if (cancelled) return;
        const unique = new Map<string, Item>();
        for (const raw of responses.flatMap((response) => Array.isArray(response?.items) ? response.items : [])) {
          if (!isCrediblePublicOffer(raw as any)) continue;
          const offer = presentCatalogOffer(raw);
          unique.set(offer.id, { raw, id: offer.id, make: canonicalCatalogBrand(String(raw.make || "")), model: String(raw.model || ""), market: offer.market, bodyType: String(raw.bodyType || "") || undefined });
        }
        setItems([...unique.values()]);
        setRates(Array.isArray(responses[0]?.rates) ? responses[0].rates : []);
        setMarketCounts(Object.fromEntries(marketIds.map((id, index) => [id, Number(responses[index + 1]?.total || 0)])));
      } catch { if (!cancelled) setItems([]); }
    };
    loadCatalog();
    const interval = window.setInterval(loadCatalog, 60_000);
    const focus = () => loadCatalog();
    const visibility = () => { if (document.visibilityState === "visible") loadCatalog(); };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", visibility);
    return () => { cancelled = true; window.clearInterval(interval); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", visibility); };
  }, []);'''
text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise RuntimeError("missing patch target: homepage live loader")
needle = '''  const selectedBudget = budgets.find((option) => option.value === budget) || budgets[0];'''
insert = '''  const bodyOptions = useMemo<Option[]>(() => {
    const available = new Set(items.map((item) => item.bodyType).filter(Boolean));
    return [bodies[0], ...bodies.slice(1).filter((option) => available.has(option.value))];
  }, [items]);
  const selectedBudget = budgets.find((option) => option.value === budget) || budgets[0];'''
text = once(text, needle, insert, "home body options")
text = text.replace('options={bodies}', 'options={bodyOptions}')
save(path, text)

# 7. Recovery can be scoped to Korea only.
path = "scripts/catalog-recover-generations.mjs"
text = load(path)
text = once(text,
'''const MARKETS = ["korea", "china", "japan", "uae", "europe"];''',
'''const MARKETS = String(process.env.CATALOG_RECOVERY_MARKETS || "korea,china,japan,uae,europe").split(",").map((value) => value.trim()).filter(Boolean);''', "recovery markets")
save(path, text)

print("catalog market integrity patch applied")
