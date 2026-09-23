/** Stable identity stays in the suffix; vehicle names remain readable to people and crawlers. */
export type OfferUrlData = {id: unknown; make?: unknown; model?: unknown; trim?: unknown; year?: unknown; title?: unknown};
const cyrillic: Record<string,string> = Object.fromEntries('а:a б:b в:v г:g д:d е:e ё:yo ж:zh з:z и:i й:y к:k л:l м:m н:n о:o п:p р:r с:s т:t у:u ф:f х:kh ц:ts ч:ch ш:sh щ:shch ъ: ы:y ь: э:e ю:yu я:ya'.split(' ').map(pair=>pair.split(':')));
export function offerRouteId(value: string) {
  const split=value.lastIndexOf('--');
  return split<0 ? value : value.slice(split+2);
}
export function offerPath(offer: OfferUrlData) {
  const id=String(offer.id||'').trim();
  const name=[offer.make,offer.model,offer.trim,offer.year].filter(Boolean).join(' ') || String(offer.title||'');
  const slug=name.toLowerCase().normalize('NFKD').replace(/[а-яё]/g,c=>cyrillic[c]??c).replace(/[\u0300-\u036f]/g,'').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,160).replace(/-$/,'');
  return `/cars/offer/${slug ? `${encodeURIComponent(slug)}--` : ''}${encodeURIComponent(id)}`;
}
