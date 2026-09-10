import type { VehicleOffer } from "./types";
import { jpaucIdentityGalleryEvidence, jpaucPhotoVariants, type JpaucRawRow } from "./jpauc-past-source";
import { captureSourceTable } from "./source-table-capture";

const token=(value:unknown)=>String(value || "").toLowerCase().replace(/[^a-z0-9]/g,"");
const chassis=(value:unknown)=>token(String(value || "").replace(/^(?:E|GF|TA|ABA|CBA|DBA|DAA|DLA|3BA|4BA|5BA|6AA|6LA|7BA|ZAA)-/i,""));
function auctionDay(value:unknown) {
 const date=String(value || "");
 if(/^\d{4}-\d{2}-\d{2}$/.test(date))return date;
 if(!/^\d{4}-\d{2}-\d{2}T/.test(date) || !Number.isFinite(Date.parse(date)))return "";
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(date));
 return ["year","month","day"].map(type=>parts.find(p=>p.type===type)?.value).join("-");
}
function identity(offer:VehicleOffer) {
 const row=offer.operational?.raw as any;
 const fields=[auctionDay(offer.auctionDate),token(offer.auctionName),token(String(offer.lotNumber || "").replace(/^0+/,"")),
  token(offer.make),token(offer.model),String(offer.year || ""),chassis(offer.operational?.modelCode || row?.modelCode || offer.generation || row?.chassis)];
 return fields.every(Boolean)?fields.join("|"):"";
}

/** Pure merge of two collected records. No request, fuzzy match or inferred power. */
export function joinJapanInventory(input:VehicleOffer[]) {
 const evidence=new Map<string,VehicleOffer[]>();
 const media=new Map<string,VehicleOffer[]>();
 for(const row of input)if(row.sourceId==="jpauc_japan_past_open"){const key=identity(row);if(key)media.set(key,[...(media.get(key)||[]),row]);}
 for(const row of input) {
  if(row.market!=="japan" || row.sourceId!=="carvector_japan_stat_open" || row.auctionResult!=="sold" || row.auctionPriceKind!=="published_result"
    || !(Number(row.sourcePrice)>0) || row.sourceCurrency!=="JPY")continue;
  const key=identity(row);if(key)evidence.set(key,[...(evidence.get(key)||[]),row]);
 }
 let joined=0,ambiguous=0;
 const offers=input.map(original=>{
  if(original.sourceId==="drom_japan_stat") {
   const matches=(media.get(identity(original))||[]).filter(row=>identity(original)
    && row.operational?.raw && jpaucIdentityGalleryEvidence(row.operational.raw as JpaucRawRow).ok
    && Number(row.engineCc)>0 && Number(row.engineCc)===Number((original.operational?.raw as any)?.nominalEngineCc)
    && row.mileageKm!=null && original.mileageKm!=null && row.mileageKm===original.mileageKm
    && row.images?.length);
   const unique=[...new Map(matches.map(row=>[row.sourceOfferId,row])).values()];
   if(unique.length!==1){if(unique.length>1)ambiguous++;return original;}
   const donor=unique[0],result=structuredClone(original);
   result.images=[...new Map([...result.images,...jpaucPhotoVariants((donor.operational.raw as JpaucRawRow).listingImage).map(url=>({id:"",url,objectKey:"",checksum:"",size:0,mimeType:"image/jpeg"}))].map(img=>[img.url,img])).values()];
   result.operational.raw={...(result.operational.raw as Record<string,unknown>),additionalMediaSourceUrl:donor.operational.sourceUrl,additionalMediaSourceId:donor.sourceOfferId,exactJoinFields:["auctionDate","auctionVenue","lotNumber","make","model","year","chassis","nominalEngineCc","mileageKm"]};
   joined++;return result;
  }
  if(original.market!=="japan" || original.sourceId!=="jpauc_japan_past_open")return original;
  const raw=original.operational?.raw as JpaucRawRow;
  if(!raw || !jpaucIdentityGalleryEvidence(raw).ok || !/^(?:sold|продан|落札)$/i.test(String(raw.sourceStatus).trim()))return original;
  const candidates=(evidence.get(identity(original)) || []).filter(row=>Number(row.engineCc)>0 && Number(row.engineCc)===Number(original.engineCc)
    && (row.mileageKm==null || original.mileageKm==null || Number(row.mileageKm)===Number(original.mileageKm)));
  const matches=[...new Map(candidates.map(row=>[row.sourceOfferId,row])).values()];
  if(matches.length!==1){if(matches.length>1)ambiguous++;return original;}
  const source=matches[0],result=structuredClone(original),sourceEvidence=source.operational?.semanticEvidence as any;
  result.auctionResult="sold";result.auctionPriceKind="published_result";result.catalogKind="auction_result";
  result.sourcePrice=source.sourcePrice;result.sourceCurrency="JPY";result.priceMode="fixed";result.calculationStatus="needs_data";result.totalRub=null;
  // Use only JPAuc's own identity-checked pictures, never CarVector thumbnails.
  result.images=jpaucPhotoVariants(raw.listingImage).map(url=>({id:"",url,objectKey:"",checksum:"",size:0,mimeType:"image/jpeg"}));
  for(const field of ["fuel","powertrainKind","powerHp","powerKw"] as const) {
    if(sourceEvidence?.[field]?.status==="exact") (result as any)[field]=source[field];
  }
  if(sourceEvidence?.powerHp?.status==="exact") {result.powerDataConfidence="source_exact";result.powerDataSource=source.operational.sourceUrl;}
  result.operational={...result.operational,photoIdentityVerified:true,galleryVerified:true,
    semanticEvidence:{...(original.operational?.semanticEvidence as any),...sourceEvidence},
    raw:{...raw,finalPriceJpy:source.sourcePrice,listingBoundImages:true,photoIdentityVerified:true,recoveryExactSourceUrl:true,recoveryExactPhotoIdentity:true,
      carvectorEvidenceSourceId:source.sourceId,carvectorEvidenceId:source.sourceOfferId,carvectorEvidenceUrl:source.operational.sourceUrl,
      exactJoinVersion:2,exactJoinFields:["auctionDate","auctionVenue","lotNumber","make","model","chassis","year","engineCc"]},
  };
  const groups=[...(result.operational.sourceSpecifications?.groups || []),...(source.operational?.sourceSpecifications?.groups || []).map(group=>({...group,name:`CarVector · ${group.name}`}))];
  captureSourceTable(result,groups,"listing_fields");joined++;return result;
 });
 return {offers,report:{joined,ambiguous,policy:"exact_auction_identity_and_displacement_v2"}};
}
