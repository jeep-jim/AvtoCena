import type { VehicleOffer } from './types';
import { dromModule } from './drom-japan-source';
import { dromHtmlToLines } from './drom-vehicle-knowledge';

const frame = (v: unknown) => String(v || '').trim().toUpperCase().split('-').at(-1);
const trim = (v: unknown) => String(v || '').toUpperCase().replace(/^\d+(?:\.\d+)?\s+/, '').replace(/\b4WD\b/g, '').replace(/[^A-Z0-9]/g, '');
function inYear(period: string, year: number) {
 const years = [...String(period).matchAll(/\b(19\d{2}|20\d{2})\b/g)].map(m => Number(m[1]));
 return years.length > 0 && year >= years[0] && year <= (years[1] || new Date().getUTCFullYear());
}
function catalogUrl(value: string, root: string) {
 const u = new URL(value, root);
 if (!u.href.startsWith(root) || !/^(?:g_\d+_\d+|\d+)\/$/.test(u.href.slice(root.length))) throw Error('drom_catalog_url_invalid');
 return u.href;
}

// Resolve only tax inputs shared by every matching chassis/year/trim variant.
// A catalogue's rounded litre label is never used as exact displacement.
export async function enrichDromJapanSpecifications(offer: VehicleOffer, read: (url: string) => Promise<string>): Promise<VehicleOffer> {
 const op = offer.operational as any;
 const lotUrl = new URL(op.sourceUrl);
 const root = `${lotUrl.origin}/catalog/${lotUrl.pathname.split('/').slice(3,5).join('/')}/`;
 try {
  const model = dromModule(await read(root), 'catalog-generations-page');
  const generations = model.generationsInOrder.flatMap((g: any) => g.items).filter((g: any) =>
   g.outlet?.name === 'Япония' && String(g.frames).split(',').some(f => frame(f) === frame(op.modelCode)) && inYear(g.title, offer.year!));
  if (!generations.length || generations.length > 4 || !trim(offer.trim)) return offer;
  const candidates = new Map<string, { hybrid: boolean }>();
  for (const generation of generations) {
   const table = dromModule(await read(catalogUrl(generation.url, root)), 'catalog-complectations-table');
   for (const group of table.complectations.elements) {
    if (!group.frame?.some((f: any) => frame(f.title) === frame(op.modelCode))) continue;
    const hp = Number(String(group.title).match(/(\d+)\s*л\.с\./)?.[1]);
    if (offer.powerHp && hp !== offer.powerHp) continue;
    for (const period of group.periods || []) for (const variant of period.complectations || []) {
     if (inYear(variant.period || period.period, offer.year!) && trim(variant.title) === trim(offer.trim)) {
      candidates.set(catalogUrl(variant.url, root), { hybrid: /гибрид|hybrid/i.test(group.title + ' ' + variant.title) });
     }
    }
   }
  }
  if (!candidates.size || candidates.size > 16) return offer;
  const values: Array<{ engineCc: number; powerHp: number; fuel: string; powertrainKind: 'combustion' | 'other_hybrid'; source: string }> = [];
  for (const [source, candidate] of candidates) {
   const html = await read(source);
   const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => dromHtmlToLines(m[1]).join(' ').replace(/\s+/g, ' ').trim());
   const field = (label: string) => rows.find(r => r.startsWith(label))?.slice(label.length).trim() || '';
   const body = field('Марка кузова');
   const cc = Number(field('Объем двигателя, куб.см'));
   const hp = Number(field('Максимальная мощность, л.с. (кВт) при об./мин.').match(/^\d+/)?.[0]);
   const fuelText = field('Используемое топливо');
   const hybridFlag = field('Гибридный автомобиль');
   // Require an explicit non-hybrid marker before classifying combustion.
   const hybrid = candidate.hybrid || /да|есть/i.test(hybridFlag);
   if (!hybrid && !/^[—–-]$/.test(hybridFlag)) return offer;
   const fuel = hybrid ? 'hybrid' : /^Бензин/i.test(fuelText) ? 'petrol' : /^Дизел/i.test(fuelText) ? 'diesel' : '';
   if (frame(body) !== frame(op.modelCode) || !fuel || !(cc > 0 && cc <= 10000) || !(hp > 0 && hp < 2500)
    || (offer.powerHp && hp !== offer.powerHp) || Math.abs(cc - op.raw.nominalEngineCc) > 100) return offer;
   values.push({ engineCc: cc, powerHp: hp, fuel, powertrainKind: hybrid ? 'other_hybrid' : 'combustion', source });
  }
  const first = values[0];
  if (values.some(v => ['engineCc','powerHp','fuel','powertrainKind'].some(k => (v as any)[k] !== (first as any)[k]))) return offer;
  const { source, ...specs } = first;
  return { ...offer, ...specs, operational: { ...op,
   semanticEvidence: { ...op.semanticEvidence, ...Object.fromEntries(Object.entries(specs).map(([key,value]) => [key, { status:'exact', value, source, rawValues:[value] }])) },
   raw: { ...op.raw, specificationMatch: 'chassis_year_trim_consensus', specificationUrls: values.map(v => v.source) },
  } };
 } catch (error) {
  // Keep the verified sold lot when a supplementary catalogue is unavailable.
  return { ...offer, operational: { ...op, raw: { ...op.raw, specificationLookupError: String((error as Error).message).slice(0,150) } } };
 }
}
