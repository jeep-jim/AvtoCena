export function leadDealerId(lead:any){return String(lead?.requestedDealerId||lead?.dealerId||lead?.offerSnapshot?.dealerId||'dealer_topavto');}

export function offerLeadDealerIds(ids:string[],requested='dealer_topavto'){return new Set(ids.map(id=>/^special_([a-zA-Z0-9_-]{1,80})__([a-zA-Z0-9-]{1,80})$/.exec(id)?.[1]||requested));}
