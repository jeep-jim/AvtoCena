export const CLIENT_STATUSES={new:'Новый клиент',contacted:'На связи',selection:'Подбор автомобиля',waiting:'Ожидаем решения',contract:'Оформление договора',completed:'Сделка завершена',inactive:'Неактивный'} as const;
export const clientStatusLabel=(value?:string)=>CLIENT_STATUSES[value as keyof typeof CLIENT_STATUSES]||CLIENT_STATUSES.new;
