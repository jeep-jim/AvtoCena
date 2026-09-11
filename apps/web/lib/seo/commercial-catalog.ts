export const COMMERCIAL_MARKETS = {
  china: { country: 'Китая', title: 'Автомобили из Китая — цены и расчёт ввоза', note: 'Сравнивайте б/у объявления китайских продавцов и новые модели. Справочная цена модели не подтверждает наличие конкретного автомобиля. Комплектацию, пробег и фотографии проверяйте в карточке.' },
  korea: { country: 'Кореи', title: 'Автомобили из Кореи — подбор и цены под заказ', note: 'Сравнивайте корейские объявления по пробегу, комплектации и данным продавца. Историю осмотров и точную модификацию нужно проверять по конкретной машине, а не только по названию модели.' },
  uae: { country: 'ОАЭ', title: 'Автомобили из ОАЭ — цены и стоимость ввоза', note: 'Сравнивайте предложения продавцов Эмиратов. Региональная комплектация, расположение руля и оборудование могут отличаться: проверяйте их по характеристикам и фотографиям конкретного объявления.' },
  georgia: { country: 'Грузии', title: 'Автомобили из Грузии — подбор и расчёт стоимости', note: 'В объявлениях из Грузии важно отдельно уточнять историю автомобиля, его состояние и документы. Цена продавца не означает, что расходы на дальнейший ввоз в Россию уже оплачены.' },
  europe: { country: 'Европы', title: 'Автомобили из Европы — предложения и расчёт ввоза', note: 'Сравнивайте европейские объявления по комплектации, пробегу и состоянию. Возможность экспорта и маршрут доставки подтверждаются отдельно для выбранного автомобиля.' },
  japan: { country: 'Японии', title: 'Автомобили из Японии — статистика проданных лотов', note: 'В этом разделе показаны результаты завершённых аукционов. Проданный лот нельзя заказать как автомобиль в наличии: статистика помогает оценить бюджет поиска аналогичной машины. Возможность ввоза проверяется отдельно.' },
} as const;
export const COMMERCIAL_BUDGETS = [1000000, 1500000, 2000000, 3000000, 5000000] as const;
export type CommercialMarket = keyof typeof COMMERCIAL_MARKETS;
export const budgetLabel = (value: number) => `${(value / 1000000).toLocaleString('ru-RU')} млн ₽`;
export function marketLanding(value: string) { return Object.hasOwn(COMMERCIAL_MARKETS, value) ? COMMERCIAL_MARKETS[value as CommercialMarket] : undefined; }
export function budgetLandingQuery(amount: string, query: Record<string, string | string[] | undefined> = {}) {
  // The route owns its budget. The legacy alias must not override the route
  // in CarsPage or produce metadata for a different commercial landing.
  const { budget: _legacyBudget, ...filters } = query;
  return { ...filters, budgetTo: amount, hasPrice: 'yes' };
}
export function commercialCatalogMeta(query: Record<string, string | string[] | undefined> = {}) {
  const first = (v: string | string[] | undefined) => Array.isArray(v) ? v[0] : v || '';
  const market = first(query.market);
  const entry = marketLanding(market);
  const budget = Number(first(query.budget) || first(query.budgetTo));
  const budgetKnown = COMMERCIAL_BUDGETS.some(value => value === budget);
  const keys = Object.keys(query).filter(key => first(query[key]) && !/^(utm_|gclid$|yclid$|fbclid$)/.test(key));
  const marketOnly = Boolean(entry) && keys.every(key => key === 'market');
  const budgetOnly = !market && budgetKnown && keys.every(key => ['budget', 'budgetTo', 'hasPrice'].includes(key)) && (!query.hasPrice || first(query.hasPrice) === 'yes');
  const canonical = marketOnly ? `/cars/${market}` : budgetOnly ? `/cars/budget/${budget}` : '/cars';
  const title = marketOnly ? entry.title : budgetOnly ? `Автомобили до ${budgetLabel(budget)} — подбор по стоимости ввоза` : 'Автомобили под заказ — каталог и расчёт стоимости ввоза';
  const description = marketOnly ? entry.note : budgetOnly
    ? `Подбор автомобилей с рассчитанной стоимостью до ${budgetLabel(budget)}. Состав расходов и актуальность цены проверяйте в карточке. Завершённые аукционы показаны как статистика, а не наличие.`
    : 'Сравните автомобили из Китая, Кореи, ОАЭ, Европы и Грузии и статистику аукционов Японии. Цена продавца и расчёт ввоза обозначены отдельно.';
  return { title, description, alternates: { canonical }, openGraph: { title, description, url: canonical, type: 'website' as const }, robots: { index: keys.length === 0 || marketOnly || budgetOnly, follow: true } };
}
