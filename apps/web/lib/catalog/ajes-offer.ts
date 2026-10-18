import {JAPAN_MIN_MODEL_YEAR} from './japan-year-policy';
import type {VehicleOffer} from './types';
import type {CurrencyRateSnapshot} from './rates';
import type {ajesLot} from './ajes-query';
import {ajesText} from './ajes-query';
export const ajesOfferId=(id:string)=>/^ajes-(?:stats|korea|china)-[A-Za-z0-9_-]{1,64}$/.test(id);
export function ajesOffer(lot:NonNullable<ReturnType<typeof ajesLot>>,rate:CurrencyRateSnapshot,observedAt:string):VehicleOffer {
 if(lot.table==='china'||lot.table==='korea')return ajesStockOffer(lot,rate,observedAt);
 if(lot.table!=='stats'||!lot.finalPriceJpy||lot.year<JAPAN_MIN_MODEL_YEAR||!['cbr','cbr_live'].includes(rate.rateSource)||rate.currency!=='JPY'||rate.sourcePrice!==lot.finalPriceJpy||!(rate.effectiveRate>0))throw Error('ajes_invalid_offer');
 const fuel=({P:'petrol',D:'diesel',E:'electric',H:'hybrid',HE:'hybrid',L:'lpg',C:'cng'} as Record<string,string>)[ajesText(lot.sourceFuel).toUpperCase()];
 const sellerPriceRub=Math.round(lot.finalPriceJpy*rate.effectiveRate);
 return {id:`ajes-stats-${lot.id}`,sourceId:'ajes_japan_feed',sourceOfferId:lot.id,market:'japan',offerType:'auction',status:'sold',catalogKind:'auction_result',auctionResult:'sold',auctionPriceKind:'published_result',
 make:ajesText(lot.make),model:ajesText(lot.model),trim:ajesText(lot.trim),year:lot.year,mileageKm:lot.mileageKm??undefined,engineCc:lot.engineCc||undefined,
 fuel,
 powertrainKind:ajesText(lot.sourceFuel).toUpperCase()==='HE'?'series_hybrid':ajesText(lot.sourceFuel).toUpperCase()==='E'?'electric':undefined,
 transmission:({AT:'automatic',MT:'manual',CVT:'cvt',DCT:'dct'} as Record<string,string>)[ajesText(lot.sourceTransmission).toUpperCase()],
 drive:({FF:'fwd',FR:'rwd',FWD:'fwd',RWD:'rwd',AWD:'awd','4WD':'awd',FULLTIME4WD:'awd'} as Record<string,string>)[ajesText(lot.sourceDrive).toUpperCase()],
 color:lot.color,frameNumber:lot.frameNumber,auctionName:lot.auction,auctionDate:lot.auctionDate,lotNumber:lot.lot,auctionGrade:lot.grade,
 sourcePrice:lot.finalPriceJpy,sourceCurrency:'JPY',priceMode:'fixed',catalogPricingMode:'seller',sellerPriceRub,totalRub:null,calculationStatus:'needs_data',
 calculationSnapshot:{currencyRate:rate,sourcePriceRub:sellerPriceRub,pricingConfidence:'unavailable'},
 images:lot.images.map((img,i)=>({id:`ajes-${lot.id}-${i}`,url:img.role==='auction_sheet'?img.originalUrl:img.url,role:img.role as 'vehicle'|'auction_sheet',objectKey:'',size:0,checksum:'',mimeType:''})),
 firstSeenAt:observedAt,updatedAt:observedAt,
 operational:{chassisCode:lot.chassisCode,auctionTown:lot.auctionTown,sourceEquipment:lot.equipment,sourceTransmissionCode:lot.transmissionCode,semanticEvidence:{...(lot.engineCc&&lot.engineCc>0?{engineCc:{status:'exact',value:lot.engineCc,source:`ajes:${lot.table}:${lot.id}:ENG_V`,rawValues:[String(lot.engineCc)]}}:{}),...(fuel?{fuel:{status:'exact',value:fuel,source:`ajes:${lot.table}:${lot.id}:${lot.sourceFuelField||'FUEL'}`,rawValues:[lot.sourceFuel]}}:{})},publicJapanSoldIdentityVerified:true,publicJapanSoldPriceVerified:true,raw:{auctionResult:true,finalPriceJpy:lot.finalPriceJpy,sourcePower:lot.sourcePower,sourceDrive:lot.sourceDrive,sourceFuel:lot.sourceFuel,sourceFuelField:lot.sourceFuelField,sourceTransmission:lot.sourceTransmission,chassisCode:lot.chassisCode}},
 };
}

