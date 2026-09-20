/** Owner-approved provisional Vladivostok tariff, 2026-09-19.
 * Rounded planning distances, NOT measured navigation routes or carrier quotes.
 * Novokuznetsk is a commercial anchor, not a regression from kilometres.
 * Edit this versioned table when actual carrier tariffs become available. */
export const DELIVERY_TARIFF_VERSION = "market-origins-20260920-v2";
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
// Rounded planning road distances in km, same provisional per-km tariff as
// Vladivostok. These are budgeting estimates, not navigation measurements.
const westernRoutes: Record<string, [number, number, number]> = {
 // Destination: Mineralnye Vody, Astrakhan, Saint Petersburg.
 "владивосток": [10050, 9700, 9950], "хабаровск": [9300, 8950, 9200],
 "благовещенск": [8600, 8250, 8500], "чита": [7050, 6700, 6950],
 "улан-удэ": [6400, 6050, 6300], "иркутск": [5950, 5600, 5850],
 "красноярск": [4900, 4550, 4800], "кемерово": [4350, 4000, 4250],
 "новокузнецк": [4550, 4200, 4450], "новосибирск": [4050, 3700, 3950],
 "барнаул": [4250, 3900, 4150], "томск": [4200, 3850, 4100],
 "омск": [3400, 3050, 3300], "тюмень": [2800, 2450, 2700],
 "челябинск": [2450, 2100, 2550], "екатеринбург": [2600, 2250, 2400],
 "уфа": [2050, 1700, 2200], "пермь": [2550, 2200, 2050],
 "самара": [1650, 1300, 1800], "казань": [1950, 1600, 1550],
 "нижний новгород": [1950, 1700, 1150], "тверь": [1800, 1600, 550],
 "москва": [1600, 1400, 700], "санкт-петербург": [2300, 2100, 0],
 "воронеж": [1100, 1000, 1200], "ростов-на-дону": [500, 800, 1800],
 "краснодар": [450, 1050, 2100], "сочи": [650, 1250, 2400],
 "минеральные воды": [0, 700, 2300], "астрахань": [700, 0, 2100],
};
const origins: Record<string, {city: string; column: number}> = {
 georgia: {city:"Минеральные Воды", column:0},
 uae: {city:"Астрахань", column:1},
 europe: {city:"Санкт-Петербург", column:2},
};
routes["минеральные воды"] = ["Минеральные Воды", 10050];
routes["астрахань"] = ["Астрахань", 9700];
export function normalizeDeliveryCity(value: unknown): string {
 return typeof value === "string" ? value.trim().replace(/^г(?:\.\s*|\s+)/i, "").replace(/\s+/g," ").slice(0,100) : "";
}
export function quoteCityDelivery(value: unknown, market?: string) {
 const city = normalizeDeliveryCity(value);
 const entry = market && Object.hasOwn(origins,market) ? origins[market] : undefined;
 const base = {version:DELIVERY_TARIFF_VERSION,origin:entry?.city || "Владивосток",city,amountRub:0,distanceKm:null as number|null,estimated:true};
 if (!city) return {...base,status:"not_selected" as const};
 if (market && !["japan","china","korea","georgia","uae","europe"].includes(market)) return {...base,status:"needs_quote" as const};
 const key = city.toLocaleLowerCase("ru-RU").replace(/ё/g,"е");
 const route = Object.hasOwn(routes,key) ? routes[key] : undefined;
 if (!route) return {...base,status:"needs_quote" as const};
 const [canonical,legacyDistance,override] = route;
 const distanceKm = entry ? westernRoutes[key]?.[entry.column] : legacyDistance;
 if (distanceKm == null) return {...base,status:"needs_quote" as const};
 const amountRub = distanceKm === 0 ? 0 : (!entry ? override : undefined) ?? Math.max(15000, Math.round((130000 * distanceKm / 6000) / 5000) * 5000);
 return {...base,city:canonical,distanceKm,amountRub,status:"estimated" as const};
}
export function deliveryDescription(quote: ReturnType<typeof quoteCityDelivery>) {
 if (quote.status === "not_selected") return "Доставка до города: 0 ₽ — не включена. Выберите город.";
 if (quote.status === "needs_quote") return `Доставка в ${quote.city}: стоимость уточняется, в итог не включена.`;
 if (quote.distanceKm === 0) return `Получение в городе ${quote.origin}: 0 ₽. Междугородняя доставка не требуется.`;
 return `Доставка: ${quote.origin} → ${quote.city}: около ${quote.amountRub.toLocaleString("ru-RU")} ₽. Предварительный тариф, подтвердим перед заказом.`;
}
