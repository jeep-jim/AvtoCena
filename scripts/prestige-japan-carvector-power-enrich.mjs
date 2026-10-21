import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";

const INPUT = process.env.PRESTIGE_CARVECTOR_INPUT || "prestige-japan-exact-sold-official-power.json";
const OUTPUT = process.env.PRESTIGE_CARVECTOR_OUTPUT || "prestige-japan-exact-sold-carvector-power.json";
const BASE = "https://carvector.com";
const SOURCE_ID = "carvector_japan_stat_open";
const ELECTRIFIED = /(?:\bhybrid\b|plug[ -]?in|phev|electric|\bev\b|e[ -]?power|fuel[ -]?cell|fcev)/i;
const REGULATORY_PREFIXES = new Set(["DBA", "CBA", "ABA", "3BA", "4BA", "5BA", "6BA", "DAA", "ZAA", "LDA"]);
const BODY_SUFFIXES = new Set(["wagon", "touring", "sedan", "hatchback", "sportback", "van", "custom"]);

function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function token(value) { return clean(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, ""); }
function positive(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; }

export function normalizeCarvectorChassis(value) {
  const parts = clean(value).toUpperCase().replace(/[^A-Z0-9-]+/g, "").split("-").filter(Boolean);
  while (parts.length > 1 && REGULATORY_PREFIXES.has(parts[0])) parts.shift();
  const candidate = parts.find((part) => /[A-Z]/.test(part) && /\d/.test(part)) || "";
  return candidate.replace(/[^A-Z0-9]+/g, "");
}

function modelWords(value) {
  return clean(value).toLocaleLowerCase("en-US").split(/[^a-z0-9]+/).filter(Boolean);
}

export function compatibleCarvectorModel(left, right) {
  const a = token(left), b = token(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const trimBody = (value) => modelWords(value).filter((word) => !BODY_SUFFIXES.has(word)).join("");
  const coreA = trimBody(left), coreB = trimBody(right);
  return Boolean(coreA && coreA === coreB);
}

function extractResults(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (value.__typename === "FindOffersAuctionsResult" && Array.isArray(value.offers)) output.push(value);
  for (const child of Object.values(value)) extractResults(child, output);
  return output;
}

export function parseCarvectorStatsHtml(markup) {
  const encoded = String(markup || "").match(/<script\b[^>]*id=["']ng-state["'][^>]*>([\s\S]*?)<\/script>/i)?.[1] || "";
  if (!encoded) return [];
  let state;
  try { state = JSON.parse(encoded); } catch { return []; }
  const rows = extractResults(state).flatMap((result) => result.offers || []);
  return rows.filter((row) => row?.__typename === "OfferAuction" && row?.kind === "AUCTION_STATS").map((row) => ({
    make: clean(row?.make?.title),
    model: clean(row?.model?.title),
    chassis: normalizeCarvectorChassis(row?.chassis?.title),
    modification: clean(row?.modification?.title),
    year: positive(row?.year),
    engineCc: positive(row?.engineVolume),
    powerHp: positive(row?.power),
    finalPriceJpy: positive(row?.finishPrice?.JPY),
    auctionAt: clean(row?.auctionAt),
    sourceUrl: row?.urlPage?.fullUrl ? new URL(row.urlPage.fullUrl, BASE).toString() : "",
  })).filter((row) => row.chassis && row.make && row.model && row.year >= 2010 && row.engineCc >= 400
    && row.powerHp >= 30 && row.powerHp <= 1_500 && row.finalPriceJpy > 0 && row.auctionAt
    && /^https:\/\/carvector\.com\/stat\//.test(row.sourceUrl));
}

function offerElectrified(offer) {
  const kind = clean(offer?.powertrainKind).toLowerCase();
  if (["electric", "series_hybrid", "other_hybrid"].includes(kind)) return true;
  return ELECTRIFIED.test(`${offer?.fuel || ""} ${offer?.model || ""} ${offer?.trim || ""} ${offer?.sourceTitle || ""}`);
}

function evidenceElectrified(row) {
  return ELECTRIFIED.test(`${row?.model || ""} ${row?.modification || ""}`);
}

function engineCompatible(left, right) {
  const a = positive(left), b = positive(right);
  if (!a || !b) return false;
  return Math.abs(a - b) <= Math.max(50, Math.round(a * 0.04));
}

function matchingEvidence(offer, rows) {
  const chassis = normalizeCarvectorChassis(offer?.frameNumber || offer?.operational?.raw?.fields?.Chassis);
  const matches = rows.filter((row) => token(row.make) === token(offer.make)
    && row.chassis === chassis
    && engineCompatible(row.engineCc, offer.engineCc));
  if (!matches.length || matches.some(evidenceElectrified)) return [];
  const sameYear = matches.filter((row) => Number(row.year) === Number(offer.year));
  return sameYear.length ? sameYear : matches;
}

export function enrichPrestigeOfferFromCarvector(offer, evidenceRows) {
  if (!offer || offer.sourceId !== "prestige_japan_auctions_open" || offer.market !== "japan") return { offer, reason: "source" };
  const trustedExistingPower = positive(offer.powerHp) && ["documented", "source_exact"].includes(clean(offer.powerDataConfidence));
  if (trustedExistingPower || offerElectrified(offer)) return { offer, reason: trustedExistingPower ? "already_powered" : "electrified" };
  const rows = matchingEvidence(offer, evidenceRows);
  if (!rows.length) return { offer, reason: "no_safe_exact_match" };
  const powers = [...new Set(rows.map((row) => Math.round(positive(row.powerHp) * 10) / 10).filter(Boolean))];
  if (powers.length !== 1) return { offer, reason: "ambiguous_power" };
  const sourceUrls = [...new Set(rows.map((row) => row.sourceUrl).filter(Boolean))];
  if (!sourceUrls.length) return { offer, reason: "missing_provenance" };
  const powerHp = powers[0];
  const enriched = {
    ...offer,
    powerHp,
    powerKw: Math.round((powerHp / 1.359621617) * 10) / 10,
    powertrainKind: "combustion",
    powerDataConfidence: "source_exact",
    powerDataSource: sourceUrls[0],
    operational: {
      ...(offer.operational || {}),
      raw: {
        ...(offer.operational?.raw || {}),
        carvectorExactChassisPower: true,
        carvectorEvidenceSourceId: SOURCE_ID,
        carvectorEvidenceChassis: normalizeCarvectorChassis(offer.frameNumber || offer?.operational?.raw?.fields?.Chassis),
        carvectorEvidencePowerHp: powerHp,
        carvectorEvidenceRows: rows.length,
        carvectorEvidenceUrls: sourceUrls.slice(0, 10),
        carvectorEvidenceSameYear: rows.some((row) => Number(row.year) === Number(offer.year)),
        carvectorEvidenceModelCompatible: rows.every((row) => compatibleCarvectorModel(row.model, offer.model)),
        carvectorEvidenceCombustionOnly: true,
      },
    },
  };
  return { offer: enriched, reason: "enriched" };
}

function retryable(error) {
  return /fetch failed|socket|timeout|terminated|aborted|ECONN|EAI_AGAIN|HTTP_(?:408|425|429|500|502|503|504)/i.test(String(error?.message || error));
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function fetchEvidence(chassis) {
  const attempts = Math.max(1, Math.min(5, Number(process.env.PRESTIGE_CARVECTOR_ATTEMPTS || 3)));
  const timeoutMs = Math.max(8_000, Number(process.env.PRESTIGE_CARVECTOR_TIMEOUT_MS || 40_000));
  const url = `${BASE}/stat?query=${encodeURIComponent(chassis)}&pageSize=100`;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", "accept-language": "en-US,en;q=0.9", "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36" },
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw new Error(`carvector_http_${response.status}`);
      const body = await response.text();
      const rows = parseCarvectorStatsHtml(body).filter((row) => row.chassis === chassis);
      return { url, rows };
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === attempts) break;
      await sleep(Math.min(12_000, 750 * (2 ** (attempt - 1))));
    }
  }
  throw lastError || new Error("carvector_fetch_failed");
}

async function pool(rows, limit, worker) {
  const output = new Array(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length || 1) }, async () => {
    while (cursor < rows.length) {
      const index = cursor++;
      output[index] = await worker(rows[index], index);
    }
  }));
  return output;
}

