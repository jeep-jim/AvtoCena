export function assertJapanSheetIdentity(row, evidence) {
 const expected={sourceOfferId:evidence.sourceId,sourcePrice:evidence.price.amountJpy,year:evidence.identity.year,lotNumber:evidence.identity.lotNumber,auctionDate:evidence.identity.auctionDate};
 if(row.sourceId!=='proauctions_japan_stat' || row.operational?.sourceUrl!==evidence.sourceUrl || Object.entries(expected).some(([k,v])=>String(row[k])!==String(v)))throw Error('sheet_identity_conflict');
 const group=url=>String(url).match(/^https:\/\/jp\d+\.pa-server\.ru(\/auc_auto\/\d{4}_\d{2}_\d{2}\/\d+\/)[^?#]+$/)?.[1];
 const oldGroups=[...new Set(row.images.filter(x=>x.role!=='auction_sheet').map(x=>group(x.url)).filter(Boolean))];
 if(oldGroups.length!==1 || evidence.auctionSheetUrls.some(url=>group(url)!==oldGroups[0]) || evidence.issues.includes('gallery_identity_unconfirmed'))throw Error('sheet_gallery_conflict');
 return expected;
}
