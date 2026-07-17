export type CatalogBrand = { name: string; slug: string; logoSlug?: string; aliases?: string[] };

export const CATALOG_BRANDS: CatalogBrand[] = [
  ["Acura","acura","acura"], ["Alfa Romeo","alfa-romeo","alfaromeo"], ["Aston Martin","aston-martin","astonmartin"],
  ["Audi","audi","audi"], ["Avatr","avatr",""] , ["BAIC","baic",""] , ["Bentley","bentley","bentley"],
  ["BMW","bmw","bmw"], ["Buick","buick","buick"], ["BYD","byd","byd"], ["Cadillac","cadillac","cadillac"],
  ["Changan","changan","changan"], ["Chery","chery","chery"], ["Chevrolet","chevrolet","chevrolet"],
  ["Chrysler","chrysler","chrysler"], ["Citroen","citroen","citroen"], ["Cupra","cupra","cupra"],
  ["Daihatsu","daihatsu","daihatsu"], ["Denza","denza",""] , ["Dodge","dodge","dodge"], ["Dongfeng","dongfeng",""] ,
  ["Exeed","exeed",""] , ["Ferrari","ferrari","ferrari"], ["Fiat","fiat","fiat"], ["Ford","ford","ford"],
  ["GAC","gac",""] , ["Geely","geely","geely"], ["Genesis","genesis","genesis"], ["GMC","gmc","gmc"],
  ["Great Wall","great-wall",""] , ["Haval","haval",""] , ["Honda","honda","honda"], ["Hongqi","hongqi",""] ,
  ["Hyundai","hyundai","hyundai"], ["Infiniti","infiniti","infiniti"], ["Isuzu","isuzu","isuzu"],
  ["JAC","jac",""] , ["Jaguar","jaguar","jaguar"], ["Jeep","jeep","jeep"], ["Jetour","jetour",""] ,
  ["KGM","kgm",""], ["Kia","kia","kia"], ["Lada","lada","lada"], ["Lamborghini","lamborghini","lamborghini"],
  ["Land Rover","land-rover","landrover"], ["Leapmotor","leapmotor",""] , ["Lexus","lexus","lexus"],
  ["Li Auto","li-auto",""] , ["Lincoln","lincoln","lincoln"], ["Lotus","lotus","lotus"],
  ["Lynk & Co","lynk-and-co","lynkandco"], ["Maserati","maserati","maserati"], ["Mazda","mazda","mazda"],
  ["McLaren","mclaren","mclaren"], ["Mercedes-Benz","mercedes-benz","mercedes"], ["MG","mg","mg"],
  ["MINI","mini","mini"], ["Mitsubishi","mitsubishi","mitsubishi"], ["Neta","neta",""] , ["Nio","nio","nio"],
  ["Nissan","nissan","nissan"], ["Omoda","omoda",""] , ["Opel","opel","opel"], ["Peugeot","peugeot","peugeot"],
  ["Polestar","polestar","polestar"], ["Porsche","porsche","porsche"], ["RAM","ram","ram"],
  ["Renault","renault","renault"], ["Rolls-Royce","rolls-royce","rollsroyce"], ["Rox","rox",""] ,
  ["SEAT","seat","seat"], ["Skoda","skoda","skoda"], ["Smart","smart","smart"], ["Subaru","subaru","subaru"],
  ["Suzuki","suzuki","suzuki"], ["Tank","tank",""] , ["Tesla","tesla","tesla"], ["Toyota","toyota","toyota"],
  ["Volkswagen","volkswagen","volkswagen"], ["Volvo","volvo","volvo"], ["Voyah","voyah",""] ,
  ["Wey","wey",""] , ["Wuling","wuling",""] , ["XPeng","xpeng","xpeng"], ["Zeekr","zeekr",""]
].map(([name, slug, logoSlug]) => ({ name, slug, logoSlug: logoSlug || undefined }))
  .sort((a, b) => a.name.localeCompare(b.name, "en"));

function key(value: string) {
  return String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
}

const ALIASES: Record<string, string> = {
  mercedesbenz: "Mercedes-Benz", landrover: "Land Rover", rollsroyce: "Rolls-Royce", greatwall: "Great Wall",
  liauto: "Li Auto", lynkco: "Lynk & Co", ssangyong: "KGM", citroen: "Citroen", skoda: "Skoda"
};
const byKey = new Map(CATALOG_BRANDS.flatMap((brand) => [[key(brand.name), brand], [key(brand.slug), brand]] as const));

export function canonicalCatalogBrand(value: string) {
  const cleaned = String(value || "").replace(/\s+/g, " ").trim();
  const alias = ALIASES[key(cleaned)];
  return alias || byKey.get(key(cleaned))?.name || cleaned;
}
export function catalogBrandSlug(value: string) {
  const canonical = canonicalCatalogBrand(value);
  return byKey.get(key(canonical))?.slug || canonical.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
export function catalogBrandBySlug(slug: string) { return byKey.get(key(slug)); }
export function catalogBrandLogoSlug(value: string) { return byKey.get(key(canonicalCatalogBrand(value)))?.logoSlug || ""; }
