/** Public metadata only. Never place credentials or supplier file URLs here. */
export const COLLECTION_MARKETS = [
  {id:'china',label:'Китай'}, {id:'japan',label:'Япония'}, {id:'korea',label:'Корея'},
  {id:'uae',label:'ОАЭ'}, {id:'europe',label:'Европа'}, {id:'georgia',label:'Грузия'},
] as const;
export type CollectionMarket = typeof COLLECTION_MARKETS[number]['id'];
export const COLLECTION_SOURCES = [
  {id:'dubicars_feed',market:'uae',label:'DubiCars · платный фид',url:'https://auto-api.com/ru/dubicars',kind:'feed',defaultEnabled:true,frequency:'В плановое окно обновления ОАЭ',description:'Все предложения DubiCars без ограничений года, цены и мощности.',settings:'Полный каталог и изменения; публикация только завершённого обновления.'},
  ...(['china','korea'] as const).map(market=>({id:`ajes_${market}_feed`,market,label:`AJ System · платный фид ${market==='china'?'Китая':'Кореи'}`,url:'https://avto.jp/',kind:'feed',defaultEnabled:false,frequency:'По запросу посетителя',description:'Основной каталог рынка. Отключение прекращает новые запросы поставщику.',settings:'Общий доступ AJ System. Карточки по ID, до 48 автомобилей за запрос. Цена Китая в CNY, Кореи в KRW. Проверка подключения получает 5 записей.'})),
  {id:'ajes_japan_feed',market:'japan',label:'AJ System · платный фид Японии',url:'https://avto.jp/',kind:'feed',defaultEnabled:false,frequency:'По запросу пользователя',description:'Аукционы и результаты торгов. Подключение проверяется владельцем до публикации.',settings:'До 48 лотов за запрос; карточка запрашивается по ID; фотографии загружаются по прямым ссылкам.'},
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
  if (['proauctions_japan_stat','jptrade_japan_stat'].includes(id)) return false;
  const source=COLLECTION_SOURCES.find(s=>s.id===id);
  if(!source)throw Error('unknown_collection_source');
  return controls.markets[source.market]?.enabled===true && controls.sources[id]?.enabled===true;
}
export function collectionMarketEnabled(controls:CollectionControls,market:string):boolean {
  return COLLECTION_SOURCES.some(s=>s.market===market && collectionEnabled(controls,s.id));
}

export const COLLECTION_WORKFLOWS:Record<string,string>={china:'catalog-refresh-china.yml',korea:'catalog-refresh-korea.yml',uae:'catalog-refresh-uae.yml',europe:'catalog-refresh-europe.yml',georgia:'catalog-refresh-georgia.yml',japan:'catalog-refresh-green.yml'};

export function collectionWorkflowEnabled(controls:CollectionControls,market:string){
  return market==='green'?collectionEnabled(controls,'akebono_green'):market==='japan'?false:COLLECTION_SOURCES.some(s=>s.market===market&&!['ajes_china_feed','ajes_korea_feed'].includes(s.id)&&collectionEnabled(controls,s.id));
}
