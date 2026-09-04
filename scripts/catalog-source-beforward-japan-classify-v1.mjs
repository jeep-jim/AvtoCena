import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REGISTRY_PATH = process.env.CATALOG_SOURCE_QUALIFICATION_REGISTRY || 'data/catalog/source-qualification-v1.json';
const ROADMAP_PATH = process.env.CATALOG_SOURCE_QUALIFICATION_ROADMAP || 'roadmap.md';
const SOURCE_ID = 'beforward_japan_candidate';
const DOC_PATH = 'docs/catalog-source-beforward-japan-qualification-v1.md';

export const evidenceText = 'Public BE FORWARD stocklist exposes source-bound Ref No., USD price, year/month, mileage, exact engine cc, fuel, transmission and Japan location, but four source-declared detail URLs returned an HTTP 202 JavaScript robot-verification shell twice on the GitHub runner. Body, power, listing-bound gallery and repeatable detail parity cannot be proven through the permitted read-only route; the challenge was not bypassed.';

export const useScope = 'public lead/search evidence only; no automatic full calculation or publication under the current detail-access route';

export const checkpoint40_30 = `

### 40.30. BE FORWARD Japan: публичный stocklist полезен как lead, exact detail закрыт JS robot verification

- **Дата checkpoint:** 2026-09-04. Продолжение Japan source qualification после 40.29; production, Object Storage, current generation и publication registry не менялись.
- **Классификация:** \`beforward_japan_candidate\` → \`lead_only\`, \`publishAllowed=false\`. Источник не rejected, потому что public stocklist реально отдаёт offer-bound \`Ref No.\`, USD price, year/month, mileage, engine cc, fuel, transmission и Japan location. Источник не \`exact_catalog\`, потому что полный repeatable detail contract не доказан разрешённым server-side маршрутом.
- **Fast stocklist probe:** run \`33834601306\` — \`success\`; artifact \`9922848051\`; digest \`sha256:a5a6cbbd8dde9c1941be2fe13a03fd185e0e47bf8c227b486a16d09ed8554676\`. На GitHub runner \`/stocklist\` вернул HTTP \`202\`, \`text/html\`, около \`2004\` bytes — JS verification shell. \`discoveredCandidateCount=0\` поэтому не является доказательством нулевого инвентаря.
- **Fixed detail audit:** run \`33834734630\` — \`success\`; artifact \`9922893163\`; digest \`sha256:b50578ec98544fabe17f10539b11a67e9ee54b20bea34ae0ddc3991a234d4bfe\`. Четыре URL, которые сам BE FORWARD публиковал в stocklist (Nissan March CE621935, Toyota Vitz CE612705, Honda Fit CE612708, Toyota Crown CE621869), запрошены по два раза. Robots policy их не запрещал, но каждый ответ — HTTP \`202\` shell «JavaScript is disabled / verify that you're not a robot»; \`stableReachableCount=0\`, \`exactReadyCount=0\`.
- **Deficits:** detail-side identity/parity, price, year, mileage, engineCc, fuel, body, power и listing-bound gallery не повышаются до exact. List-side значения сохраняются только как lead evidence и не превращаются в рассчитанные/публичные карточки.
- **Full branch contract:** run \`33834395739\` — \`success\`: regression contract, project typecheck, read-only qualification и no-write envelope зелёные. Green CI не ослабляет source gate.
- **Safety:** challenge не обходился; guessed routes/API не использовались; raw HTML не сохранялся; \`productionWrites=false\`, \`objectStorageWrites=false\`, \`catalogGenerationWrites=false\`, \`publishAllowed=false\`.
- **Подробное evidence:** \`${DOC_PATH}\`.
- **Следующий безопасный шаг:** не лечить BE FORWARD обходом защиты. Перейти к \`sbtjapan_japan_candidate\` и проверить его fixed-price inventory/detail тем же read-only contract. К BE FORWARD возвращаться только при разрешённом public/partner detail route.
`;

export function classifyRegistry(registry) {
  if (!registry || !Array.isArray(registry.candidates)) throw new Error('invalid source qualification registry');
  const candidate = registry.candidates.find((row) => row?.sourceId === SOURCE_ID);
  if (!candidate) throw new Error(`${SOURCE_ID} not found`);
  if (candidate.publishAllowed !== false) throw new Error(`${SOURCE_ID} publishAllowed must remain false`);
  if (!['research_pending', 'lead_only'].includes(candidate.class)) throw new Error(`unexpected previous class ${candidate.class}`);

  candidate.class = 'lead_only';
  candidate.publishAllowed = false;
  candidate.evidence = evidenceText;
  candidate.qualificationDecision = DOC_PATH;
  candidate.useScope = useScope;
  registry.updatedAt = '2026-09-04';
  registry.next = 'qualify sbtjapan_japan_candidate next under the same read-only source-bound contract; continue remaining research_pending candidates; no publishAllowed=true until explicit publication gate';
  return registry;
}

export function appendRoadmapCheckpoint(roadmap) {
  const source = String(roadmap || '');
  if (source.includes('### 40.30. BE FORWARD Japan:')) return source;
  if (!source.includes('### 40.29.')) throw new Error('roadmap 40.29 prerequisite missing');
  return `${source.replace(/\s*$/, '')}\n\n${checkpoint40_30.trim()}\n`;
}

export async function applyClassification() {
  const [registryText, roadmapText] = await Promise.all([
    fs.readFile(REGISTRY_PATH, 'utf8'),
    fs.readFile(ROADMAP_PATH, 'utf8'),
  ]);
  const registry = classifyRegistry(JSON.parse(registryText));
  const roadmap = appendRoadmapCheckpoint(roadmapText);
  await fs.writeFile(REGISTRY_PATH, `${JSON.stringify(registry, null, 2)}\n`);
  await fs.writeFile(ROADMAP_PATH, roadmap);
  console.log(JSON.stringify({ sourceId: SOURCE_ID, class: 'lead_only', publishAllowed: false, roadmapSection: '40.30', next: registry.next }, null, 2));
  return { registry, roadmap };
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (entryUrl === import.meta.url) {
  applyClassification().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
