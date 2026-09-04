import fs from 'node:fs/promises';

const REGISTRY_PATH = 'data/catalog/source-qualification-v1.json';
const DECISIONS_PATH = 'data/catalog/source-partial-classification-v1.json';
const ROADMAP_PATH = 'roadmap.md';
const SOURCE_ID = 'worldauto_georgia_candidate';
const RUN_IDS = [
  33854811320,
  33855034005,
  33855980435,
  33856160338,
  33856330429,
  33856502011,
  33856667630,
];

const WORLD_AUTO_DECISION = {
  market: 'georgia',
  sourceId: SOURCE_ID,
  class: 'lead_only',
  publishAllowed: false,
  useScope: 'manual public reference/link-out only; no automated or commercial catalog reuse/republication unless WorldAuto grants an explicitly permitted API/partner feed or written authorization',
  evidence: {
    accessRuns: RUN_IDS,
    robots: 'observed public source and backend robots allow the exact bounded routes probed',
    sourceDeclaredTransport: 'frontend bundle declares GET /search/sell/car/get and baseUrl https://worldauto-backend-production.up.railway.app',
    offerFields: 'bounded first public result proves offer-bound id, 10 images, make/model, year, price, engine/fuel, engineVolume, power, transmission and drive',
    priceCurrency: 'official WorldAuto UI labels sale prices in dollars and shows the same Toyota Land Cruiser Prado 2021 sample at 45000$',
    rightsBlocker: 'official WorldAuto public pages state that page content including images, vehicle descriptions and details is property of worldauto.ge and may not be reused for profit by persons other than the seller; a link is required when using materials',
  },
  blockerBeforeAutomatedUse: 'obtain an explicitly permitted API/partner feed or written authorization covering commercial data reuse/republication, then requalify only from that permitted route',
};

const ROADMAP_MARKER = '## 40.31 — WorldAuto Georgia: technical field contract proven, commercial reuse blocked; Japan paused';
const ROADMAP_APPEND = `\n\n${ROADMAP_MARKER}\n\nДата: 2026-09-04.\n\nВетка исследования: \`chore/worldauto-detail-route-probe-v1-20260904\`. Production/publication writes не выполнялись.\n\nЧто подтверждено по WorldAuto Georgia:\n\n- permission-first/no-write цепочка завершена успешными runs: ${RUN_IDS.map((id) => `\`${id}\``).join(', ')};\n- frontend самого WorldAuto объявляет \`GET /search/sell/car/get\` и backend base URL \`https://worldauto-backend-production.up.railway.app\`; скрытые endpoint'ы не угадывались;\n- один bounded no-param GET к source-declared search endpoint вернул \`200 application/json\`; пагинация и detail crawl не запускались;\n- из первого сбалансированного offer-object доказаны id, 10 фото, Toyota Land Cruiser Prado, 2021, price 45000, Diesel, 2.8, 204, Automatic, AWD, mileage 0, Batumi;\n- официальный UI WorldAuto показывает тот же образец как \`45000$\` и маркирует цены продажи в долларах;\n- технически источник близок к exact contract, но это **не даёт права публикации**.\n\nРешающая причина остановки WorldAuto:\n\n- официальный public footer WorldAuto указывает, что content страницы, включая images, vehicle descriptions/details, является собственностью \`worldauto.ge\`; коммерческое reuse лицами, отличными от seller, запрещено, при использовании материалов требуется ссылка;\n- поэтому для коммерческого каталога AvtoCena WorldAuto переводится в \`lead_only\`, \`publishAllowed=false\`; автоматический reuse/republication прекращён;\n- все одноразовые WorldAuto qualification workflows после снятия доказательств удалены, чтобы обычные push не запускали новые запросы;\n- повторно открывать автоматизацию WorldAuto можно только после явно разрешённого API/partner feed либо письменного разрешения на commercial data reuse/republication.\n\n### Japan — пауза по указанию владельца\n\nЯпония сейчас **не входит в активную очередь qualification**. Старые Japan ledger entries остаются только историей исследования. Экспериментальные Japan branches не вливать в активный source path и новые Japan probes не запускать. Возвращаться к Японии только после нахождения кандидата, который реально отдаёт уже завершённые/отыгранные аукционные лоты под требуемый exact contract, и после явного возобновления рынка владельцем. На текущем подтверждённом состоянии такого источника в проекте нет; fixed-price/export-stock SBT/TCV/BE FORWARD не доказывают completed-auction coverage.\n\n### Следующее действие после 40.31\n\nПродолжать только non-Japan \`research_pending\` источники, строго permission-first/no-write. Приоритет — кандидат, который по уже собранным данным ближе всего к exact contract; не расширять WorldAuto и не возвращаться к Japan до снятия указанных блокеров.\n`;

