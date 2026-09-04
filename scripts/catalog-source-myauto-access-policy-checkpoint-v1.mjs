import fs from 'node:fs/promises';

const REGISTRY_PATH = 'data/catalog/source-qualification-v1.json';
const LEDGER_PATH = 'data/catalog/source-partial-classification-v1.json';
const ROADMAP_PATH = 'roadmap.md';
const SOURCE_ID = 'myauto_georgia_list';
const MARKER = '## 40.40 — MyAuto Georgia: rules routes challenge automation; permission remains unproven';

const decision = {
  market: 'georgia',
  sourceId: SOURCE_ID,
  class: 'research_pending',
  publishAllowed: false,
  useScope: 'manual public reference only while automated access/reuse permission remains unproven; do not start inventory/detail crawling from the challenged public route',
  evidence: {
    probeRunV1: 33866428112,
    probeArtifactV1: 9934139585,
    probeDigestV1: 'sha256:fd0c546bda1c42feff9c0fe537f20bb50d6ae1e38cbc5f43eb0e3994ed9e6040',
    probeRunV2: 33866663248,
    probeArtifactV2: 9934222620,
    probeDigestV2: 'sha256:4c8c8755e0980e7648ace22195442b65ffd118e2083889eb47cd2971cacd6c80',
    robots: 'robots.txt returned 200 and did not explicitly disallow the tested rules routes for the qualification user agent',
    rulesRoutes: 'official /en/rules, /ka/rules and /ru/rules routes all returned HTTP 403 challenge pages to the GitHub Actions qualification runner; alternate probes were bounded to rules only',
    requestBoundary: 'v1 used exactly 2 requests; v2 used exactly 3 requests; zero detail, pagination or API requests; raw bodies not stored',
    permissionStatus: 'no positive automated commercial ingestion/reuse permission has been proven from an accessible source-declared route',
  },
  blockerBeforeAutomatedUse: 'obtain an explicitly permitted API/partner feed/written authorization or a source-declared rules/data route that can be read without bypassing the challenge and clearly permits the intended automated commercial use; then requalify fields',
};

const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8'));
const row = registry.candidates.find((candidate) => candidate.sourceId === SOURCE_ID);
if (!row) throw new Error(`missing ${SOURCE_ID}`);
Object.assign(row, {
  class: 'research_pending',
  publishAllowed: false,
  evidence: 'Permission-first probes 33866428112 and 33866663248: robots did not disallow the official rules routes, but /en/rules, /ka/rules and /ru/rules all returned 403 challenge pages to GitHub Actions. No positive automated commercial ingestion/reuse permission is proven, so inventory crawling remains blocked.',
  qualificationDecision: 'data/catalog/source-partial-classification-v1.json#myauto_georgia_list',
  useScope: decision.useScope,
  qualificationBlocker: 'automation_access_and_reuse_permission_unproven_rules_routes_challenged',
});
registry.updatedAt = '2026-09-04';
registry.next = 'continue non-Japan research_pending qualification permission-first/no-write; Japan remains paused; next inspect AutoPapa Georgia access policy before any new detail crawl; do not retry MyAuto public automation until a permitted route is identified';
if (registry.productionWrites !== false || registry.candidates.some((candidate) => candidate.publishAllowed === true)) throw new Error('registry safety changed');
const japan = registry.candidates.filter((candidate) => candidate.market === 'japan');
if (!japan.length || japan.some((candidate) => candidate.qualificationPaused !== true)) throw new Error('Japan pause guard missing');
await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);

const ledger = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf8'));
ledger.updatedAt = '2026-09-04';
ledger.evidenceRuns = [...new Set([...(ledger.evidenceRuns || []), 33866428112, 33866663248])].sort((a, b) => a - b);
if (!Array.isArray(ledger.decisions)) ledger.decisions = [];
const index = ledger.decisions.findIndex((candidate) => candidate.sourceId === SOURCE_ID);
if (index >= 0) ledger.decisions[index] = decision; else ledger.decisions.push(decision);
if (ledger.productionWrites !== false || ledger.publishAllowedMutations !== false) throw new Error('ledger safety changed');
await fs.writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);

let roadmap = await fs.readFile(ROADMAP_PATH, 'utf8');
if (!roadmap.includes(MARKER)) {
  roadmap = `${roadmap.replace(/\s*$/, '')}\n\n${MARKER}\n\nДата: 2026-09-04.\n\n- Japan не трогался и остаётся machine-readable paused.\n- По MyAuto Georgia сначала проверен только access-policy, без inventory/detail crawl.\n- Run \`33866428112\`: \`robots.txt=200\`; \`/en/rules\` robots не запрещён, но GitHub Actions получил \`403\` challenge. Artifact \`9934139585\`, digest \`sha256:fd0c546bda1c42feff9c0fe537f20bb50d6ae1e38cbc5f43eb0e3994ed9e6040\`. Ровно 2 запроса, detail/API/pagination = 0.\n- Чтобы не застревать на одной локали, bounded v2 проверил только два уже известные официальные rules routes: \`/ka/rules\` и \`/ru/rules\`. Run \`33866663248\` завершился success; оба маршрута robots-allowed, но оба дали \`403 Just a moment...\`. Artifact \`9934222620\`, digest \`sha256:4c8c8755e0980e7648ace22195442b65ffd118e2083889eb47cd2971cacd6c80\`. Ровно 3 запроса: robots + две rules pages; detail/API/pagination = 0.\n- Это не доказывает запрет MyAuto на данные и не доказывает разрешение. Точный вывод: текущий automation runner не может прочитать official rules без challenge, а positive permission на automated commercial ingestion/reuse не доказан.\n- Решение: \`myauto_georgia_list\` остаётся \`research_pending\`, \`publishAllowed=false\`, с blocker \`automation_access_and_reuse_permission_unproven_rules_routes_challenged\`. Новые MyAuto inventory/detail probes не запускать, пока не найден явно разрешённый API/partner feed/written authorization либо source-declared route, доступный без обхода challenge и разрешающий нужное использование.\n- Production catalog, Object Storage, generation, manifest и cleanup не менялись.\n- Следующий non-Japan source: AutoPapa Georgia, снова начиная с access-policy.\n`;
}
await fs.writeFile(ROADMAP_PATH, roadmap);
console.log(JSON.stringify({ sourceId: SOURCE_ID, class: 'research_pending', publishAllowed: false, blocker: 'permission_unproven', japanPaused: true, next: 'autopapa_access_policy', productionWrites: false }, null, 2));
