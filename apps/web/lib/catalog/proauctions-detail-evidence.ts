/** Parse source facts only. Auction price, sale status and exact customs inputs are separate evidence. */
export function proAuctionsText(value: string) {
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&sup3;?/gi, '³').replace(/&#(?:x([a-f0-9]+)|(\d+));/gi, (_, hex, dec) => String.fromCodePoint(parseInt(hex || dec, hex ? 16 : 10)))
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
}
const attributes = (tag: string) => Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(m => [m[1].toLowerCase(), proAuctionsText(m[3])]));
const positive = (s: string | undefined) => {
  if (!s || !/^\d+(?:[.,]\d+)?$/.test(s.replace(/\s/g, ''))) return null;
  const n = Number(s.replace(/\s/g, '').replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null;
};
const classes = (tag: string, name: string) => (attributes(tag).class || '').split(/\s+/).includes(name);
const FUEL_CODES: Record<string, 'gasoline' | 'diesel' | 'electric'> = {b:'gasoline',d:'diesel',be:'gasoline',de:'diesel',e:'electric'};
// Codes verified against /calculator/ select[name=m], archived in fixture + audit artifact.
export function parseProAuctionsDetailEvidence(html: string, expectedUrl: string) {
  const url = /^https:\/\/demo\.pro-auctions\.ru\/statistika\/([^/]+)\/([^/]+)\/(\d+)\.html$/.exec(expectedUrl);
  if (!url) throw Error('proauctions_url_invalid');
  const canonicals = [...html.matchAll(/<link\b[^>]*>/gi)].map(m=>attributes(m[0])).filter(a=>a.rel==='canonical');
  if (canonicals.length !== 1 || canonicals[0].href !== expectedUrl) throw Error('proauctions_detail_identity_mismatch');
  const title = proAuctionsText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '');
  const identity = /^(.+?) (\d{4}) год, Лот ([^,]+), торги от (\d{2})\.(\d{2})\.(\d{4})$/.exec(title);
  if (!identity) throw Error('proauctions_lot_title_missing');
  const table = html.match(/<!--\s*car-info\s*-->([\s\S]*?)<!--\s*end car-info\s*-->/i)?.[1];
  const gallery = html.match(/<!--\s*gallery\s*-->([\s\S]*?)<!--\s*end gallery\s*-->/i)?.[1];
  if (!table || !gallery) throw Error('proauctions_primary_sections_missing');
  const fields: Record<string,string[]> = {};
  for (const m of table.matchAll(/<span\b[^>]*class=["']car-info__label["'][^>]*>([\s\S]*?)<\/span>\s*<span\b[^>]*class=["']car-info__value["'][^>]*>([\s\S]*?)<\/span>/gi)) {
    (fields[proAuctionsText(m[1])] ||= []).push(proAuctionsText(m[2]));
  }
  const field = (name: string) => {
    const values=[...new Set(fields[name] || [])];
    if(values.length>1) throw Error(`proauctions_duplicate_field:${name}`);
    return values[0];
  };
  const forms = [...html.matchAll(/(<form\b[^>]*>)([\s\S]*?)<\/form>/gi)].filter(m=>classes(m[1],'calx-ajax-form'));
  if(forms.length!==1) throw Error('proauctions_calculator_ambiguous');
  const form = forms[0][2]; const inputs:Record<string,string>={};
  for(const m of form.matchAll(/<input\b[^>]*>/gi)) {
    const a=attributes(m[0]);if(!a.name)continue;
    if(a.name in inputs)throw Error(`proauctions_duplicate_input:${a.name}`);
    inputs[a.name]=a.value || '';
  }
  if(inputs.strategy!=='auto_japan' || inputs.car_name!==title || inputs.year!==identity[2] || field('Год')!==identity[2])
    throw Error('proauctions_calculator_identity_mismatch');
  const hero = html.match(/<div\b[^>]*class=["']car-price-hero__src["'][^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>\s*<small[^>]*>Цена в Японии<\/small>/i)?.[1];
  const heroText = proAuctionsText(hero || '');
  const price=positive(inputs.price); const displayPrice=positive(heroText.replace(/[¥円]/g,''));
  if(!price || !Number.isInteger(price) || !/[¥円]/.test(heroText) || price!==displayPrice || !/Стоимость\s+на аукционе\s*:/.test(proAuctionsText(form)))
    throw Error('proauctions_auction_price_conflict');
  const engineCc=positive(field('Объем, см³'));
  if(engineCc!==positive(inputs.v))throw Error('proauctions_displacement_conflict');
  const powerRaw=field('Мощность ДВС') || field('Мощность') || '';
  const hp=positive(powerRaw.match(/(\d+(?:[.,]\d+)?)\s*л\.\s*с\./i)?.[1]);
  const kw=positive(powerRaw.match(/(\d+(?:[.,]\d+)?)\s*кВт/i)?.[1]);
  const issues:string[]=[];
  if(hp && kw && Math.abs(hp-kw/0.73549875)>Math.max(2,hp*.015)) issues.push('power_hp_kw_conflict');
  if(hp && positive(inputs.powerDVS)!==hp)issues.push('power_table_form_conflict');
  const fuel=FUEL_CODES[inputs.m] || null;
  if(!fuel)issues.push('fuel_code_unknown');
  const hybrid = field('Гибрид')==='да' || ['be','de'].includes(inputs.m);
  const electric = field('Электромобиль')==='да' || inputs.m==='e';
  if(electric && hybrid)issues.push('powertrain_conflict');
  if(fuel==='electric' && (positive(inputs.powerDVS) || engineCc))issues.push('electric_combustion_conflict');
  if(!hybrid && !electric && positive(inputs.powerElectro))issues.push('unclassified_electric_motor');
  const images=[...new Set([...gallery.matchAll(/<a\b[^>]*>/gi)].map(m=>attributes(m[0])).filter(a=>a['data-fancybox']==='gallery').map(a=>a.href))];
  const groups=images.map(s=>s?.match(/^https:\/\/jp\d+\.pa-server\.ru(\/auc_auto\/\d{4}_\d{2}_\d{2}\/\d+\/)[^?#]+$/)?.[1]);
  if(images.length<2 || groups.some(g=>!g) || new Set(groups).size!==1)issues.push('gallery_identity_unconfirmed');
  // The sheet belongs to the same auction lot directory, outside the car gallery.
  // Never include the explanatory sample sheets from the adjacent help section.
  const sheetSection=html.match(/<h2\b[^>]*>\s*Аукционный лист\s*<\/h2>\s*<div\b[^>]*class=["']list-img["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
  const auctionSheetUrls=[...new Set([...sheetSection.matchAll(/<img\b[^>]*>/gi)].map(m=>attributes(m[0]).src).filter(src=>{
    const group=src?.match(/^https:\/\/jp\d+\.pa-server\.ru(\/auc_auto\/\d{4}_\d{2}_\d{2}\/\d+\/)[^?#]+$/)?.[1];
    return group && groups.length && groups.every(g=>g===group) && !images.includes(src);
  }))];
  const transmissionRaw=field('Трансмиссия') || null;
  // FAT/IAT describe lever position; they do not establish AT versus CVT.
  const transmission=transmissionRaw==='Автомат' || transmissionRaw==='AT' ? 'automatic'
    : transmissionRaw==='Механика' || transmissionRaw==='MT' ? 'manual' : null;
  const sold=field('Статус') || null;
  return {
    sourceId:url[3],sourceUrl:expectedUrl,sourceFields:fields,calculatorInputs:inputs,
    identity:{name:identity[1],year:Number(identity[2]),lotNumber:identity[3],auctionDate:`${identity[6]}-${identity[5]}-${identity[4]}`,
      auctionName:inputs.auction || null,chassis:field('Номер кузова') || null,trim:field('Комплектация') || null},
    price:{amountJpy:price,kind:'published_auction_amount',displayAmountJpy:displayPrice,
      evidence:['car-price-hero__src','calx-ajax-form input[name=price]','Стоимость на аукционе'],soldStatusRaw:sold,
      saleConfirmed:sold==='продано' || sold==='Продано'},
    specifications:{reportedEngineCc:engineCc,engineCcPrecision:'auction_reported_unverified',fuel,fuelCode:inputs.m,
      powertrain: electric ? 'electric' : hybrid ? 'hybrid' : fuel ? 'combustion' : 'unknown',
      reportedCombustionPowerHp:electric ? null : hp,reportedCombustionPowerKw:electric ? null : kw,
      motorPeakKw:positive(field('Мощность ЭД')?.replace(/\s*кВт/i,'')),
      claimedMotor30MinKw:positive(field('30-мин. мощность ЭД')?.replace(/\s*кВт/i,'')),
      motor30MinCertification:'unverified',calculatorCombinedPowerHp:positive(inputs.p),
      transmission,transmissionRaw,mileageKm:positive(field('Пробег, км')),grade:field('Оценка') || null},
    imageUrls:images,auctionSheetUrls,issues,
    calculationBlockers:[...issues,'exact_engine_displacement_required','production_month_not_confirmed',
      ...(!hp && !electric ? ['combustion_power_missing'] : []),...(hybrid || electric ? ['certified_motor_power_required'] : [])],
  };
}
