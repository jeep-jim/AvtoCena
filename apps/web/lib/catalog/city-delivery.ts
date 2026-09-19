/** Owner-approved provisional Vladivostok tariff, 2026-09-19.
 * Rounded planning distances, NOT measured navigation routes or carrier quotes.
 * Novokuznetsk is a commercial anchor, not a regression from kilometres.
 * Edit this versioned table when actual carrier tariffs become available. */
export const DELIVERY_TARIFF_VERSION = "vladivostok-20260919-v1";
const routes: Record<string, [string, number, number?]> = {
 "владивосток": ["Владивосток", 0, 0],
 "хабаровск": ["Хабаровск", 760], "благовещенск": ["Благовещенск", 1450],
 "чита": ["Чита", 3000], "улан-удэ": ["Улан-Удэ", 3650], "иркутск": ["Иркутск", 4100],
 "красноярск": ["Красноярск", 5150], "кемерово": ["Кемерово", 5700],
 "новокузнецк": ["Новокузнецк", 5900, 120000], "новосибирск": ["Новосибирск", 6000, 130000],
 "барнаул": ["Барнаул", 6200], "томск": ["Томск", 5900], "омск": ["Омск", 6650],
 "тюмень": ["Тюмень", 7250], "челябинск": ["Челябинск", 7500], "екатеринбург": ["Екатеринбург", 7600],
 "уфа": ["Уфа", 7900], "пермь": ["Пермь", 7950], "самара": ["Самара", 8350],
 "казань": ["Казань", 8450], "нижний новгород": ["Нижний Новгород", 8850],
 "тверь": ["Тверь", 9450],
 "москва": ["Москва", 9250], "санкт-петербург": ["Санкт-Петербург", 9950],
 "воронеж": ["Воронеж", 9400], "ростов-на-дону": ["Ростов-на-Дону", 9600],
 "краснодар": ["Краснодар", 9800], "сочи": ["Сочи", 10100],
};
export function normalizeDeliveryCity(value: unknown): string {
 return typeof value === "string" ? value.trim().replace(/^г(?:\.\s*|\s+)/i, "").replace(/\s+/g," ").slice(0,100) : "";
}
export function quoteCityDelivery(value: unknown, market?: string) {
 const city = normalizeDeliveryCity(value);
 const base = {version:DELIVERY_TARIFF_VERSION,origin:"Владивосток",city,amountRub:0,distanceKm:null as number|null,estimated:true};
 if (!city) return {...base,status:"not_selected" as const};
 // These markets have other entry points: do not price a fictitious Vladivostok leg.
 if (market && !["japan","china","korea"].includes(market)) return {...base,status:"needs_quote" as const};
 const key = city.toLocaleLowerCase("ru-RU").replace(/ё/g,"е");
 const route = Object.hasOwn(routes,key) ? routes[key] : undefined;
 if (!route) return {...base,status:"needs_quote" as const};
 const [canonical,distanceKm,override] = route;
 const amountRub = override ?? Math.max(15000, Math.round((130000 * distanceKm / 6000) / 5000) * 5000);
 return {...base,city:canonical,distanceKm,amountRub,status:"estimated" as const};
}
export function deliveryDescription(quote: ReturnType<typeof quoteCityDelivery>) {
 if (quote.status === "not_selected") return "Доставка до города: 0 ₽ — не включена. Выберите город.";
 if (quote.status === "needs_quote") return `Доставка в ${quote.city}: стоимость уточняется, в итог не включена.`;
 if (quote.distanceKm === 0) return "Получение во Владивостоке: 0 ₽. Междугородняя доставка не требуется.";
 return `Доставка из Владивостока в ${quote.city}: около ${quote.amountRub.toLocaleString("ru-RU")} ₽. Предварительный тариф, подтвердим перед заказом.`;
}
