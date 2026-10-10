/** Public metadata only. Never place credentials or supplier file URLs here. */
export const COLLECTION_MARKETS = [
  {id:'china',label:'Китай'}, {id:'japan',label:'Япония'}, {id:'korea',label:'Корея'},
  {id:'uae',label:'ОАЭ'}, {id:'europe',label:'Европа'}, {id:'georgia',label:'Грузия'},
] as const;
export type CollectionMarket = typeof COLLECTION_MARKETS[number]['id'];
export const COLLECTION_SOURCES = [
  {id:'che168_feed',market:'china',label:'Che168 · платный фид',url:'https://auto-api.com/',kind:'feed',defaultEnabled:true,frequency:'Ежедневно, 01:11 по Красноярску',description:'Полный исходный файл и последующие изменения поставщика. Ошибка обновления не включает парсеры.',settings:'Только завершённое обновление; курсор сохраняется после проверенной публикации.'},
  {id:'autohome_used_china_open',market:'china',label:'Che168 · резервный парсер',url:'https://global.che168.com/',kind:'parser',defaultEnabled:false,frequency:'После явного включения: ежедневное окно Китая, 01:11 по Красноярску',description:'Прямой сбор подержанных автомобилей. Крайний резерв по решению владельца. Для включения сначала выключите платный фид.',settings:'До 100 000 наблюдений на источник за запуск, до 2 000 страниц; до 4 карточек одновременно, до 30 фото.'},
  {id:'autohome_new_china_open',market:'china',label:'Autohome · резервный парсер новых авто',url:'https://www.autohome.com.cn/',kind:'parser',defaultEnabled:false,frequency:'После явного включения: ежедневное окно Китая, 01:11 по Красноярску',description:'Прямой сбор новых автомобилей. Крайний резерв по решению владельца.',settings:'До 30 минут за запуск, до 100 000 наблюдений; до 4 карточек одновременно, до 30 фото.'},
  ...[
    ['korea','encar_direct','Encar','https://www.encar.com/'],
    ['korea','kcar_korea_open','K Car','https://www.kcar.com/'],
    ['uae','dubizzle_uae_open','Dubizzle','https://uae.dubizzle.com/'],
    ['uae','dubicars_uae_exact','DubiCars','https://www.dubicars.com/'],
    ['uae','carswitch_uae_open','CarSwitch','https://carswitch.com/'],
    ['europe','mobile_de_open','mobile.de','https://www.mobile.de/'],
    ['europe','autoscout_europe_open','AutoScout24','https://www.autoscout24.com/'],
    ['georgia','myauto_georgia_list','MyAuto','https://www.myauto.ge/'],
    ['georgia','autopapa_georgia_open','AutoPapa','https://autopapa.ge/'],
  ].map(([market,id,label,url])=>({id,market:market as CollectionMarket,label,url,kind:'parser',defaultEnabled:true,
    frequency:'Раз в 3 дня; при неполном сборе возможны ограниченные повторные попытки',description:'Сбор объявлений и характеристик с площадки. Отключение прекращает новые обращения сборщика.',
    settings:`До ${market==='korea'?300:210} минут за запуск; до 100 000 наблюдений на источник, до 2 000 страниц, до 4 карточек одновременно, до 30 фото.`})),
  {id:'proauctions_japan_stat',market:'japan',label:'ProAuctions',url:'https://demo.pro-auctions.ru/statistika/',kind:'parser',defaultEnabled:true,frequency:'Новый цикл раз в 14 дней; продолжение незавершённого сбора в ежедневное окно 10:00 по Красноярску',description:'Аукционная статистика с проверкой завершённой продажи.',settings:'До 40 минут сбора за попытку. Пауза между запросами к одному сайту не менее 400 мс; максимум 3 попытки запроса.'},
  {id:'jptrade_japan_stat',market:'japan',label:'JPTrade · проверка продаж',url:'https://jptrade.ru/stat/',kind:'parser',defaultEnabled:true,frequency:'Вместе с ProAuctions, когда требуется подтверждение продажи',description:'Дополнительная проверка цены продажи. Отдельного планового сбора нет; отключение может уменьшить число подтверждённых лотов.',settings:'Только соответствующие лоту страницы; подтверждённая цена не подменяется оценкой.'},
  {id:'akebono_green',market:'japan',label:'Akebono · зелёный угол',url:'https://akebono.world/',kind:'parser',defaultEnabled:true,frequency:'Раз в 3 дня, окно 06:47 по Красноярску',description:'Автомобили в наличии и условия поставки.',settings:'По 50 записей на страницу; неполная выгрузка не заменяет опубликованный список.'},
] as const;
export type CollectionSwitch = {enabled:boolean;enabledAt:string|null;disabledAt:string|null;changedBy:string|null};
export type CollectionChange = {revision:number;at:string;actor:string;scope:'market'|'source';id:string;enabled:boolean};
export type CollectionControls = {version:1;revision:number;updatedAt:string|null;markets:Record<string,CollectionSwitch>;sources:Record<string,CollectionSwitch>;history:CollectionChange[]};
export function defaultCollectionControls():CollectionControls {
  const value=(enabled:boolean):CollectionSwitch=>({enabled,enabledAt:null,disabledAt:null,changedBy:null});
  return {version:1,revision:0,updatedAt:null,markets:Object.fromEntries(COLLECTION_MARKETS.map(m=>[m.id,value(true)])),sources:Object.fromEntries(COLLECTION_SOURCES.map(s=>[s.id,value(s.defaultEnabled)])),history:[]};
}
export function collectionEnabled(controls:CollectionControls,id:string):boolean {
  const source=COLLECTION_SOURCES.find(s=>s.id===id);
  if(!source)throw Error('unknown_collection_source');
  return controls.markets[source.market]?.enabled===true && controls.sources[id]?.enabled===true;
}
export function collectionMarketEnabled(controls:CollectionControls,market:string):boolean {
  return COLLECTION_SOURCES.some(s=>s.market===market && collectionEnabled(controls,s.id));
}

export const COLLECTION_WORKFLOWS:Record<string,string>={china:'catalog-refresh-china.yml',korea:'catalog-refresh-korea.yml',uae:'catalog-refresh-uae.yml',europe:'catalog-refresh-europe.yml',georgia:'catalog-refresh-georgia.yml',japan:'proauctions-collect-publish.yml'};
