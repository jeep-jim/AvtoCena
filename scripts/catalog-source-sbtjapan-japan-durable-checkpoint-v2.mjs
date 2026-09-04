import fs from 'node:fs/promises';

const LEDGER_PATH = 'data/catalog/source-qualification-v1.json';
const ROADMAP_PATH = 'roadmap.md';
const SOURCE_ID = 'sbtjapan_japan_candidate';
const CHECKPOINT = '### 40.31. SBT Japan: repeatable offer identity/price доказаны, source остаётся lead-only из-за power/gallery deficits';

const evidence = 'Run 33838661415 (artifact 9924186893, digest sha256:deb5411bb3f8e8344c88cc3cf469a3e753dea0830f59ae1fc11ed9394ea650ce) proved 49 source-declared search candidates and 4/4 repeatably reachable sampled detail offers with exact identity/year/price/currency/mileage/engineCc/fuel/body parity. exactReady=0/4 because source-bound power is missing/ambiguous on 4/4; listing-bound gallery>=5 is proven on only 1/4, and the hybrid sample also lacks required certified power.';

const checkpointText = `${CHECKPOINT}\n\n- **Дата checkpoint:** 2026-09-04. Продолжение Japan source qualification после 40.30; production catalog, Object Storage, current generation и publication registry не менялись.\n- **Классификация:** \`sbtjapan_japan_candidate\` → \`lead_only\`, \`publishAllowed=false\`. Источник не rejected: source-declared search HTML реально связывает stock URL и offer fields. Источник не \`exact_catalog\`: финальный exact gate не прошла ни одна из 4 sampled карточек.\n- **Финальный qualification run:** \`33838661415\`, head \`319d1f7faa6c33ced2d9956496cc1d8bc670cf96\` — \`success\`; artifact \`9924186893\`, digest \`sha256:deb5411bb3f8e8344c88cc3cf469a3e753dea0830f59ae1fc11ed9394ea650ce\`. Evidence generated at \`2026-09-04T04:58:40.219Z\`.\n- **Source-declared search contract:** \`https://www.sbtjapan.com/used-cars/search\` вернул HTTP \`200\`, \`4,135,272\` bytes, \`truncated=false\`, challenge=false; v2 обнаружил \`49\` card-bound candidates. Видимый \`Stock Id\` обязан совпадать со stock ID из detail URL внутри того же listing anchor.\n- **Repeatability:** sampled \`4\`; stable reachable \`4/4\`; identity+price stable \`4/4\`; exact ready \`0/4\`; power missing/ambiguous \`4/4\`. Каждая source-declared detail page запрошена дважды без guessed routes и без обхода защиты.\n- **Sample deficits:** AR1829 — power + gallery; AP9798 — power; AQ8386 hybrid — power + certifiedPower + gallery; AR1824 — power + gallery. Listing-bound gallery >=5 доказана только у AP9798 (14 images); остальные sampled offers дали по 1 offer-bound image.\n- **Fail-closed:** \`powerTokens=[]\` на 4/4; fallback/энциклопедия/рыночная догадка не использовались для мощности. \`productionWrites=false\`, \`classificationMutations=false\` во время probe, \`publishAllowedMutations=false\`, \`objectStorageWrites=false\`, \`catalogGenerationWrites=false\`, \`rawBodiesStored=false\`, \`guessedRoutes=false\`, \`sourcePublishAllowed=false\`.\n- **Подробное evidence:** \`docs/catalog-source-sbtjapan-japan-qualification-v2.md\`.\n- **Следующий безопасный шаг:** оставить SBT Japan только как lead/search evidence и продолжить remaining Japan \`research_pending\` candidates по тому же read-only source-bound contract. Любое promotion до \`exact_catalog\` требует отдельного evidence run с source-bound power/certified power и достаточной listing-bound gallery; production promotion остаётся отдельным решением.\n`;

async function main() {
  const ledgerRaw = await fs.readFile(LEDGER_PATH, 'utf8');
  const ledger = JSON.parse(ledgerRaw);
  const candidate = ledger.candidates?.find((row) => row.sourceId === SOURCE_ID);
  if (!candidate) throw new Error(`${SOURCE_ID} missing from source qualification ledger`);
  if (candidate.market !== 'japan') throw new Error(`${SOURCE_ID} market mismatch`);

  candidate.url = 'https://www.sbtjapan.com/used-cars/search';
  candidate.class = 'lead_only';
  candidate.publishAllowed = false;
  candidate.evidence = evidence;
  candidate.qualificationDecision = 'docs/catalog-source-sbtjapan-japan-qualification-v2.md';
  candidate.useScope = 'public lead/search evidence only; no automatic full calculation or publication until source-bound power/certified-power and listing-bound gallery pass the exact gate';
  ledger.updatedAt = '2026-09-04';
  ledger.next = 'continue remaining research_pending source candidates under the same read-only source-bound contract; no publishAllowed=true until explicit publication gate';

  if (candidate.publishAllowed !== false) throw new Error('SBT publishAllowed must remain false');
  await fs.writeFile(LEDGER_PATH, `${JSON.stringify(ledger, null, 2)}\n`);

  let roadmap = await fs.readFile(ROADMAP_PATH, 'utf8');
  if (!roadmap.includes(CHECKPOINT)) {
    roadmap = `${roadmap.trimEnd()}\n\n${checkpointText.trimEnd()}\n`;
    await fs.writeFile(ROADMAP_PATH, roadmap);
  } else if (!roadmap.endsWith('\n')) {
    await fs.writeFile(ROADMAP_PATH, `${roadmap}\n`);
  }

  const reparsed = JSON.parse(await fs.readFile(LEDGER_PATH, 'utf8'));
  const persisted = reparsed.candidates.find((row) => row.sourceId === SOURCE_ID);
  if (persisted?.class !== 'lead_only' || persisted?.publishAllowed !== false) {
    throw new Error('durable SBT classification invariant failed');
  }
  const finalRoadmap = await fs.readFile(ROADMAP_PATH, 'utf8');
  if (!finalRoadmap.includes(CHECKPOINT)) throw new Error('roadmap checkpoint missing');
  if (/\n\n$/.test(finalRoadmap)) throw new Error('roadmap must end with exactly one newline');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
