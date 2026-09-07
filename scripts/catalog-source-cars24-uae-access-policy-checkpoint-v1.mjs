import fs from 'node:fs/promises';

const REGISTRY_PATH = 'data/catalog/source-qualification-v1.json';
const LEDGER_PATH = 'data/catalog/source-partial-classification-v1.json';
const ROADMAP_PATH = 'roadmap.md';
const SOURCE_ID = 'cars24_uae_candidate';
const MARKER = '## 40.38 — CARS24 UAE: current Terms explicitly block scraping and commercial reuse';

const decision = {
  market: 'uae',
  sourceId: SOURCE_ID,
  class: 'lead_only',
  publishAllowed: false,
  useScope: 'manual public reference only; no automated public-site extraction, scraping, listing/pricing reuse or republication without prior written CARS24 authorization or an explicitly permitted data feed/API',
  evidence: {
    officialTermsUrl: 'https://www.cars24.ae/terms-of-use/',
    termsUpdated: '2026-05-21',
    accountPolicy: 'current official Terms state users shall not copy, reproduce, distribute, modify, mirror, scrape, exploit, republish, license or commercially use vehicle listings, pricing data or other Website/Services content without prior written authorization, and shall not use bots/crawlers/spiders/scrapers/automated tools without authorization',
    prohibitedConduct: 'current Terms separately prohibit scraping data and use of bots without authorization',
    fieldStatusBeforePolicyCheck: 'previous read-only field audit proved offer-local make/model/year/body/fuel and 15 listing-id-bound images on sampled details; visible AED price was not yet bound to the offer object, engine displacement was unitless and powerHp missing',
  },
  blockerBeforeAutomatedUse: 'obtain prior written authorization or an explicitly permitted CARS24 API/feed covering AvtoCena automated commercial use; then requalify price binding, engine units and power on that permitted route',
};

const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8'));
const row = registry.candidates.find((candidate) => candidate.sourceId === SOURCE_ID);
if (!row) throw new Error(`missing ${SOURCE_ID}`);
Object.assign(row, {
  class: 'lead_only',
  publishAllowed: false,
  evidence: 'Current official CARS24 UAE Terms explicitly prohibit scraping/automated tools and commercial reuse/republication of listings, pricing data and site content without prior written authorization.',
  qualificationDecision: 'data/catalog/source-partial-classification-v1.json#cars24_uae_candidate',
  useScope: decision.useScope,
});
registry.updatedAt = '2026-09-04';
registry.next = 'continue non-Japan research_pending qualification permission-first/no-write; Japan remains paused; do not automate CARS24 UAE without prior written authorization or an explicitly permitted data route';
if (registry.productionWrites !== false || registry.candidates.some((candidate) => candidate.publishAllowed === true)) throw new Error('registry safety changed');
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
  roadmap = `${roadmap.replace(/\s*$/, '')}\n\n${MARKER}\n\nДата: 2026-09-04.\n\n- После Bobaedream продолжена только non-Japan permission-first qualification.\n- По CARS24 UAE новый crawl не запускался: сначала проверены актуальные официальные Terms of Use, обновлённые 21.05.2026.\n- Terms прямо запрещают без prior written authorization копировать, воспроизводить, распространять, mirror/scrape/exploit/republish/license/commercially use vehicle listings, pricing data и другой Website content; также отдельно запрещены bots/crawlers/spiders/scrapers/automated tools без authorization.\n- Поэтому public-site automated ingestion для AvtoCena остановлен до разрешённого data route.\n- Решение: \`cars24_uae_candidate -> lead_only\`, \`publishAllowed=false\`.\n- Предыдущий field audit остаётся полезным только как историческая техническая evidence: offer-local identity/year/body/fuel и 15 listing-id-bound images были видны, но price binding, engine units и power оставались незакрыты.\n- Requalification — только через prior written authorization либо явно разрешённый API/feed; затем заново доказать price, engine units, power и list/detail parity.\n- Japan по-прежнему paused machine-readable; production/Object Storage/generation/manifest/cleanup не менялись.\n`;
}
await fs.writeFile(ROADMAP_PATH, roadmap);
console.log(JSON.stringify({ sourceId: SOURCE_ID, class: 'lead_only', publishAllowed: false, japanPaused: true, productionWrites: false }, null, 2));
