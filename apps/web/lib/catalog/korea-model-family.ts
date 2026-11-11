/** Explicit Korean/English model names only. This narrows an already exact
 * manufacturer, engine code, displacement and fuel match; it never supplies
 * a rating from the badge or discards an unrecognised government family. */
const families:[string,RegExp][]=[
 ['morning',/^(?:모닝|Morning|Picanto)(?=$|[^A-Za-z가-힣])/i],
 ['ray',/^(?:레이|Ray)(?=$|[^A-Za-z가-힣])/i],
 ['k3',/^K3(?=$|[^A-Za-z0-9])/i],['k5',/^K5(?=$|[^A-Za-z0-9])/i],
 ['k7',/^K7(?=$|[^A-Za-z0-9])/i],['k8',/^K8(?=$|[^A-Za-z0-9])/i],['k9',/^K9(?=$|[^A-Za-z0-9])/i],
 ['seltos',/^(?:셀토스|Seltos)(?=$|[^A-Za-z가-힣])/i],
 ['sportage',/^(?:스포티지|Sportage)(?=$|[^A-Za-z가-힣])/i],
 ['sorento',/^(?:쏘렌토|Sorento)(?=$|[^A-Za-z가-힣])/i],
 ['carnival',/^(?:카니발|Carnival)(?=$|[^A-Za-z가-힣])/i],
 ['avante',/^(?:아반떼|Avante|Elantra)(?=$|[^A-Za-z가-힣])/i],
 ['venue',/^(?:베뉴|Venue)(?=$|[^A-Za-z가-힣])/i],
 ['sonata',/^(?:쏘나타|Sonata)(?=$|[^A-Za-z가-힣])/i],
 ['santa-fe',/^(?:싼타페|Santa\s*Fe)(?=$|[^A-Za-z가-힣])/i],
 ['tucson',/^(?:투싼|Tucson)(?=$|[^A-Za-z가-힣])/i],
 ['kona',/^(?:코나|Kona)(?=$|[^A-Za-z가-힣])/i],
 ['grandeur',/^(?:그랜저|Grandeur)(?=$|[^A-Za-z가-힣])/i],
 ['palisade',/^(?:팰리세이드|Palisade)(?=$|[^A-Za-z가-힣])/i],
 ['staria',/^(?:스타리아|Staria)(?=$|[^A-Za-z가-힣])/i],
 ['starex',/^(?:스타렉스|Starex)(?=$|[^A-Za-z가-힣])/i],
];
export function koreanModelFamily(model:unknown) {
 const value=String(model||'').trim();
 return families.find(([,pattern])=>pattern.test(value))?.[0];
}
