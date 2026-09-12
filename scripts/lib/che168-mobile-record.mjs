/** Parse a visible, listing-bound mobile Che168 capture. No network or price calculation. */
export function parseChe168MobileRecord(capture, expectedOfferId) {
  if (capture?.schema !== 'che168-mobile-visible-dom-v1') throw Error('che168_mobile_capture_schema');
  const url = new URL(capture.sourceUrl);
  const id = url.searchParams.get('infoid');
  if (url.protocol !== 'https:' || url.hostname !== 'm.che168.com' || url.pathname !== '/cardetail/index'
    || !/^\d+$/.test(id || '') || id !== String(expectedOfferId) || url.searchParams.getAll('infoid').length !== 1)
    throw Error('che168_mobile_identity_mismatch');
  if (capture.modelTableCount !== 1 || !Array.isArray(capture.rows)
    || capture.rows.some(row => !Array.isArray(row) || row.length !== 2 || row.some(v => typeof v !== 'string')))
    throw Error('che168_mobile_table_unbound');
  const reasons = [];
  const unique = (values, field) => {
    const found = [...new Set(values.map(v => v.trim()).filter(v => v && v !== '-'))];
    if (found.length > 1) { reasons.push(`${field}_conflict`); return undefined; }
    return found[0];
  };
  const value = label => unique(capture.rows.filter(([k]) => k === label).map(([,v]) => v), label);
  const field = label => unique((capture.fields || []).filter(f => f.label === label).flatMap(f => f.values), label);
  const title = value('车型名称');
  if (!title || capture.mainTitle !== title) throw Error('che168_mobile_title_mismatch');
  const cash = unique(capture.cashPriceBoxes || [], 'cash_price');
  const priceMatch = cash?.match(/^(\d+(?:\.\d+)?)万全款价格$/);
  if (!priceMatch) throw Error('che168_mobile_cash_price_unconfirmed');
  const sourcePrice = Math.round(Number(priceMatch[1]) * 10000);
  if (!(sourcePrice > 0)) throw Error('che168_mobile_cash_price_invalid');
  const numeric = label => { const raw = value(label); return raw && /^\d+(?:\.\d+)?$/.test(raw) && Number(raw) > 0 ? Number(raw) : undefined; };
  const engineCc = numeric('排量(mL)'); // Never derive cc from the rounded 排量(L) or title.
  let powerHp = numeric('最大马力(Ps)'), powerKw = numeric('最大功率(kW)');
  if (powerHp && powerKw && Math.abs(powerHp - powerKw * 1.3596216173) > Math.max(2, powerHp * 0.01)) {
    reasons.push('power_units_conflict'); powerHp = undefined; powerKw = undefined;
  }
  const fuelText = value('能源类型');
  const fuel = fuelText === '汽油' ? 'petrol' : fuelText === '柴油' ? 'diesel'
    : /混|增程/.test(fuelText || '') ? 'hybrid' : fuelText === '纯电动' ? 'electric' : undefined;
  const firstRegistrationMonth = field('上牌时间');
  const registrationTable = value('首次上牌时间');
  if (firstRegistrationMonth && registrationTable && !registrationTable.startsWith(firstRegistrationMonth))
    reasons.push('first_registration_conflict');
  // Registration and model launch dates are NOT a manufacturing date.
  const productionDate = value('出厂日期') || value('生产日期');
  const confirmedProductionDate = /^\d{4}-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?$/.test(productionDate || '') ? productionDate : undefined;
  if (!confirmedProductionDate) reasons.push('production_date_unconfirmed');
  if (!engineCc && fuel !== 'electric') reasons.push('engine_cc_missing');
  if (!powerHp && !powerKw) reasons.push('power_missing');
  if (!fuel) reasons.push('fuel_missing');
  if (fuel === 'hybrid' || fuel === 'electric') reasons.push('utilization_power_unconfirmed');
  const mileageText = field('表显里程');
  const mileageMatch = mileageText?.match(/^(\d+(?:\.\d+)?)(万)?公里$/);
  const mileageKm = mileageMatch ? Math.round(Number(mileageMatch[1]) * (mileageMatch[2] ? 10000 : 1)) : undefined;
  const gallery = capture.gallery;
  const galleryTotal = Number(gallery?.label?.match(/^\s*\d+\s*\/\s*(\d+)/)?.[1]);
  const imageUrls = [...new Set(gallery?.urls || [])];
  if (!galleryTotal || !imageUrls.length || imageUrls.length > galleryTotal || imageUrls.some(raw => {
    try { const u = new URL(raw); return u.protocol !== 'https:' || !/(^|\.)autoimg\.cn$/.test(u.hostname) || !u.pathname.startsWith('/escimg/'); }
    catch { return true; }
  })) throw Error('che168_mobile_gallery_unbound');
  return {
    sourceId: 'autohome_used_china_open', sourceOfferId: id, sourceUrl: `https://m.che168.com/cardetail/index?infoid=${id}`,
    title, sourcePrice, sourceCurrency: 'CNY', modelYear: Number(title.match(/((?:19|20)\d{2})款/)?.[1]) || undefined,
    firstRegistrationMonth, productionDate: confirmedProductionDate, mileageKm,
    engineCc, engineCode: value('发动机型号'), powerHp, powerKw, fuel, fuelText,
    grossVehicleWeightKg: numeric('最大满载质量(kg)'),
    imageUrls, galleryTotal, tableRows: capture.rows,
    capturedAt: capture.capturedAt,
    // This evidence parser cannot declare a customs quote ready. The normal publication/audit pipeline must do so.
    calculationStatus: 'needs_data', totalRub: null,
    stopReasons: [...new Set([...reasons, 'publication_calculation_not_run'])],
    raw: capture,
  };
}