/** Supplier search.php contract: FINISH is KRW/CNY, ENG_V cc, PW hp, MILEAGE km. */
function ajesStockOffer(lot:NonNullable<ReturnType<typeof ajesLot>>,rate:CurrencyRateSnapshot,observedAt:string):VehicleOffer {
 const market=lot.table==='korea'?'korea':'china',currency=market==='korea'?'KRW':'CNY';
 if(!lot.sourcePrice||rate.currency!==currency||rate.sourcePrice!==lot.sourcePrice||!['cbr','cbr_live'].includes(rate.rateSource)||!(rate.effectiveRate>0))throw Error('ajes_invalid_offer');
 const fuel=({P:'petrol',D:'diesel',E:'electric',H:'hybrid',HE:'hybrid',L:'lpg',C:'cng'} as Record<string,string>)[lot.sourceFuel.toUpperCase()];
 const hp=/^\d+(?:\.\d+)?$/.test(lot.sourcePower)?Number(lot.sourcePower):undefined;
 const powerHp=hp&&hp>0&&hp<=2500?hp:undefined;
 const sellerPriceRub=Math.round(lot.sourcePrice*rate.effectiveRate),sourceId=`ajes_${market}_feed`;
 return {id:`ajes-${market}-${lot.id}`,sourceId,sourceOfferId:lot.id,market,offerType:'fixed',status:'active',catalogKind:'listing',
 make:lot.make,model:lot.model,trim:lot.trim,year:lot.year,
 productionDate:lot.productionMonth&&lot.productionMonth>=1&&lot.productionMonth<=12?`${lot.year}-${String(lot.productionMonth).padStart(2,'0')}`:undefined,
 mileageKm:lot.mileageKm??undefined,engineCc:lot.engineCc||undefined,powerHp,fuel,
 powertrainKind:lot.sourceFuel==='HE'?'series_hybrid':lot.sourceFuel==='E'?'electric':undefined,
 transmission:({AT:'automatic',MT:'manual',CVT:'cvt',DCT:'dct'} as Record<string,string>)[lot.sourceTransmission.toUpperCase()],
 drive:({FF:'fwd',FR:'rwd',FWD:'fwd',RWD:'rwd',AWD:'awd','4WD':'awd',FULLTIME4WD:'awd'} as Record<string,string>)[lot.sourceDrive.toUpperCase()],
 color:lot.color,frameNumber:lot.frameNumber,lotNumber:lot.lot,
 sourcePrice:lot.sourcePrice,sourceCurrency:currency,priceMode:'fixed',catalogPricingMode:'seller',sellerPriceRub,totalRub:null,calculationStatus:'needs_data',
 calculationSnapshot:{currencyRate:rate,sourcePriceRub:sellerPriceRub,pricingConfidence:'unavailable'},
 images:lot.images.map((img,i)=>({id:`ajes-${market}-${lot.id}-${i}`,url:img.url.replace(/^https:\/\/(?:7\.tru\.ru|[78]\.ajes\.com)\//,'https://9.ajes.com/'),role:'vehicle',objectKey:'',size:0,checksum:'',mimeType:''})),firstSeenAt:observedAt,updatedAt:observedAt,
 operational:{chassisCode:lot.chassisCode,sourceEquipment:lot.equipment,semanticEvidence:{...(lot.engineCc&&lot.engineCc>0?{engineCc:{status:'exact',value:lot.engineCc,source:`ajes:${market}:${lot.id}:ENG_V`,rawValues:[String(lot.engineCc)]}}:{}),...(powerHp?{powerHp:{status:'exact',value:powerHp,source:`ajes:${market}:${lot.id}:PW`,rawValues:[lot.sourcePower]}}:{}),...(fuel?{fuel:{status:'exact',value:fuel,source:`ajes:${market}:${lot.id}:TIME`,rawValues:[lot.sourceFuel]}}:{})},raw:{sourcePower:lot.sourcePower,sourceFuel:lot.sourceFuel,sourceDrive:lot.sourceDrive,sourceTransmission:lot.sourceTransmission}},
 };
}
