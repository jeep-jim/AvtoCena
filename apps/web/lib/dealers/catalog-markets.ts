export const DEALER_MARKETS = [
 {id:'japan',label:'Япония',flag:'🇯🇵'}, {id:'china',label:'Китай',flag:'🇨🇳'},
 {id:'korea',label:'Корея',flag:'🇰🇷'}, {id:'uae',label:'ОАЭ',flag:'🇦🇪'},
 {id:'europe',label:'Европа',flag:'🇪🇺'}, {id:'georgia',label:'Грузия',flag:'🇬🇪'},
] as const;
export type DealerMarket = typeof DEALER_MARKETS[number]['id'];
export function dealerMarkets(value:unknown):DealerMarket[]{
 return Array.isArray(value)?DEALER_MARKETS.filter(m=>value.includes(m.id)).map(m=>m.id):[];
}
