import {dubicarsDisplacement} from './dubicars-displacement';
import {stableOfferId} from './storage';
import {canonicalizeSemanticSourceFields} from './powertrain-safety';
import type {VehicleOffer} from './types';
export const AUTO_API_DUBICARS_SOURCE='dubicars_uae_exact';
const text=(v:unknown)=>typeof v==='string'||typeof v==='number'?String(v).trim():'';
const positive=(v:unknown)=>/^\d+(?:\.\d+)?$/.test(text(v))&&Number(v)>0?Number(v):undefined;
const evidence=(field:string,value:unknown)=>({source:`auto_api_dubicars:${field}`,status:value===undefined?'missing':'exact',value});
export function normalizeAutoApiDubicars(row:any,observedAt=new Date().toISOString()):VehicleOffer|null {
 const d=row?.data,id=text(row?.inner_id);
 if(!d||!/^\d+$/.test(id)||text(d.inner_id)!==id||!text(d.mark)||!text(d.model))return null;
 let u:URL;try{u=new URL(text(d.url));}catch{return null;}
 if(u.origin!=='https://www.dubicars.com'||u.username||u.password||!u.pathname.endsWith(`-${id}.html`))return null;
 const year=positive(d.year);if(!Number.isInteger(year)||!year||year<1886||year>new Date(observedAt).getUTCFullYear()+1)return null;
 let values=d.images;if(typeof values==='string'){try{values=JSON.parse(values);}catch{values=[];}}
 const images=[...new Set<string>((Array.isArray(values)?values:[]).filter((v:unknown)=>{
  try{const image=new URL(text(v));return image.protocol==='https:'&&image.hostname==='www.dubicars.com'&&!image.port&&!image.username&&!image.password&&image.pathname.startsWith('/images/')&&/\.(?:jpe?g|png|webp|avif)$/i.test(image.pathname)&&!image.search;}catch{return false;}
 }))].slice(0,30).map(url=>({id:'',url,objectKey:'',checksum:'',size:0,mimeType:'image/jpeg'}));
 const fields=canonicalizeSemanticSourceFields({fuel:text(d.engine_type),bodyType:text(d.body_type),transmission:text(d.transmission_type),drive:text(d.drive_type)});
 const kind=fields.fuel==='electric'?'electric':fields.fuel==='hybrid'?'other_hybrid':fields.fuel?'combustion':'unknown';
 // Use the supplier-confirmed unit, preserving the original value and unit.
 const displacement=fields.fuel==='electric'?undefined:dubicarsDisplacement(d.displacement),engineCc=displacement?.cc;
 const price=positive(d.price),title=[text(d.mark),text(d.model),text(d.configuration),text(d.complectation)].filter(Boolean).join(' ');
 return {id:stableOfferId(AUTO_API_DUBICARS_SOURCE,id),sourceId:AUTO_API_DUBICARS_SOURCE,sourceOfferId:id,market:'uae',offerType:'fixed',status:'active',catalogKind:'listing',make:text(d.mark),model:text(d.model),trim:text(d.configuration)||text(d.complectation)||undefined,sourceTitle:title,year,...fields,powertrainKind:kind,engineCc,mileageKm:/^\d+$/.test(text(d.km_age))?Number(d.km_age):undefined,sourcePrice:price,sourceCurrency:'AED',priceMode:'fixed',images,totalRub:null,calculationStatus:'needs_data',firstSeenAt:observedAt,updatedAt:observedAt,
 operational:{sourceUrl:u.origin+u.pathname,sourceVenueName:'DubiCars',sourceTitle:title,provider:'auto-api.com',exactDetail:true,detailIdentityVerified:true,fieldIdentityVerified:true,photoIdentityVerified:images.length>0,exactPhotos:images.length>0,galleryVerified:images.length>0,galleryImageCount:images.length,lastSeenAt:observedAt,sourceDisplacementLabel:text(d.displacement),semanticEvidence:{year:evidence('year',year),fuel:evidence('engine_type',fields.fuel),engineCc:displacement?{source:displacement.source,status:'exact',value:engineCc,rawValue:displacement.raw,sourceUnit:displacement.unit}:evidence('displacement',undefined),powerHp:evidence('power',undefined),certifiedPower:evidence('certified_30min_power',undefined)}}};
}
