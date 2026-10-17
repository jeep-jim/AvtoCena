import cities from './russian-cities.json';
export type CitySuggestion = typeof cities[number];
export function normalizeCitySearch(value: string) {
  return value.trim().toLocaleLowerCase('ru-RU').replace(/^г(?:\.\s*|\s+)/, '').replace(/ё/g, 'е').replace(/[\s-]+/g, ' ');
}
const index = cities.map(city => ({...city, search: normalizeCitySearch(city.city), full: normalizeCitySearch(city.value)}));
export function searchRussianCities(query: string, limit = 30): CitySuggestion[] {
  const needle = normalizeCitySearch(query);
  if (!needle) return [];
  return index.filter(city => city.full.includes(needle)).sort((a,b) =>
    Number(b.search === needle) - Number(a.search === needle) ||
    Number(b.search.startsWith(needle)) - Number(a.search.startsWith(needle)) || a.city.localeCompare(b.city, 'ru')
  ).slice(0, limit).map(({search, full, ...city}) => city);
}
