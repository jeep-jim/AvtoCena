import fs from 'node:fs/promises';
import {readMarketOffers} from '../apps/web/lib/catalog/storage.ts';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {catalogAuctionSheetUrls} from '../apps/web/lib/catalog/image-quality.ts';
import {parseProAuctionsDetailEvidence} from '../apps/web/lib/catalog/proauctions-detail-evidence.ts';
const storage=getJsonStorage();for(const key of ['writeJson','putBinary','deleteJson','deleteBinary','deleteObjects','deletePrefix'])storage[key]=async()=>{throw Error('probe_read_only');};
const rows=(await readMarketOffers('japan')).filter(row=>row.sourceId==='proauctions_japan_stat'&&!catalogAuctionSheetUrls(row).length);
const report={startedAt:new Date().toISOString(),missing:rows.length,sampled:[],stopped:null};
let errors=0;
for(const row of rows.slice(0,20)){
 const url=row.operational?.sourceUrl;
 if(!/^https:\/\/demo\.pro-auctions\.ru\/statistika\/[^?#]+\/\d+\.html$/.test(url||''))throw Error('unexpected_source_url');
 const result={id:row.id,sourceOfferId:row.sourceOfferId,sourceUrl:url};
 try{
  const response=await fetch(url,{redirect:'error',headers:{'user-agent':'AvtoCena source import/1.0'},signal:AbortSignal.timeout(20000)});
  result.httpStatus=response.status;
  if([401,403,429].includes(response.status)){report.stopped='source_access_refused';report.sampled.push(result);break;}
  if(!response.ok)throw Error('http_'+response.status);
  const body=await response.text();if(body.length>3000000)throw Error('response_too_large');
  const e=parseProAuctionsDetailEvidence(body,url);
  result.identityMatches=String(e.identity.year)===String(row.year)&&String(e.identity.lotNumber)===String(row.lotNumber)&&String(e.identity.auctionDate)===String(row.auctionDate);
  result.priceMatches=Number(e.price.amountJpy)===Number(row.sourcePrice);
  result.sourceSheets=e.auctionSheetUrls;result.sourceImages=e.imageUrls.length;result.issues=e.issues;errors=0;
 }catch(error){result.error=String(error);errors++;}
 report.sampled.push(result);
 if(errors>=3){report.stopped='source_unavailable';break;}
 await new Promise(resolve=>setTimeout(resolve,500));
}
report.completedAt=new Date().toISOString();await fs.writeFile('japan-missing-sheet-probe.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