function assertNoPublishing(registry) {
  const offenders = registry.candidates?.filter((row) => row.publishAllowed === true) || [];
  if (offenders.length) {
    throw new Error(`unexpected publishAllowed=true: ${offenders.map((row) => row.sourceId).join(',')}`);
  }
  if (registry.productionWrites !== false) throw new Error('productionWrites must remain false');
}

async function updateRegistry() {
  const registry = JSON.parse(await fs.readFile(REGISTRY_PATH, 'utf8'));
  const row = registry.candidates?.find((candidate) => candidate.sourceId === SOURCE_ID);
  if (!row) throw new Error(`missing registry source ${SOURCE_ID}`);
  Object.assign(row, {
    class: 'lead_only',
    publishAllowed: false,
    evidence: 'Technical offer-bound core fields are strong on the source-declared search API, but official WorldAuto public pages prohibit non-seller commercial reuse of page content; automated AvtoCena publication is blocked.',
    qualificationDecision: 'data/catalog/source-partial-classification-v1.json#worldauto_georgia_candidate',
    useScope: WORLD_AUTO_DECISION.useScope,
  });
  registry.updatedAt = '2026-09-04';
  registry.next = 'continue non-Japan research_pending qualification with source-permission-first no-write probes; Japan is paused by owner direction; do not revisit WorldAuto automation without an explicitly permitted data route';
  assertNoPublishing(registry);
  await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
}

async function updateDecisions() {
  const ledger = JSON.parse(await fs.readFile(DECISIONS_PATH, 'utf8'));
  ledger.updatedAt = '2026-09-04';
  ledger.evidenceRuns = [...new Set([...(ledger.evidenceRuns || []), ...RUN_IDS])].sort((a, b) => a - b);
  const index = ledger.decisions?.findIndex((row) => row.sourceId === SOURCE_ID) ?? -1;
  if (!Array.isArray(ledger.decisions)) ledger.decisions = [];
  if (index >= 0) ledger.decisions[index] = WORLD_AUTO_DECISION;
  else ledger.decisions.push(WORLD_AUTO_DECISION);
  if (ledger.productionWrites === true || ledger.publishAllowedMutations === true) throw new Error('decision ledger safety flags changed');
  await fs.writeFile(DECISIONS_PATH, `${JSON.stringify(ledger, null, 2)}\n`);
}

async function updateRoadmap() {
  let roadmap = await fs.readFile(ROADMAP_PATH, 'utf8');
  if (!roadmap.includes(ROADMAP_MARKER)) {
    roadmap = `${roadmap.replace(/\s*$/, '')}${ROADMAP_APPEND}\n`;
    await fs.writeFile(ROADMAP_PATH, roadmap);
  }
}

await updateRegistry();
await updateDecisions();
await updateRoadmap();

console.log(JSON.stringify({
  sourceId: SOURCE_ID,
  class: 'lead_only',
  publishAllowed: false,
  japanPaused: true,
  evidenceRuns: RUN_IDS,
  productionWrites: false,
}, null, 2));
