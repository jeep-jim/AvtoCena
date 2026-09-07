/** Whitelist calculation/identity fields; never export seller contacts or raw payloads. */
export function catalogTrialSnapshot(offer) {
  const fields = ['id', 'sourceId', 'sourceOfferId', 'market', 'offerType', 'status', 'make', 'model', 'trim',
    'year', 'productionDate', 'mileageKm', 'engineCc', 'fuel', 'powertrainKind', 'transmission', 'drive', 'bodyType',
    'powerHp', 'powerKw', 'icePowerKw', 'power30MinKw', 'power30MinKwByMotor', 'powerDataSource', 'powerDataConfidence',
    'sourcePrice', 'sourceCurrency', 'priceMode', 'totalRub', 'calculationStatus', 'calculationSnapshot', 'firstSeenAt', 'updatedAt'];
  return { ...Object.fromEntries(fields.filter(key => offer[key] !== undefined).map(key => [key, offer[key]])),
    images: (offer.images || []).map(image => ({ id: '', url: image.url, objectKey: '', checksum: '', size: 0, mimeType: image.mimeType })),
    operational: Object.fromEntries(['sourceUrl', 'semanticEvidence', 'knowledgeCore', 'photoIdentityVerified', 'galleryVerified', 'gallerySafetyMode']
      .filter(key => offer.operational?.[key] !== undefined).map(key => [key, offer.operational[key]])) };
}
