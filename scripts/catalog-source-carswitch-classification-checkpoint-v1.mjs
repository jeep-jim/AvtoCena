import fs from 'node:fs/promises';

const REGISTRY_PATH = 'data/catalog/source-qualification-v1.json';
const LEDGER_PATH = 'data/catalog/source-partial-classification-v1.json';
const ROADMAP_PATH = 'roadmap.md';
const SOURCE_ID = 'carswitch_uae_candidate';
const MARKER = '## 40.39 — CarSwitch UAE: listing contract is strong, but offer-bound power is absent';

const decision = {
  market: 'uae',
  sourceId: SOURCE_ID,
  class: 'lead_only',
  publishAllowed: false,
  useScope: 'public reference/search support only; do not publish a fully calculated AvtoCena card from CarSwitch alone because exact source-bound offer power is not proven',
  evidence: {
    priorFieldAuditRun: 33731051049,
    liveDetailRecoveryRun: 33865783957,
    liveDetailRecoveryArtifact: 9933926874,
    liveDetailRecoveryDigest: 'sha256:43d5a97a9d9c905ecf5f014af56edd0c0708590897ce8f8d3917dafce402d6e3',
    sameOfferPowerScanRun: 33866026252,
    sameOfferPowerScanArtifact: 9934001368,
    sameOfferPowerScanDigest: 'sha256:c5fcf1aef30ef1774e2920fa0a99ce2387977d783dbc7ee6ad5de11dd5d82c09',
    routeProvenance: 'live detail URL was selected only from the exact detail_pages.xml sitemap declared by current CarSwitch robots.txt; no guessed API/detail routes',
    sample: {
      sourceUrl: 'https://carswitch.com/dubai/used-car/peugeot/3008/2024/661285',
      identity: 'Peugeot 3008 ACTIVE 2024 listing 661285',
      priceCurrency: 'AED 64,900',
      mileage: '16,428 km',
      bodyType: 'SUV',
      fuel: 'Petrol',
      engineDisplacement: '1.6 in listing-bound JSON-LD and 1.6L in the same public detail presentation',
      drive: '2WD',
      transmission: 'Automatic',
      gallery: '10 listing-bound JSON-LD images',
      vinLikeIdentity: 'BUYFROMCS00661285',
    },
    powerGap: 'the listing-bound Car/Product JSON-LD has no power field; five ~24 KB contexts around listing id 661285 each contain zero power keys and zero numeric HP/BHP/PS/kW values; visible listing detail also contains zero numeric power values. Generic power mentions elsewhere in the multi-megabyte page belong unrelated editorial/new-car content and are not offer-bound.',
    previousSamples: 'earlier read-only audit also found source-bound price/body/fuel/gallery on sampled details but no source-bound powerHp',
  },
  blockerBeforeExactCatalog: 'prove exact power from the same offer/listing through a source-declared permitted CarSwitch route; do not infer power from generic model pages, editorial specs or external knowledge',
};

const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8'));
const row = registry.candidates.find((candidate) => candidate.sourceId === SOURCE_ID);
if (!row) throw new Error(`missing ${SOURCE_ID}`);
Object.assign(row, {
  class: 'lead_only',
  publishAllowed: false,
  evidence: 'Runs 33865783957 and 33866026252 prove a strong source-bound CarSwitch detail contract (identity/year/AED price/body/fuel/1.6L engine/drive/transmission/10 images), but the same offer has no source-bound power field; unrelated generic HP mentions elsewhere on the page cannot satisfy the exact-card contract.',
  qualificationDecision: 'data/catalog/source-partial-classification-v1.json#carswitch_uae_candidate',
  useScope: decision.useScope,
});
registry.updatedAt = '2026-09-04';
registry.next = 'continue non-Japan research_pending qualification permission-first/no-write; Japan remains paused; next inspect MyAuto Georgia access policy before any new detail crawl; do not promote CarSwitch unless same-offer power becomes source-bound';
if (registry.productionWrites !== false || registry.candidates.some((candidate) => candidate.publishAllowed === true)) throw new Error('registry safety changed');
const japan = registry.candidates.filter((candidate) => candidate.market === 'japan');
if (!japan.length || japan.some((candidate) => candidate.qualificationPaused !== true)) throw new Error('Japan pause guard missing');
await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);

