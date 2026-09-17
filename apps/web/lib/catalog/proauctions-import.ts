import { createHash } from 'node:crypto';
import { parseProAuctionsDetailEvidence, proAuctionsText } from './proauctions-detail-evidence';
import type { VehicleOffer } from './types';

const norm = (v: unknown) => String(v || '').toLowerCase().replace(/[^a-zа-я0-9]/g, '');
export function proAuctionsIdentity(html: string, evidence: ReturnType<typeof parseProAuctionsDetailEvidence>) {
  const crumbs = [...html.matchAll(/<[^>]+itemprop=["']name["'][^>]*>([\s\S]*?)<\//gi)].map(m => proAuctionsText(m[1]));
  const i = crumbs.findIndex(v => v === 'Статистика');
  const make = crumbs[i + 1], model = crumbs[i + 2];
  if (i < 0 || !make || !model || norm(`${make} ${model}`) !== norm(evidence.identity.name)) throw Error('breadcrumb_identity_conflict');
  return {make, model};
}

/** An independent sold record must agree on the entire lot, not just its numeric ID. */
export function matchingProAuctionsSale(e: ReturnType<typeof parseProAuctionsDetailEvidence>, identity: {make:string;model:string}, witness: any) {
  return !!witness && witness.source === 'jptrade' && witness.statusRaw === 'продано'
    && /^\d+$/.test(String(witness.sourceId)) && witness.sourceUrl === `https://jptrade.ru/stat/${witness.sourceId}`
    && /^[a-f0-9]{64}$/.test(witness.evidenceSha256 || '')
    && e.identity.auctionDate === witness.auctionDate && e.identity.year === witness.year
    && e.price.amountJpy === witness.priceJpy
    && ['make','model'].every(k => norm((identity as any)[k]) === norm(witness[k]))
    && ['auctionName','lotNumber','chassis'].every(k => norm((e.identity as any)[k]) && norm((e.identity as any)[k]) === norm(witness[k]));
}

export function proAuctionsOffer(e: ReturnType<typeof parseProAuctionsDetailEvidence>, identity: {make:string;model:string}, witness: any, photos: any[], digest: string, now = Date.now()): VehicleOffer | null {
  const date = Date.parse(e.identity.auctionDate);
  if (!Number.isFinite(date) || date > now || now-date > 30*86400000 || e.identity.year < 2010 || e.identity.year > new Date(now).getUTCFullYear()) return null;
  if (!/^[a-f0-9]{64}$/.test(digest) || e.issues.includes('gallery_identity_unconfirmed')) return null;
  if (!e.price.saleConfirmed && !matchingProAuctionsSale(e,identity,witness)) return null;
  const decoded = photos.filter(p => e.imageUrls.includes(p.url) && /^[a-f0-9]{64}$/.test(p.decodedSha256 || '') && p.width >= 100 && p.height >= 100);
  if(new Set(decoded.map(p=>p.decodedSha256)).size < 2) return null;
  const timestamp = new Date(now).toISOString(), sourceId='proauctions_japan_stat', s=e.specifications;
  const evidence=(status:string,value?:unknown)=>({status, ...(value===undefined?{}:{value}), source:e.sourceUrl,rawValues:[]});
  const powerConflict=e.issues.some(x=>/power/.test(x)), fuelConflict=e.issues.some(x=>/fuel|powertrain|combustion|motor/.test(x));
  const kind=s.powertrain==='hybrid'?'unknown':s.powertrain;
  return {
    id:createHash('sha256').update(`${sourceId}:${e.sourceId}`).digest('hex').slice(0,24), sourceId,sourceOfferId:e.sourceId,
    market:'japan',status:'active',offerType:'auction',catalogKind:'auction_result',auctionResult:'sold',auctionPriceKind:'published_result',priceMode:'fixed',
    ...identity,year:e.identity.year,trim:e.identity.trim || undefined,sourceTitle:e.identity.name,
    sourcePrice:e.price.amountJpy,sourceCurrency:'JPY',totalRub:null,calculationStatus:'needs_data',
    auctionDate:e.identity.auctionDate,auctionName:e.identity.auctionName || undefined,lotNumber:e.identity.lotNumber,auctionGrade:s.grade || undefined,
    mileageKm:s.mileageKm ?? undefined,transmission:s.transmission || undefined,
    fuel:!fuelConflict ? s.fuel || undefined : undefined,powertrainKind:!fuelConflict ? kind : 'unknown',
    powerHp:!powerConflict ? s.reportedCombustionPowerHp ?? undefined : undefined,
    powerKw:!powerConflict ? s.reportedCombustionPowerKw ?? undefined : undefined,
    firstSeenAt:timestamp,updatedAt:timestamp,
    images:decoded.map(p=>({id:p.decodedSha256,url:p.url,objectKey:'',checksum:p.decodedSha256,width:p.width,height:p.height,size:p.size,mimeType:p.mimeType})),
    operational:{sourceUrl:e.sourceUrl,exactDetail:true,photoIdentityVerified:true,
      semanticEvidence:{year:evidence('exact',e.identity.year),engineCc:evidence('ambiguous',s.reportedEngineCc),
        fuel:evidence(fuelConflict || !s.fuel?'ambiguous':'exact',s.fuel),
        powerHp:evidence(powerConflict?'conflict':s.reportedCombustionPowerHp?'exact':'missing',s.reportedCombustionPowerHp),
        powertrainKind:evidence(kind==='unknown'||fuelConflict?'ambiguous':'exact',kind)},
      sourceSpecifications:{version:1,sourceId,sourceOfferId:e.sourceId,specificationId:e.sourceId,sourceUrl:e.sourceUrl,capturedAt:timestamp,
        groups:[{name:'Характеристики аукциона',items:Object.entries(e.sourceFields).map(([name,values])=>({name,value:values.join('; ')}))}]},
      raw:{sourceEvidence:e,evidenceSha256:digest,saleWitness:witness || null,decodedGallery:decoded,
        auctionResult:true,finalPriceJpy:e.price.amountJpy,listingBoundImages:true,photoIdentityVerified:true,recoveryExactSourceUrl:true,recoveryExactPhotoIdentity:true,
        calculationBlockers:e.calculationBlockers}},
  } as VehicleOffer;
}
