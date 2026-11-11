export const editorialSpecificationOptions = {
 bodyType: [['sedan','Седан'],['hatchback','Хэтчбек'],['wagon','Универсал'],['suv','Кроссовер'],['offroad','Внедорожник'],['minivan','Минивэн'],['coupe','Купе'],['convertible','Кабриолет'],['pickup','Пикап'],['van','Фургон']],
 drive: [['fwd','Передний'],['rwd','Задний'],['awd','Полный']],
 transmission: [['automatic','Автомат'],['manual','Механика'],['cvt','Вариатор'],['dct','Робот']],
} as const;
export type EditorialSpecifications = Partial<Record<keyof typeof editorialSpecificationOptions | 'color',string>>;

export const editorialPriceCurrencies=['CNY','KRW','JPY','USD','EUR','AED','GEL','RUB','GBP','PLN','CHF','SEK','NOK','DKK','HUF','CZK','RON','BGN','TRY','KZT','BYN','UAH','RSD','ISK','CAD','AUD','NZD','HKD','SGD'] as const;
