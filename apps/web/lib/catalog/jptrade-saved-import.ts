import { createHash } from 'node:crypto';
import type { VehicleOffer } from './types';

/** Admit only explicit sold results with image evidence bound to the saved detail. */
export function jptradeSavedOffer(row: any, checked: any, now = Date.now()): VehicleOffer | null {
  const id = String(row?.sourceId || '');
  const url = `https://jptrade.ru/stat/${id}`;
  const day = Date.parse(row?.auctionDate);
  if (!/^\d+$/.test(id) || row.sourceUrl !== url || checked?.sourceId !== id || checked?.sourceUrl !== url
    || row.source !== 'jptrade' || String(row.statusRaw).toLowerCase() !== 'продано'
    || !Number.isFinite(day) || day > now || now - day > 30 * 86400000
    || !row.make || !row.model || !row.auctionName || !row.lotNumber
    || !Number.isInteger(row.year) || row.year < 2010 || row.year > new Date(now).getFullYear()
    || !Number.isFinite(row.priceJpy) || row.priceJpy <= 0
    || !/^[a-f0-9]{64}$/.test(row.evidenceSha256)) return null;
  const sheetUrls = new Set(row.auctionSheetUrls || []);
  const urls = new Set(row.imageUrls || []);
  const decoded = (checked.images || []).filter((img: any) => urls.has(img.url) && !sheetUrls.has(img.url)
    && /^[a-f0-9]{64}$/.test(img.decodedSha256) && img.size?.length === 2 && Math.min(...img.size) >= 100);
  if (new Set(decoded.map((img: any) => img.decodedSha256)).size < 2) return null;
  const galleryGroups = new Set(decoded.map((img: any) => {
    try {
      const u = new URL(img.url);
      if (u.protocol !== 'https:' || !/^jp\d+\.pa-server\.ru$/.test(u.hostname) || u.port || u.username || u.password) return '';
      return u.pathname.match(/^\/auc_auto\/\d{4}_\d{2}_\d{2}\/\d+\//)?.[0] || '';
    } catch { return ''; }
  }));
  if (galleryGroups.size !== 1 || galleryGroups.has('')) return null;
  const timestamp = new Date(now).toISOString();
  const missing = {status:'missing',source:url,rawValues:[]};
  return {
    id:createHash('sha256').update(`jptrade_japan_stat:${id}`).digest('hex').slice(0,24),
    sourceId:'jptrade_japan_stat',sourceOfferId:id,market:'japan',status:'active',offerType:'auction',
    catalogKind:'auction_result',auctionResult:'sold',auctionPriceKind:'published_result',priceMode:'fixed',
    make:String(row.make),model:String(row.model),year:row.year,sourcePrice:row.priceJpy,sourceCurrency:'JPY',
    mileageKm:Number.isFinite(row.mileageKm) ? row.mileageKm : undefined,
    auctionDate:row.auctionDate,auctionName:row.auctionName,lotNumber:String(row.lotNumber),auctionGrade:row.grade,
    powertrainKind:'unknown',totalRub:null,calculationStatus:'needs_data',
    images:decoded.map((img: any) => ({id:'',url:img.url,size:0,mimeType:'image/webp',width:img.size[0],height:img.size[1]})),
    firstSeenAt:timestamp,updatedAt:timestamp,
    operational:{sourceUrl:url,exactDetail:true,photoIdentityVerified:true,
      semanticEvidence:{year:{status:'exact',value:row.year,source:url},fuel:missing,engineCc:missing,powerHp:missing,powertrainKind:missing},
      raw:{sourceRecord:row,evidenceSha256:row.evidenceSha256,decodedGallery:decoded,
        galleryIdentityMethod:'saved_detail_gallery_url_and_common_auction_directory',visualCarPhotosConfirmed:false,
        auctionResult:true,finalPriceJpy:row.priceJpy,listingBoundImages:true,photoIdentityVerified:true,
        recoveryExactSourceUrl:true,recoveryExactPhotoIdentity:true}},
  } as VehicleOffer;
}
