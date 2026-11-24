/** AJ System is purchased for Japanese auctions only. Saved settings cannot widen this boundary. */
export class AjesUnavailable extends Error {constructor(public reason:string){super(`ajes_${reason}`);}}

export function assertAjesJapanTable(table:unknown){
 if(table!==undefined&&table!=='stats'&&table!=='main')throw new AjesUnavailable('market_not_supported');
}

export function assertAjesJapanMarket(market:unknown){
 if(market!==undefined&&market!==null&&market!==''&&market!=='japan')throw new AjesUnavailable('market_not_supported');
}

export function retiredAjesOffer(id:unknown,sourceId?:unknown){
 return /^ajes-(?:china|korea)-/.test(String(id||''))||sourceId==='ajes_china_feed'||sourceId==='ajes_korea_feed';
}
