/** A missing factory value must survive until the card's existing server-side
 * saved/management calculation has been attached. Supplied malformed values
 * are not missing, and a known factory value is never replaced by a scenario.
 */
export function missingAjesFilterPower(offer: any) {
  return offer.powerHp === undefined || offer.powerHp === null || offer.powerHp === '' || offer.powerHp === 0;
}

/** Use confirmed staff power for the same Korean listing only after the normal
 * pricing path has revalidated its saved calculation. This is a filter view,
 * never a write to source specifications or certified 30-minute power.
 * Arbitrary previews and unrefreshed previews already present on input fail
 * closed. Other markets retain their existing power evidence rules.
 */
export function ajesPowerFilterView(offer: any, source: any) {
  if (!source || !missingAjesFilterPower(offer) || source.market !== 'korea'
      || source.sourceId !== 'ajes_korea_feed' || !source.sourceOfferId
      || source.id !== `ajes-korea-${source.sourceOfferId}`
      || ['id', 'market', 'sourceId', 'sourceOfferId', 'updatedAt', 'year', 'fuel', 'engineCc', 'sourcePrice', 'sourceCurrency'].some(key => offer[key] !== source[key])) return offer;
  const preview = offer.savedCalculationPreview;
  const parameters = preview?.parameters;
  const rate = preview?.currencyRate;
  if (!preview || preview === source.savedCalculationPreview || !parameters
      || !/^(?:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}|management:[a-f0-9]{64})$/i.test(String(preview.version || ''))
      || Boolean(preview.managementLearned) !== String(preview.version).startsWith('management:')
      || !(Number.isFinite(preview.totalRub) && preview.totalRub > 0)
      || preview.power30Precedent || preview.deliveryCity || parameters.deliveryCity
      || !['petrol', 'diesel'].includes(source.fuel)
      || parameters.fuel !== source.fuel || parameters.powertrainKind !== 'combustion'
      || source.powertrainKind && source.powertrainKind !== 'combustion'
      || parameters.year !== source.year || !(source.engineCc > 0) || parameters.engineCc !== source.engineCc
      || !(source.sourcePrice > 0) || rate?.currency !== source.sourceCurrency || rate?.sourcePrice !== source.sourcePrice) return offer;
  const currentRate = source.calculationSnapshot?.currencyRate;
  if (currentRate?.rateDate && rate.rateDate !== currentRate.rateDate) return offer;
  const hp = parameters.powerHp, kw = parameters.powerKw;
  if (!(typeof hp === 'number' && Number.isFinite(hp) && hp > 0 && hp <= 2500)
      || !(typeof kw === 'number' && Number.isFinite(kw) && Math.abs(kw - hp * 0.73549875) < 0.1)) return offer;
  if (Number(source.powerKw) > 0 && Math.abs(Number(source.powerKw) - kw) > 0.75) return offer;
  for (const key of ['drive', 'transmission', 'bodyType', 'vehicleCategory'] as const) {
    if (source[key] && parameters[key] && source[key] !== parameters[key]) return offer;
  }
  return {...offer, powerHp: hp};
}
