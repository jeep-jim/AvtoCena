import fs from 'node:fs/promises';

const REGISTRY_PATH = 'data/catalog/source-qualification-v1.json';
const LEDGER_PATH = 'data/catalog/source-partial-classification-v1.json';
const ROADMAP_PATH = 'roadmap.md';
const SOURCE_ID = 'autopapa_georgia_open';
const MARKER = '## 40.41 — AutoPapa Georgia: public entry challenges automation; permission remains unproven';

const decision = {
  market: 'georgia',
  sourceId: SOURCE_ID,
  class: 'research_pending',
  publishAllowed: false,
  useScope: 'manual public reference only while automated access/reuse permission remains unproven; do not crawl inventory/detail pages from the challenged public route',
  evidence: {
    probeRun: 33866935666,
    artifactId: 9934322100,
    artifactDigest: 'sha256:8c69679f74afa7b7ad248c630ec89d0d876ad2d6c8f2415a764fe046aaf089a9',
    robots: 'https://autopapa.ge/robots.txt returned 200 text/plain and explicitly allowed / for the qualification user agent',
    entry: 'https://autopapa.ge/ returned HTTP 403 Cloudflare-style Just a moment challenge to the GitHub Actions qualification runner',
    boundary: 'exactly 2 requests: robots + public entry; zero policy/detail/pagination/API requests; raw bodies not stored',
    permissionStatus: 'no readable source-declared policy route and no positive permission for automated commercial ingestion/reuse were proven before the challenge boundary',
  },
  blockerBeforeAutomatedUse: 'identify an explicitly permitted API/partner feed/written authorization or a source-declared public route that is accessible without bypassing the challenge and clearly permits the intended automated commercial use; then requalify fields',
};

const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8'));
const row = registry.candidates.find((candidate) => candidate.sourceId === SOURCE_ID);
if (!row) throw new Error(`missing ${SOURCE_ID}`);
Object.assign(row, {
  class: 'research_pending',
  publishAllowed: false,
  evidence: 'Permission-first run 33866935666: robots.txt explicitly allowed /, but the public AutoPapa entry returned HTTP 403 Just a moment challenge to GitHub Actions before any policy/detail request. No positive automated commercial ingestion/reuse permission is proven.',
  qualificationDecision: 'data/catalog/source-partial-classification-v1.json#autopapa_georgia_open',
  useScope: decision.useScope,
  qualificationBlocker: 'automation_entry_challenged_403_and_permission_unproven',
});
registry.updatedAt = '2026-09-04';
registry.next = 'continue non-Japan research_pending qualification permission-first/no-write; Japan remains paused; next inspect Encar Korea access policy before any new detail crawl; do not retry AutoPapa public automation until a permitted route is identified';
if (registry.productionWrites !== false || registry.candidates.some((candidate) => candidate.publishAllowed === true)) throw new Error('registry safety changed');
const japan = registry.candidates.filter((candidate) => candidate.market === 'japan');
if (!japan.length || japan.some((candidate) => candidate.qualificationPaused !== true)) throw new Error('Japan pause guard missing');
await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);

const ledger = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf8'));
ledger.updatedAt = '2026-09-04';
ledger.evidenceRuns = [...new Set([...(ledger.evidenceRuns || []), 33866935666])].sort((a, b) => a - b);
if (!Array.isArray(ledger.decisions)) ledger.decisions = [];
const index = ledger.decisions.findIndex((candidate) => candidate.sourceId === SOURCE_ID);
if (index >= 0) ledger.decisions[index] = decision; else ledger.decisions.push(decision);
if (ledger.productionWrites !== false || ledger.publishAllowedMutations !== false) throw new Error('ledger safety changed');
await fs.writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);

let roadmap = await fs.readFile(ROADMAP_PATH, 'utf8');
if (!roadmap.includes(MARKER)) {
  roadmap = `${roadmap.replace(/\s*$/, '')}\n\n${MARKER}\n\nДата: 2026-09-04.\n\n- Japan не трогался и остаётся machine-readable paused.\n- После MyAuto без повторных циклов переключились на AutoPapa Georgia.\n- Permission-first run \`33866935666\`: \`https://autopapa.ge/robots.txt\` вернул \`200 text/plain\`, для qualification UA сработал явный \`Allow: /\`.\n- Следующий и последний запрос в этом probe — public entry \`https://autopapa.ge/\`; он вернул \`403\` и title \`Just a moment...\`. До policy/detail/pagination/API запросов probe не дошёл.\n- Artifact \`9934322100\`, digest \`sha256:8c69679f74afa7b7ad248c630ec89d0d876ad2d6c8f2415a764fe046aaf089a9\`. Request envelope: ровно 2 запроса; raw bodies не сохранялись.\n- Robots allowance не трактуется как разрешение на коммерческое автоматизированное использование данных. Поскольку source-declared policy route не удалось даже извлечь до challenge, positive permission не доказан.\n- Решение: \`autopapa_georgia_open\` остаётся \`research_pending\`, \`publishAllowed=false\`, blocker \`automation_entry_challenged_403_and_permission_unproven\`. Не обходить challenge и не запускать detail crawl до явно разрешённого API/partner feed/written authorization либо source-declared accessible route с подходящими условиями.\n- Production catalog, Object Storage, generation, manifest и cleanup не менялись.\n- Следующий non-Japan source: Encar Korea — сначала access-policy.\n`;
}
await fs.writeFile(ROADMAP_PATH, roadmap);
console.log(JSON.stringify({ sourceId: SOURCE_ID, class: 'research_pending', publishAllowed: false, blocker: 'entry_403_permission_unproven', japanPaused: true, next: 'encar_access_policy', productionWrites: false }, null, 2));
