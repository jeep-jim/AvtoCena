import type {VehicleOffer} from './types';
import type {CurrencyRateSnapshot} from './rates';
import type {ajesLot} from './ajes-query';
import {ajesText} from './ajes-query';
export const ajesOfferId=(id:string)=>/^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(id);
export function ajesOffer(lot:NonNullable<ReturnType<typeof ajesLot>>,rate:CurrencyRateSnapshot,observedAt:string):VehicleOffer {
 if(lot.table!=='stats'||!lot.finalPriceJpy||lot.year<2010||!['cbr','cbr_live'].includes(rate.rateSource)||rate.currency!=='JPY'||rate.sourcePrice!==lot.finalPriceJpy||!(rate.effectiveRate>0))throw Error('ajes_invalid_offer');
 const sellerPriceRub=Math.round(lot.finalPriceJpy*rate.effectiveRate);
 return {id:`ajes-stats-${lot.id}`,sourceId:'ajes_japan_feed',sourceOfferId:lot.id,market:'japan',offerType:'auction',status:'sold',catalogKind:'auction_result',auctionResult:'sold',auctionPriceKind:'published_result',
 make:ajesText(lot.make),model:ajesText(lot.model),trim:ajesText(lot.trim),year:lot.year,mileageKm:lot.mileageKm??undefined,engineCc:lot.engineCc||undefined,
 fuel:({P:'petrol',D:'diesel',E:'electric',H:'hybrid',HE:'hybrid',L:'lpg',C:'cng'} as Record<string,string>)[ajesText(lot.sourceFuel).toUpperCase()],
 powertrainKind:ajesText(lot.sourceFuel).toUpperCase()==='HE'?'series_hybrid':ajesText(lot.sourceFuel).toUpperCase()==='E'?'electric':undefined,
 transmission:({AT:'automatic',MT:'manual',CVT:'cvt',DCT:'dct'} as Record<string,string>)[ajesText(lot.sourceTransmission).toUpperCase()],
 drive:({FF:'fwd',FR:'rwd',FWD:'fwd',RWD:'rwd',AWD:'awd','4WD':'awd',FULLTIME4WD:'awd'} as Record<string,string>)[ajesText(lot.sourceDrive).toUpperCase()],
 frameNumber:lot.frameNumber,auctionName:lot.auction,auctionDate:lot.auctionDate,lotNumber:lot.lot,auctionGrade:lot.grade,
 sourcePrice:lot.finalPriceJpy,sourceCurrency:'JPY',priceMode:'fixed',catalogPricingMode:'seller',sellerPriceRub,totalRub:null,calculationStatus:'needs_data',
 calculationSnapshot:{currencyRate:rate,sourcePriceRub:sellerPriceRub,pricingConfidence:'unavailable'},
 images:lot.images.map((img,i)=>({id:`ajes-${lot.id}-${i}`,url:img.role==='auction_sheet'?img.originalUrl:img.url,role:img.role as 'vehicle'|'auction_sheet',objectKey:'',size:0,checksum:'',mimeType:''})),
 firstSeenAt:observedAt,updatedAt:observedAt,
 operational:{semanticEvidence:{...(lot.engineCc&&lot.engineCc>0?{engineCc:{status:'exact',value:lot.engineCc,source:`ajes:${lot.table}:${lot.id}:ENG_V`,rawValues:[String(lot.engineCc)]}}:{}),...(lot.sourceFuel?{fuel:{status:'exact',source:`ajes:${lot.table}:${lot.id}:FUEL`,rawValues:[lot.sourceFuel]}}:{})},publicJapanSoldIdentityVerified:true,publicJapanSoldPriceVerified:true,raw:{auctionResult:true,finalPriceJpy:lot.finalPriceJpy,sourcePower:lot.sourcePower,sourceDrive:lot.sourceDrive,sourceFuel:lot.sourceFuel,sourceTransmission:lot.sourceTransmission,chassisCode:lot.chassisCode}},
 };
}