const ledger = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf8'));
ledger.updatedAt = '2026-09-04';
ledger.evidenceRuns = [...new Set([...(ledger.evidenceRuns || []), 33865783957, 33866026252])].sort((a, b) => a - b);
if (!Array.isArray(ledger.decisions)) ledger.decisions = [];
const index = ledger.decisions.findIndex((candidate) => candidate.sourceId === SOURCE_ID);
if (index >= 0) ledger.decisions[index] = decision; else ledger.decisions.push(decision);
if (ledger.productionWrites !== false || ledger.publishAllowedMutations !== false) throw new Error('ledger safety changed');
await fs.writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);

let roadmap = await fs.readFile(ROADMAP_PATH, 'utf8');
if (!roadmap.includes(MARKER)) {
  roadmap = `${roadmap.replace(/\s*$/, '')}\n\n${MARKER}\n\nДата: 2026-09-04.\n\n- Japan не трогался: machine-readable pause остаётся на всех Japan candidates.\n- CarSwitch проверен не через догадки маршрутов, а через текущий \`robots.txt\` и объявленный им \`/sitemap/detail_pages.xml\`. В sitemap найдено 4770 detail URL; после одного stale 404 второй source-declared URL оказался живым.\n- Успешный live-detail run: \`33865783957\`, artifact \`9933926874\`, digest \`sha256:43d5a97a9d9c905ecf5f014af56edd0c0708590897ce8f8d3917dafce402d6e3\`. Образец: Peugeot 3008 ACTIVE 2024, listing \`661285\`, AED 64,900, 16,428 km.\n- Listing-bound JSON-LD на этом detail содержит: make/model/year, \`bodyType=SUV\`, \`fuelType=Petrol\`, \`engineDisplacement=1.6\`, \`driveWheelConfiguration=2WD\`, \`vehicleTransmission=Automatic\`, mileage, listing VIN-like identity, AED offer price и 10 изображений. В публичной карточке тот же двигатель подписан как 1.6L.\n- Чтобы не спутать общий SEO/editorial content с полями конкретной машины, выполнен отдельный same-offer scan: run \`33866026252\`, artifact \`9934001368\`, digest \`sha256:c5fcf1aef30ef1774e2920fa0a99ce2387977d783dbc7ee6ad5de11dd5d82c09\`.\n- Результат power scan: в listing-bound Car/Product JSON-LD нет поля мощности; в пяти контекстах примерно по 24 KB вокруг id \`661285\` — \`0\` power keys и \`0\` числовых HP/BHP/PS/kW; в visible detail — также \`0\` числовых power values. В полном captured HTML есть generic HP/BHP упоминания, но это статьи/новые модели и другие машины, не текущий offer, поэтому использовать их нельзя.\n- Предыдущий audit \`33731051049\` уже показывал ту же системную проблему: хорошие identity/price/body/fuel/gallery, но нет source-bound powerHp.\n- Решение: \`carswitch_uae_candidate -> lead_only\`, \`publishAllowed=false\`. CarSwitch нельзя использовать как самостоятельный exact source для полного расчёта, пока мощность не появится на том же offer/listing в разрешённом source-declared route. Model-page/external power inference запрещён.\n- Safety: production catalog, Object Storage, generation, manifest и cleanup не менялись.\n- Следующий non-Japan шаг: MyAuto Georgia — сначала access-policy, только потом detail/field probe.\n`;
}
await fs.writeFile(ROADMAP_PATH, roadmap);

console.log(JSON.stringify({ sourceId: SOURCE_ID, class: 'lead_only', publishAllowed: false, japanPaused: true, next: 'myauto_access_policy', productionWrites: false }, null, 2));