async function main() {
  const payload = JSON.parse(await fs.readFile(INPUT, "utf8"));
  const offers = Array.isArray(payload?.offers) ? payload.offers : [];
  const chassis = [...new Set(offers.filter((offer) => !(positive(offer?.powerHp) && ["documented", "source_exact"].includes(clean(offer?.powerDataConfidence))) && !offerElectrified(offer))
    .map((offer) => normalizeCarvectorChassis(offer?.frameNumber || offer?.operational?.raw?.fields?.Chassis)).filter(Boolean))];
  const concurrency = Math.max(1, Math.min(10, Number(process.env.PRESTIGE_CARVECTOR_CONCURRENCY || 6)));
  const fetchErrors = [];
  const pages = await pool(chassis, concurrency, async (code) => {
    try { return await fetchEvidence(code); }
    catch (error) { fetchErrors.push({ chassis: code, error: String(error?.message || error).slice(0, 400) }); return { rows: [] }; }
  });
  const evidence = pages.flatMap((page) => page.rows || []);
  const byChassis = new Map();
  for (const row of evidence) {
    if (!byChassis.has(row.chassis)) byChassis.set(row.chassis, []);
    byChassis.get(row.chassis).push(row);
  }
  const reasons = {};
  const outputOffers = offers.map((offer) => {
    const code = normalizeCarvectorChassis(offer?.frameNumber || offer?.operational?.raw?.fields?.Chassis);
    const result = enrichPrestigeOfferFromCarvector(offer, byChassis.get(code) || []);
    reasons[result.reason] = Number(reasons[result.reason] || 0) + 1;
    return result.offer;
  });
  const report = {
    version: 1,
    mode: "prestige_price_and_gallery_plus_carvector_exact_combustion_power",
    sourceId: SOURCE_ID,
    inputCount: offers.length,
    requestedChassis: chassis.length,
    fetchedChassis: pages.filter((page) => (page.rows || []).length > 0).length,
    evidenceRows: evidence.length,
    enriched: Number(reasons.enriched || 0),
    reasons,
    fetchErrorCount: fetchErrors.length,
    fetchErrors: fetchErrors.slice(0, 100),
    failClosedElectrified: true,
  };
  await fs.writeFile(OUTPUT, JSON.stringify({ ...payload, offers: outputOffers, carvectorPowerEnrichmentReport: report }, null, 2));
  console.log(JSON.stringify({ ...report, output: OUTPUT }, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
