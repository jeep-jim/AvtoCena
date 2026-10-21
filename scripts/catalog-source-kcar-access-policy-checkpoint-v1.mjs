import fs from 'node:fs/promises';

const REGISTRY_PATH = 'data/catalog/source-qualification-v1.json';
const LEDGER_PATH = 'data/catalog/source-partial-classification-v1.json';
const ROADMAP_PATH = 'roadmap.md';
const SOURCE_ID = 'kcar_korea_open';
const MARKER = '## 40.43 — K Car Korea: official business-partnership route exists; public automation permission is not proven';

const decision = {
  market: 'korea',
  sourceId: SOURCE_ID,
  class: 'research_pending',
  publishAllowed: false,
  useScope: 'do not automate public inventory crawling while automated commercial reuse permission is unproven; prioritize K Car official business-partnership route for a permitted feed/API/data agreement',
  evidence: {
    probeRun: 33867611733,
    artifactId: 9934584165,
    artifactDigest: 'sha256:395ab9f4b88a317624e2c1acd0095c7508babfe8aeb98a267f314d8174c3293d',
    robots: 'https://www.kcar.com/robots.txt returned 200 and explicitly allowed / for the qualification user agent',
    probeHome: 'https://www.kcar.com/ returned 200; the bounded 1.8 MB raw capture was truncated before source-declared footer links, so the Action probe intentionally did not guess a terms route and made no terms/detail/API requests',
    officialPublicVerification: {
      homepage: 'https://www.kcar.com/',
      termsUrl: 'https://www.kcar.com/ci/atcl/ftAtcl',
      partnership: 'current official K Car footer exposes 사업제휴문의(partnership@kcar.com)',
      termsSurface: 'current official terms page is labeled 케이카 약관 및 개인정보 보호, but its crawlable static page shell does not expose enough clause text to prove permission for automated commercial catalog ingestion/reuse',
    },
    boundary: 'GitHub Action used exactly 2 requests: robots + home; zero terms/detail/pagination/API requests; raw bodies not stored',
  },
  permittedRouteCandidate: {
    type: 'official_business_partnership',
    label: '사업제휴문의',
    email: 'partnership@kcar.com',
  },
  blockerBeforeAutomatedUse: 'obtain a K Car partnership/API/feed agreement explicitly covering AvtoCena automated commercial data use, then requalify exact offer fields through that permitted route rather than public scraping',
};

const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8'));
const row = registry.candidates.find((candidate) => candidate.sourceId === SOURCE_ID);
if (!row) throw new Error(`missing ${SOURCE_ID}`);
Object.assign(row, {
  class: 'research_pending',
  publishAllowed: false,
  evidence: 'Run 33867611733 kept the public probe bounded (robots + home only). Current official K Car pages expose the terms surface and 사업제휴문의(partnership@kcar.com), but no positive automated commercial reuse permission is proven. Public crawling stays blocked; official partnership/feed is the preferred permitted route.',
  qualificationDecision: 'data/catalog/source-partial-classification-v1.json#kcar_korea_open',
  useScope: decision.useScope,
  permittedRouteCandidate: 'official_business_partnership_partnership@kcar.com',
  qualificationBlocker: 'public_automation_permission_unproven_use_official_business_partnership_route',
});
registry.updatedAt = '2026-09-04';
registry.next = 'continue non-Japan research_pending qualification permission-first/no-write; Japan remains paused; next inspect DubiCars UAE access policy before any new field crawl; for K Car prefer official business partnership rather than public crawling';
if (registry.productionWrites !== false || registry.candidates.some((candidate) => candidate.publishAllowed === true)) throw new Error('registry safety changed');
const japan = registry.candidates.filter((candidate) => candidate.market === 'japan');
if (!japan.length || japan.some((candidate) => candidate.qualificationPaused !== true)) throw new Error('Japan pause guard missing');
await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);

const ledger = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf8'));
ledger.updatedAt = '2026-09-04';
ledger.evidenceRuns = [...new Set([...(ledger.evidenceRuns || []), 33867611733])].sort((a, b) => a - b);
if (!Array.isArray(ledger.decisions)) ledger.decisions = [];
const index = ledger.decisions.findIndex((candidate) => candidate.sourceId === SOURCE_ID);
if (index >= 0) ledger.decisions[index] = decision; else ledger.decisions.push(decision);
if (ledger.productionWrites !== false || ledger.publishAllowedMutations !== false) throw new Error('ledger safety changed');
await fs.writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);

let roadmap = await fs.readFile(ROADMAP_PATH, 'utf8');
if (!roadmap.includes(MARKER)) {
  roadmap = `${roadmap.replace(/\s*$/, '')}\n\n${MARKER}\n\nДата: 2026-09-04.\n\n- Japan не трогался и остаётся machine-readable paused.\n- K Car проверен только permission-first. Run \`33867611733\` — success, artifact \`9934584165\`, digest \`sha256:395ab9f4b88a317624e2c1acd0095c7508babfe8aeb98a267f314d8174c3293d\`.\n- Action сделал ровно 2 запроса: \`https://www.kcar.com/robots.txt\` и homepage. Robots вернул \`200\` и явный \`Allow: /\`; homepage — \`200\`. Capture был ограничен 1.8 MB и обрезан до footer, поэтому probe не стал угадывать Terms route и не сделал terms/detail/API/pagination запросов.\n- Отдельной ручной проверкой текущей официальной K Car страницы подтвержден source-declared footer link \`이용약관\` -> \`https://www.kcar.com/ci/atcl/ftAtcl\`, а также официальный \`사업제휴문의(partnership@kcar.com)\`.\n- Crawlable static shell страницы Terms подтверждает, что это официальная поверхность K Car terms/privacy, но не отдаёт достаточно clause text, чтобы честно доказать разрешение public automated commercial ingestion/reuse. Отсутствие видимого запрета не считается разрешением.\n- Решение: \`kcar_korea_open\` остаётся \`research_pending\`, \`publishAllowed=false\`. Preferred permitted route — официальный business partnership \`partnership@kcar.com\`; после письменного agreement/API/feed заново квалифицировать identity, price, body, fuel, engineCc, powerHp, mileage, gallery и list/detail parity через разрешённый канал.\n- Production catalog, Object Storage, generation, manifest и cleanup не менялись.\n- Следующий non-Japan source: DubiCars UAE access-policy.\n`;
}
await fs.writeFile(ROADMAP_PATH, roadmap);
console.log(JSON.stringify({ sourceId: SOURCE_ID, class: 'research_pending', publishAllowed: false, permittedRoute: 'official_business_partnership', japanPaused: true, next: 'dubicars_access_policy', productionWrites: false }, null, 2));
