import fs from 'node:fs/promises';

const REGISTRY_PATH = 'data/catalog/source-qualification-v1.json';
const LEDGER_PATH = 'data/catalog/source-partial-classification-v1.json';
const ROADMAP_PATH = 'roadmap.md';
const SOURCE_ID = 'dubicars_uae_exact';
const MARKER = '## 40.44 — DubiCars UAE: public scraping/reuse blocked; contracted automatic-feed option exists';

const decision = {
  market: 'uae',
  sourceId: SOURCE_ID,
  class: 'lead_only',
  publishAllowed: false,
  useScope: 'manual public reference only; no automated public-site extraction, scraping, mass copying or commercial reuse without express written consent. Requalify only through a DubiCars-contracted feed/API/integration whose agreement explicitly covers AvtoCena use.',
  evidence: {
    officialTermsUrl: 'https://www.dubicars.com/copyright.html',
    publicUseRestrictions: [
      'Terms prohibit modifying/copying materials and using them for commercial purpose or public display under the general site material license.',
      'Buyer/seller conduct section prohibits commercial/non-personal exploitation or copying of Website Content without express written consent.',
      'The same section prohibits accessing/downloading/monitoring/copying site information through scraper, robot, spider or other automatic device/process.',
      'No-resale section prohibits reproducing/duplicating/copying/selling/reselling/exploiting the Service for commercial purposes and expressly prohibits data scraping, mass copying and spidering.',
    ],
    dealerContractSignal: 'Dealer Terms define a subscription Service that may, depending on membership package, include link integration with automatic feed from DubiCars website to the dealer website. This is a contractual product signal, not blanket permission to scrape or republish the public site.',
    fieldStatusBeforePolicyDecision: 'prior read-only audit proved stable details on 2/2 and source-bound identity/year/price/body/fuel, while exact engineCc/powerHp and listing-bound gallery>=5 remained incomplete on the audited samples',
  },
  permittedRouteCandidate: {
    type: 'contracted_dealer_feed_or_integration',
    termsSignal: 'link integration with automatic feed from our web site to your web site',
    prerequisite: 'signed DubiCars agreement/package and explicit written scope allowing AvtoCena commercial data use/republication',
  },
  blockerBeforeAutomatedUse: 'obtain express written consent or a contracted DubiCars feed/API/integration explicitly permitting AvtoCena use; then requalify exact engineCc, powerHp, gallery identity and list/detail parity through that permitted route',
};

const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8'));
const row = registry.candidates.find((candidate) => candidate.sourceId === SOURCE_ID);
if (!row) throw new Error(`missing ${SOURCE_ID}`);
Object.assign(row, {
  class: 'lead_only',
  publishAllowed: false,
  evidence: 'Current official DubiCars Terms prohibit public-site commercial reuse, scraping/robots, mass copying and spidering without express consent. Dealer Terms separately advertise a contractual automatic-feed integration as a possible package feature; only such an explicitly permitted agreement/feed can be requalified for AvtoCena.',
  qualificationDecision: 'data/catalog/source-partial-classification-v1.json#dubicars_uae_exact',
  useScope: decision.useScope,
  permittedRouteCandidate: 'contracted_dubicars_automatic_feed_or_api_subject_to_explicit_agreement',
  qualificationBlocker: 'public_scraping_and_commercial_reuse_prohibited_contractual_feed_requires_explicit_scope',
});
registry.updatedAt = '2026-09-04';
registry.next = 'continue non-Japan research_pending qualification permission-first/no-write; Japan remains paused; next inspect AutoMarket UAE access policy before any field crawl; do not automate DubiCars public pages without express written consent';
if (registry.productionWrites !== false || registry.candidates.some((candidate) => candidate.publishAllowed === true)) throw new Error('registry safety changed');
const japan = registry.candidates.filter((candidate) => candidate.market === 'japan');
if (!japan.length || japan.some((candidate) => candidate.qualificationPaused !== true)) throw new Error('Japan pause guard missing');
await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);

const ledger = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf8'));
ledger.updatedAt = '2026-09-04';
if (!Array.isArray(ledger.decisions)) ledger.decisions = [];
const index = ledger.decisions.findIndex((candidate) => candidate.sourceId === SOURCE_ID);
if (index >= 0) ledger.decisions[index] = decision; else ledger.decisions.push(decision);
if (ledger.productionWrites !== false || ledger.publishAllowedMutations !== false) throw new Error('ledger safety changed');
await fs.writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);

let roadmap = await fs.readFile(ROADMAP_PATH, 'utf8');
if (!roadmap.includes(MARKER)) {
  roadmap = `${roadmap.replace(/\s*$/, '')}\n\n${MARKER}\n\nДата: 2026-09-04.\n\n- Japan не трогался и остаётся machine-readable paused.\n- После K Car перешли к следующему non-Japan кандидату — DubiCars UAE — и сначала проверили текущие официальные Terms, без нового listing/detail crawl.\n- Official Terms & Conditions: \`https://www.dubicars.com/copyright.html\`. В public-use условиях прямо запрещено без express written consent использовать Website/Content для commercial/non-personal purpose, копировать/эксплуатировать Content; отдельно запрещены automated access/download/monitor/copy через scraper/robot/spider и аналогичные процессы. Раздел No Resale отдельно запрещает commercial exploitation и data scraping/mass copying/spidering.\n- Поэтому публичный DubiCars route нельзя использовать как автоматический ingestion source для AvtoCena.\n- В тех же Dealer Terms есть важный легальный путь: в составе подписки Service, в зависимости от package, может присутствовать \`link integration with automatic feed from our web site to your web site\`. Это не разрешение на scraping; это потенциальный contractual feed/integration, который надо отдельно согласовать под AvtoCena.\n- Предыдущий read-only field audit остаётся технической историей: stable details на 2/2, identity/year/price/body/fuel доказаны; engineCc/powerHp и listing-bound gallery>=5 на sample оставались незакрыты.\n- Решение: \`dubicars_uae_exact -> lead_only\`, \`publishAllowed=false\`. Requalification только через express written consent либо signed DubiCars feed/API/integration agreement, после чего заново доказать engineCc, powerHp, gallery и list/detail parity на разрешённом маршруте.\n- Production catalog, Object Storage, generation, manifest и cleanup не менялись.\n- Следующий non-Japan source: AutoMarket UAE access-policy.\n`;
}
await fs.writeFile(ROADMAP_PATH, roadmap);
console.log(JSON.stringify({ sourceId: SOURCE_ID, class: 'lead_only', publishAllowed: false, permittedRoute: 'contracted_feed_candidate', japanPaused: true, next: 'automarket_uae_access_policy', productionWrites: false }, null, 2));
