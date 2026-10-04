export function leadDealerId(lead:any){return String(lead?.requestedDealerId||lead?.dealerId||lead?.offerSnapshot?.dealerId||'dealer_topavto');}
