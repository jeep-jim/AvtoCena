import fs from 'node:fs/promises';

const REGISTRY_PATH = 'data/catalog/source-qualification-v1.json';
const LEDGER_PATH = 'data/catalog/source-partial-classification-v1.json';
const ROADMAP_PATH = 'roadmap.md';
const SOURCE_ID = 'encar_direct';
const MARKER = '## 40.42 — Encar Korea: official data-partnership path exists; public automation permission is not proven';

const decision = {
  market: 'korea',
  sourceId: SOURCE_ID,
  class: 'research_pending',
  publishAllowed: false,
  useScope: 'do not automate public inventory crawling until permission is explicit; prioritize Encar official price/data partnership route for a permitted feed/API contract',
  evidence: {
    probeRun: 33867243950,
    artifactId: 9934443189,
    artifactDigest: 'sha256:b33301b1a78bd2059b5221afa4228f880ce52ba27250ebb06e29be7baa30a628',
    robots: 'https://fem.encar.com/robots.txt returned 200 and allowed /policy/terms plus /company/contact-us for the qualification user agent',
    terms: 'official terms page returned 200 but the static HTML visible shell contained only 212 characters and did not expose enough terms text to prove or disprove automated commercial reuse permission',
    partnership: 'official Encar Contact Us page returned 200 and explicitly advertises 시세 / 데이터 제휴 (price/data partnership) for used-car price and transaction-data services, with price@encar.com and a dedicated contact number',
    boundary: 'exactly 3 requests: fem robots, official terms, official company contact; zero listing/detail/pagination/API requests; raw bodies not stored',
  },
  permittedRouteCandidate: {
    type: 'official_data_partnership',
    label: '시세 / 데이터 제휴',
    email: 'price@encar.com',
    scopeText: '중고차 시세 및 각종 거래데이터 서비스 제휴',
  },
  blockerBeforeAutomatedUse: 'obtain an Encar data-partnership/API/feed agreement that explicitly covers AvtoCena automated commercial use, then requalify exact offer fields through that permitted route instead of public scraping',
};

const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8'));
const row = registry.candidates.find((candidate) => candidate.sourceId === SOURCE_ID);
if (!row) throw new Error(`missing ${SOURCE_ID}`);
Object.assign(row, {
  class: 'research_pending',
  publishAllowed: false,
  evidence: 'Run 33867243950 proved an official Encar price/data partnership route (시세 / 데이터 제휴; price@encar.com) while the public terms shell did not prove automated commercial reuse permission. Public crawling remains blocked; official partnership/feed is the preferred permitted path.',
  qualificationDecision: 'data/catalog/source-partial-classification-v1.json#encar_direct',
  useScope: decision.useScope,
  permittedRouteCandidate: 'official_price_data_partnership_price@encar.com',
  qualificationBlocker: 'public_automation_permission_unproven_use_official_data_partnership_route',
});
registry.updatedAt = '2026-09-04';
registry.next = 'continue non-Japan research_pending qualification permission-first/no-write; Japan remains paused; next inspect K Car Korea access policy; for Encar prefer official price/data partnership rather than public crawling';
if (registry.productionWrites !== false || registry.candidates.some((candidate) => candidate.publishAllowed === true)) throw new Error('registry safety changed');
const japan = registry.candidates.filter((candidate) => candidate.market === 'japan');
if (!japan.length || japan.some((candidate) => candidate.qualificationPaused !== true)) throw new Error('Japan pause guard missing');
await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);

const ledger = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf8'));
ledger.updatedAt = '2026-09-04';
ledger.evidenceRuns = [...new Set([...(ledger.evidenceRuns || []), 33867243950])].sort((a, b) => a - b);
if (!Array.isArray(ledger.decisions)) ledger.decisions = [];
const index = ledger.decisions.findIndex((candidate) => candidate.sourceId === SOURCE_ID);
if (index >= 0) ledger.decisions[index] = decision; else ledger.decisions.push(decision);
if (ledger.productionWrites !== false || ledger.publishAllowedMutations !== false) throw new Error('ledger safety changed');
await fs.writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);

let roadmap = await fs.readFile(ROADMAP_PATH, 'utf8');
if (!roadmap.includes(MARKER)) {
  roadmap = `${roadmap.replace(/\s*$/, '')}\n\n${MARKER}\n\nДата: 2026-09-04.\n\n- Japan не трогался и остаётся machine-readable paused.\n- Encar проверен строго до listing/detail crawl. Run \`33867243950\` — success, artifact \`9934443189\`, digest \`sha256:b33301b1a78bd2059b5221afa4228f880ce52ba27250ebb06e29be7baa30a628\`.\n- Ровно 3 запроса: \`fem.encar.com/robots.txt\`, официальный \`/policy/terms\`, официальный \`/company/contact-us\`. Listing/detail/pagination/API = 0, raw bodies не сохранялись.\n- \`robots.txt\` вернул 200 и разрешил оба проверяемых official pages. Terms page тоже 200, но статический HTML — в основном shell (видимый текст всего 212 символов), поэтому из него нельзя честно вывести разрешение или запрет automated commercial reuse. Отсутствие запрета в этом shell не считается разрешением.\n- Ключевой результат — официальный Encar Contact Us прямо содержит \`시세 / 데이터 제휴\`: партнёрство по ценам/данным для сервиса цен на б/у авто и различных transaction-data services; указан отдельный контакт \`price@encar.com\`. Это реальный permitted-route candidate, а не догадка.\n- Решение: \`encar_direct\` остаётся \`research_pending\`, \`publishAllowed=false\`. Public scraping не начинать; правильный путь — официальный data-partnership/API/feed agreement. После получения доступа повторно квалифицировать exact offer identity, price, body, fuel, engineCc, powerHp, mileage, gallery и list/detail parity через разрешённый канал.\n- Production catalog, Object Storage, generation, manifest и cleanup не менялись.\n- Следующий non-Japan source: K Car Korea access-policy.\n`;
}
await fs.writeFile(ROADMAP_PATH, roadmap);
console.log(JSON.stringify({ sourceId: SOURCE_ID, class: 'research_pending', publishAllowed: false, permittedRoute: 'official_data_partnership', japanPaused: true, next: 'kcar_access_policy', productionWrites: false }, null, 2));
