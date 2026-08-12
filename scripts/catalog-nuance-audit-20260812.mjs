const { readAllOffersForMaintenance } = await import('../apps/web/lib/catalog/storage.ts');
const { normalizeVehicleOfferSpecs } = await import('../apps/web/lib/catalog/spec-normalization.ts');
const { presentCatalogOffer } = await import('../apps/web/lib/catalog/presentation.ts');

const offers = (await readAllOffersForMaintenance()).filter((offer) => offer?.status === 'active');
const markets = ['korea','china','japan','uae','europe','georgia','kyrgyzstan'];
const positive = (value) => { const n=Number(value); return Number.isFinite(n) && n>0 ? n : 0; };
const clean = (value) => String(value || '').replace(/\s+/g,' ').trim();
const canonicalImage = (value) => {
  try { const u=new URL(clean(value)); u.hash=''; u.search=''; return `${u.hostname.toLowerCase()}${decodeURIComponent(u.pathname)}`; }
  catch { return clean(value).replace(/[?#].*$/,'').toLowerCase(); }
};
const isElectrified = (offer) => ['electric','series_hybrid','other_hybrid'].includes(String(offer.powertrainKind || ''));
const thirtyMinute = (offer) => positive(offer.power30MinKw) || (Array.isArray(offer.power30MinKwByMotor) ? positive(offer.power30MinKwByMotor.reduce((s,v)=>s+Number(v||0),0)) : 0);

const summary = {};
const unresolved = [];
const unresolvedMakes = new Map();
const powerGroups = new Map();
const priceOutliers = [];
for (const market of markets) {
  const rows = offers.filter((offer) => offer.market === market);
  let missingMileage=0, missing30=0, unresolvedTitle=0;
  for (const raw of rows) {
    const offer = normalizeVehicleOfferSpecs(raw);
    const presented = presentCatalogOffer(offer);
    if (!positive(offer.mileageKm)) missingMileage++;
    if (isElectrified(offer) && !thirtyMinute(offer)) {
      missing30++;
      const key=[market,clean(offer.make),clean(offer.model),Number(offer.year||0),clean(offer.generation),clean(offer.powertrainKind)].join('|');
      const current=powerGroups.get(key)||{market,make:offer.make,model:offer.model,year:offer.year,generation:offer.generation,powertrainKind:offer.powertrainKind,count:0,sourceIds:new Set(),peakPowersHp:new Set(),sampleIds:[]};
      current.count++;
      current.sourceIds.add(offer.sourceId);
      if (positive(offer.powerHp)) current.peakPowersHp.add(Number(offer.powerHp));
      if (current.sampleIds.length<5) current.sampleIds.push(offer.id);
      powerGroups.set(key,current);
    }
    if (/Марка уточняется|Модель уточняется/i.test(presented.title || '')) {
      unresolvedTitle++;
      const makeKey=`${market}|${clean(offer.make)}`;
      const makeRow=unresolvedMakes.get(makeKey)||{market,make:clean(offer.make),count:0,models:new Set(),sourceTitles:new Set(),sourceIds:new Set()};
      makeRow.count++;
      if (makeRow.models.size<12) makeRow.models.add(clean(offer.model));
      if (makeRow.sourceTitles.size<4) makeRow.sourceTitles.add(clean(offer.sourceTitle));
      makeRow.sourceIds.add(clean(offer.sourceId));
      unresolvedMakes.set(makeKey,makeRow);
      if (unresolved.length<180) unresolved.push({market,id:offer.id,sourceId:offer.sourceId,make:offer.make,model:offer.model,sourceTitle:offer.sourceTitle,trim:offer.trim,presentedTitle:presented.title,sourceUrl:offer.operational?.sourceUrl});
    }
    const sourceRub=positive(offer.calculationSnapshot?.sourcePriceRub || offer.calculationSnapshot?.currencyRate?.sourcePriceRub);
    const total=positive(offer.totalRub);
    if (sourceRub && total) {
      const ratio=Math.round((total/sourceRub)*100)/100;
      if (ratio>=4 || total>=15_000_000) priceOutliers.push({market,id:offer.id,sourceId:offer.sourceId,make:offer.make,model:offer.model,year:offer.year,sourcePrice:offer.sourcePrice,sourceCurrency:offer.sourceCurrency,sourceRub,totalRub:total,ratio,calculationStatus:offer.calculationStatus,pricingConfidence:offer.calculationSnapshot?.pricingConfidence,sourceTitle:offer.sourceTitle,sourceUrl:offer.operational?.sourceUrl});
    }
  }
  summary[market]={count:rows.length,missingMileage,electrified:rows.filter(isElectrified).length,electrifiedMissing30:missing30,unresolvedTitle};
}

const japan = offers.filter((offer) => offer.market === 'japan');
const usage = new Map();
const checksumUsage = new Map();
const japanTargetModels = /(?:CAST|AZ[- ]?OFFROAD|MIRA|TANTO|MOVE|WAGON R|WAGONR)/i;
const japanTargetSamples=[];
for (const offer of japan) {
  if (japanTargetModels.test(`${offer.make||''} ${offer.model||''}`) && japanTargetSamples.length<120) {
    japanTargetSamples.push({id:offer.id,make:offer.make,model:offer.model,year:offer.year,mileageKm:offer.mileageKm,sourcePrice:offer.sourcePrice,totalRub:offer.totalRub,sourceUrl:offer.operational?.sourceUrl,images:(offer.images||[]).slice(0,5).map((image)=>({url:image?.url,objectKey:image?.objectKey,checksum:image?.checksum,width:image?.width,height:image?.height,size:image?.size,mimeType:image?.mimeType}))});
  }
  for (let index=0; index<(offer.images||[]).length; index++) {
    const image=offer.images[index];
    const key=canonicalImage(image?.url || image?.objectKey);
    if (key) {
      const entry=usage.get(key)||{key,offerIds:new Set(),firstCoverIds:new Set(),sourceIds:new Set(),sampleUrls:new Set()};
      entry.offerIds.add(offer.id);
      if (index===0) entry.firstCoverIds.add(offer.id);
      entry.sourceIds.add(offer.sourceId);
      if (entry.sampleUrls.size<3) entry.sampleUrls.add(image?.url || image?.objectKey);
      usage.set(key,entry);
    }
    const checksum=clean(image?.checksum).toLowerCase();
    if (checksum) {
      const c=checksumUsage.get(checksum)||{checksum,offerIds:new Set(),firstCoverIds:new Set(),sampleUrls:new Set(),sizes:new Set()};
      c.offerIds.add(offer.id);
      if (index===0) c.firstCoverIds.add(offer.id);
      if (c.sampleUrls.size<4) c.sampleUrls.add(image?.url || image?.objectKey);
      c.sizes.add(`${image?.width||0}x${image?.height||0}:${image?.size||0}`);
      checksumUsage.set(checksum,c);
    }
  }
}
const repeatedJapanImages=[...usage.values()]
  .filter((x)=>x.offerIds.size>1)
  .sort((a,b)=>b.firstCoverIds.size-a.firstCoverIds.size || b.offerIds.size-a.offerIds.size)
  .slice(0,100)
  .map((x)=>({key:x.key,offers:x.offerIds.size,asFirstCover:x.firstCoverIds.size,sourceIds:[...x.sourceIds],sampleUrls:[...x.sampleUrls],sampleOfferIds:[...x.offerIds].slice(0,10)}));
const repeatedJapanChecksums=[...checksumUsage.values()]
  .filter((x)=>x.offerIds.size>1)
  .sort((a,b)=>b.firstCoverIds.size-a.firstCoverIds.size || b.offerIds.size-a.offerIds.size)
  .slice(0,100)
  .map((x)=>({checksum:x.checksum,offers:x.offerIds.size,asFirstCover:x.firstCoverIds.size,sizes:[...x.sizes],sampleUrls:[...x.sampleUrls],sampleOfferIds:[...x.offerIds].slice(0,12)}));

const output={
  checkedAt:new Date().toISOString(),
  activeOffers:offers.length,
  summary,
  unresolvedMakes:[...unresolvedMakes.values()].sort((a,b)=>b.count-a.count).map((x)=>({...x,models:[...x.models],sourceTitles:[...x.sourceTitles],sourceIds:[...x.sourceIds]})),
  unresolvedTitleSamples:unresolved,
  missing30Groups:[...powerGroups.values()].sort((a,b)=>b.count-a.count).slice(0,300).map((x)=>({...x,sourceIds:[...x.sourceIds],peakPowersHp:[...x.peakPowersHp]})),
  repeatedJapanImages,
  repeatedJapanChecksums,
  japanTargetSamples,
  priceOutliers:priceOutliers.sort((a,b)=>b.ratio-a.ratio || b.totalRub-a.totalRub).slice(0,350),
};
console.log(JSON.stringify(output,null,2));
