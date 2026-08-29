import fs from "node:fs/promises";
import {
  jpaucCheckboxValues,
  jpaucListingTotal,
  jpaucPhotoVariants,
  parseJpaucListingRows,
} from "../apps/web/lib/catalog/jpauc-past-source.ts";
import { compatibleCarvectorModel, normalizeCarvectorChassis } from "./prestige-japan-carvector-power-enrich.mjs";
import { toJapanAuctionDate } from "./lib/japan-auction-date.mjs";
import { extractCarvectorOffersFromNgState } from "./lib/carvector-ng-state.mjs";

const CARVECTOR = "https://carvector.com";
const JPAUC = "https://jpauc.com";
const PAST = `${JPAUC}/auction/past`;
const SOURCE_ID = "jpauc_japan_past_open";
const EVIDENCE_SOURCE_ID = "carvector_japan_stat_open";
const exactDate = String(process.env.JAPAN_EXACT_DATE || "").trim();
const month = String(process.env.JAPAN_EXACT_MONTH || exactDate.slice(0, 7)).trim();
const recentLimit = Math.max(0, Math.min(100_000, Number(process.env.JAPAN_EXACT_RECENT_LIMIT || 0)));
const startOffset = Math.max(0, Math.floor(Number(process.env.JAPAN_EXACT_START_OFFSET || 0)));
const scope = String(process.env.JAPAN_EXACT_SCOPE || (recentLimit ? `recent-${startOffset}-${startOffset + recentLimit}` : (exactDate || month))).trim();
const output = process.env.JAPAN_EXACT_CHUNK_OUTPUT || `japan-exact-${month}.json`;
const carvectorInput = String(process.env.JAPAN_EXACT_CARVECTOR_INPUT || "").trim();
const minYear = Math.max(2010, Number(process.env.JAPAN_EXACT_MIN_YEAR || 2010));
const concurrency = Math.max(1, Math.min(16, Number(process.env.JAPAN_EXACT_JPAUC_CONCURRENCY || 8)));
const requestTimeoutMs = Math.max(10_000, Number(process.env.JAPAN_EXACT_REQUEST_TIMEOUT_MS || 45_000));
const maxFallbackPages = Math.max(0, Number(process.env.JAPAN_EXACT_MAX_FALLBACK_PAGES || 500));
const maxDates = Math.max(0, Number(process.env.JAPAN_EXACT_MAX_DATES || 0));
const maxGroupsPerDate = Math.max(0, Number(process.env.JAPAN_EXACT_MAX_GROUPS_PER_DATE || 0));
const carvectorOnly = process.env.JAPAN_EXACT_CARVECTOR_ONLY === "1";
const carvectorTransport = String(process.env.JAPAN_EXACT_CARVECTOR_TRANSPORT || "graphql").trim().toLowerCase();
const carvectorMaxPages = Math.max(0, Number(process.env.JAPAN_EXACT_CARVECTOR_MAX_PAGES || 0));
const carvectorConcurrency = Math.max(1, Math.min(4, Number(process.env.JAPAN_EXACT_CARVECTOR_CONCURRENCY || 2)));
const carvectorPageDelayMs = Math.max(0, Number(process.env.JAPAN_EXACT_CARVECTOR_PAGE_DELAY_MS || 750));
const carvectorPageSize = Math.max(1, Math.min(100, Number(process.env.JAPAN_EXACT_CARVECTOR_PAGE_SIZE || 100)));
const carvectorServerMinPrice = Math.max(0, Number(process.env.JAPAN_EXACT_CARVECTOR_SERVER_MIN_PRICE || 0));
const carvectorServerMinEngineCc = Math.max(0, Number(process.env.JAPAN_EXACT_CARVECTOR_SERVER_MIN_ENGINE_CC || 0));
const ELECTRIFIED = /(?:\bhybrid\b|plug[ -]?in|phev|electric|\bev\b|e[ -]?power|fuel[ -]?cell|fcev|ハイブリッド|電気)/i;

if (!recentLimit && !/^20\d{2}-(?:0[1-9]|1[0-2])$/.test(month)) throw new Error(`invalid_japan_exact_month:${month}`);
if (exactDate && !new RegExp(`^${month}-\\d{2}$`).test(exactDate)) throw new Error(`invalid_japan_exact_date:${exactDate}`);

const browserHeaders = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ja;q=0.8",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

function clean(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }
function token(value) { return clean(value).toLocaleLowerCase("en-US").replace(/[^a-z0-9]+/g, ""); }
function dateOnly(value) { return clean(value).match(/20\d{2}-\d{2}-\d{2}/)?.[0] || ""; }
function positive(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : 0; }
function remoteImage(url) { return { id: "", url, objectKey: "", checksum: "", size: 0, mimeType: "image/jpeg" }; }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function retryable(error) { return /fetch failed|socket|timeout|terminated|aborted|ECONN|EAI_AGAIN|http_(?:408|425|429|500|502|503|504)/i.test(String(error?.message || error)); }
function baseKey(row) { return [dateOnly(row.date || row.auctionAt), clean(row.lot || row.lotNumber), token(row.make || row.maker), Number(row.year || 0)].join("|"); }
function engineCompatible(left, right) {
  const a = positive(left), b = positive(right);
  return a > 0 && b > 0 && Math.abs(a - b) <= Math.max(50, Math.round(a * 0.04));
}
function soldStatus(value) {
  const status = clean(value).toLowerCase();
  return /sold|продан|落札/.test(status) && !/unsold|not sold|не продан|流札/.test(status);
}
function venueCore(value) {
  let result = clean(value).toLowerCase()
    .replace(/nyusatsu|tender|auction|auctions|会場|入札/gi, " ")
    .replace(/aux\s*mobility/gi, "aucnet")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const ignored = new Set(["japan", "auto", "car"]);
  result = result.split(/\s+/).filter((part) => part && !ignored.has(part)).join(" ");
  return result;
}
function venueCompatible(left, right) {
  const a = venueCore(left), b = venueCore(right);
  if (!a || !b) return false;
  if (a === b || a.includes(b) || b.includes(a)) return true;
  const aa = new Set(a.split(" ")), bb = new Set(b.split(" "));
  const shared = [...aa].filter((part) => part.length >= 3 && bb.has(part));
  return shared.length > 0;
}
function selectOptions(markup, id) {
  const content = String(markup || "").match(new RegExp(`<select\\b[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/select>`, "i"))?.[1] || "";
  return [...content.matchAll(/<option\b[^>]*value=["']?([^"' >]+)["']?[^>]*>([\s\S]*?)<\/option>/gi)]
    .map((match) => ({ value: clean(match[1]), label: clean(match[2].replace(/<[^>]+>/g, " ")) }))
    .filter((option) => option.value && option.label);
}

async function fetchWithRetry(url, options = {}, attempts = 7) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { ...options, redirect: "follow", signal: AbortSignal.timeout(requestTimeoutMs) });
      if (!response.ok) {
        const errorBody = clean((await response.text()).slice(0, 1_000));
        throw new Error(`http_${response.status}:${response.url}:${errorBody}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (!retryable(error) || attempt === attempts) break;
      await sleep(Math.min(60_000, 2_000 * (2 ** (attempt - 1))) + Math.floor(Math.random() * 750));
    }
  }
  throw lastError || new Error(`request_failed:${url}`);
}

function extractCarvectorResult(payload) {
  const found = [];
  const walk = (value) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value.offers) && Number.isFinite(Number(value.total))) found.push(value);
    for (const child of Object.values(value)) walk(child);
  };
  walk(payload?.data);
  return found.sort((a, b) => Number(b?.offers?.length || 0) - Number(a?.offers?.length || 0))[0] || { total: 0, offers: [] };
}

function carvectorStatUrl(offset) {
  const url = new URL(`${CARVECTOR}/stat`);
  url.searchParams.set("minYear", String(minYear));
  url.searchParams.set("pageSize", String(carvectorPageSize));
  url.searchParams.set("sortBy", "AUCTION_AT_DESC");
  url.searchParams.set("page", String(Math.floor(offset / carvectorPageSize) + 1));
  if (carvectorServerMinPrice) url.searchParams.set("minPrice", String(carvectorServerMinPrice));
  if (carvectorServerMinEngineCc) url.searchParams.set("minEngineVolume", String(carvectorServerMinEngineCc));
  if (exactDate) url.searchParams.append("auctionDate", `${exactDate}T00:00:00Z`);
  else if (!recentLimit) url.searchParams.append("auctionDate", month);
  return url.toString();
}

async function carvectorSsrPage(offset) {
  const url = carvectorStatUrl(offset);
  const response = await fetchWithRetry(url, { headers: { ...browserHeaders, referer: `${CARVECTOR}/stat` } });
  return extractCarvectorOffersFromNgState(await response.text());
}

async function carvectorGraphqlPage(offset) {
  const operation = `JapanExact_${scope.replace(/-/g, "_")}_${offset}`;
  const query = `query ${operation}($input: FindOffersAuctionsInput!) {
    findOffersAuctionsStats(input: $input) {
      ... on FindOffersAuctionsResult {
      total
      offers {
        __typename id kind auctionAt lot year power engineVolume mileage
        urlPage { fullUrl }
        make { title slug }
        model { title slug }
        chassis { title }
        modification { title }
        auction { title slug }
        finishPrice { JPY }
        startPrice { JPY }
        transmission { title }
        transmissionType { title }
        color { title slug }
        fuel { title slug }
        gear { title }
        rate { title }
      }
      }
    }
  }`;
  const filterInput = {
    ...(carvectorServerMinPrice ? { minPrice: carvectorServerMinPrice, currency: "JPY" } : {}),
    ...(carvectorServerMinEngineCc ? { minEngineVolume: carvectorServerMinEngineCc } : {}),
    ...(recentLimit ? {} : exactDate ? { auctionDateAnyOf: [`${exactDate}T00:00:00.000Z`] } : { auctionMonthAnyOf: [month] }),
  };
  const body = JSON.stringify({ operationName: operation, query, variables: { input: {
    statusAnyOf: ["PUBLISHED"], ...filterInput, minYear, limit: carvectorPageSize, offset, countTotal: true,
  } } });
  const pageUrl = recentLimit
    ? `${CARVECTOR}/stat?minYear=${minYear}&pageSize=${carvectorPageSize}`
    : exactDate
    ? `${CARVECTOR}/stat?auctionDateAnyOf=${encodeURIComponent(exactDate)}&minYear=${minYear}&pageSize=${carvectorPageSize}`
    : `${CARVECTOR}/stat?auctionMonthAnyOf=${encodeURIComponent(month)}&minYear=${minYear}&pageSize=${carvectorPageSize}`;
  const response = await fetchWithRetry(`${CARVECTOR}/graphql`, {
    method: "POST",
    headers: {
      accept: "application/json", "content-type": "application/json", "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache", pragma: "no-cache", referer: pageUrl, "x-page-url": pageUrl,
      "user-agent": browserHeaders["user-agent"],
    },
    body,
  });
  const payload = await response.json();
  if (Array.isArray(payload?.errors) && payload.errors.length) throw new Error(`carvector_graphql:${clean(payload.errors[0]?.message)}`);
  return extractCarvectorResult(payload);
}

async function carvectorPage(offset) {
  if (carvectorTransport === "ssr") return carvectorSsrPage(offset);
  if (carvectorTransport !== "graphql") throw new Error(`invalid_carvector_transport:${carvectorTransport}`);
  return carvectorGraphqlPage(offset);
}

function normalizeCarvectorRow(row) {
  const sourceUrl = row?.urlPage?.fullUrl ? new URL(row.urlPage.fullUrl, CARVECTOR).toString() : "";
  return {
    id: clean(row?.id), date: toJapanAuctionDate(row?.auctionAt), auctionAt: clean(row?.auctionAt), lot: clean(row?.lot),
    make: clean(row?.make?.title), model: clean(row?.model?.title), chassis: normalizeCarvectorChassis(row?.chassis?.title),
    modification: clean(row?.modification?.title), auction: clean(row?.auction?.title), auctionSlug: clean(row?.auction?.slug), year: positive(row?.year),
    powerHp: positive(row?.power), engineCc: positive(row?.engineVolume), mileageKm: positive(row?.mileage),
    finalPriceJpy: positive(row?.finishPrice?.JPY), startPriceJpy: positive(row?.startPrice?.JPY),
    transmission: clean(row?.transmission?.title || row?.transmissionType?.title), color: clean(row?.color?.title),
    fuel: clean(row?.fuel?.title), fuelSlug: clean(row?.fuel?.slug), gear: clean(row?.gear?.title), auctionGrade: clean(row?.rate?.title), sourceUrl,
  };
}

function eligibleCarvectorRow(row) {
  return (recentLimit ? true : exactDate ? row.date === exactDate : row.date.startsWith(month))
    && row.date && row.lot && row.make && row.model && row.chassis && row.auction && row.year >= minYear
    && row.engineCc >= 400 && row.powerHp >= 30 && row.powerHp <= 1_500 && row.finalPriceJpy > 0
    && /^https:\/\/carvector\.com\/stat\//.test(row.sourceUrl)
    && !ELECTRIFIED.test(`${row.model} ${row.modification} ${row.fuel}`);
}

async function collectCarvector() {
  if (carvectorInput) {
    const payload = JSON.parse(await fs.readFile(carvectorInput, "utf8"));
    if (!Array.isArray(payload?.evidence)) throw new Error(`carvector_evidence_shape_invalid:${carvectorInput}`);
    const byId = new Map();
    for (const raw of payload.evidence) {
      const row = { ...raw, date: toJapanAuctionDate(raw?.auctionAt || raw?.date) };
      if (row.id && !byId.has(row.id) && eligibleCarvectorRow(row)) byId.set(row.id, row);
    }
    return { total: Math.max(0, Number(payload?.report?.carvectorTotal || byId.size)), rows: [...byId.values()] };
  }
  const first = await carvectorPage(startOffset);
  const total = Math.max(0, Number(first.total || 0));
  const collectionLimit = recentLimit || Math.max(0, total - startOffset);
  const pageCount = Math.min(Math.ceil(Math.max(0, total - startOffset) / carvectorPageSize), Math.ceil(collectionLimit / carvectorPageSize), carvectorMaxPages || Number.MAX_SAFE_INTEGER);
  if (!pageCount) return { total, rows: [] };
  const pages = new Array(pageCount);
  pages[0] = first;
  let cursor = 1;
  await Promise.all(Array.from({ length: Math.min(carvectorConcurrency, Math.max(0, pageCount - 1)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= pageCount) return;
      if (carvectorPageDelayMs) await sleep(carvectorPageDelayMs + Math.floor(Math.random() * 250));
      pages[index] = await carvectorPage(startOffset + index * carvectorPageSize);
    }
  }));
  const byId = new Map();
  for (const [index, page] of pages.entries()) {
    const remaining = Math.max(0, Math.min(Math.max(0, total - startOffset), collectionLimit) - index * carvectorPageSize);
    for (const raw of (page?.offers || []).slice(0, Math.min(carvectorPageSize, remaining))) {
      const row = normalizeCarvectorRow(raw);
      if (!row.id || byId.has(row.id)) continue;
      byId.set(row.id, row);
    }
  }
  const rows = [...byId.values()].filter(eligibleCarvectorRow);
  return { total, rows };
}

async function createJpaucSession(date) {
  let cookie = "";
  const request = async (url, options = {}) => {
    const response = await fetchWithRetry(url, {
      ...options,
      headers: { ...browserHeaders, ...(cookie ? { cookie } : {}), ...(options.headers || {}) },
    });
    if (!cookie) cookie = clean(response.headers.get("set-cookie")).split(";")[0];
    return { response, html: await response.text() };
  };
  const initial = await request(PAST, { headers: { ...browserHeaders, referer: `${JPAUC}/auction` } });
  const dateBody = new URLSearchParams(); dateBody.append("checkdate[]", date); dateBody.append("submit", "submitauction");
  const maker = await request(PAST, { method: "POST", body: dateBody.toString(), headers: { "content-type": "application/x-www-form-urlencoded", origin: JPAUC, referer: PAST } });
  const makers = jpaucCheckboxValues(maker.html, "mk[]");
  if (!makers.length) throw new Error(`jpauc_no_makers:${date}`);
  const makerBody = new URLSearchParams(); makers.forEach((value) => makerBody.append("mk[]", value));
  const model = await request(maker.response.url, { method: "POST", body: makerBody.toString(), headers: { "content-type": "application/x-www-form-urlencoded", origin: JPAUC, referer: maker.response.url } });
  const models = jpaucCheckboxValues(model.html, "md[]");
  if (!models.length) throw new Error(`jpauc_no_models:${date}`);
  const modelBody = new URLSearchParams(); models.forEach((value) => modelBody.append("md[]", value));
  const listing = await request(model.response.url, { method: "POST", body: modelBody.toString(), headers: { "content-type": "application/x-www-form-urlencoded", origin: JPAUC, referer: model.response.url } });
  return {
    date, request, listingUrl: listing.response.url,
    makerOptions: selectOptions(listing.html, "maker-filter"),
    auctionOptions: selectOptions(listing.html, "auct-filter"),
  };
}

function optionForMake(options, make) {
  const exact = options.find((option) => token(option.label) === token(make));
  if (exact) return exact;
  return options.find((option) => token(option.label).includes(token(make)) || token(make).includes(token(option.label)));
}
function optionsForVenue(options, venue) {
  return options.filter((option) => venueCompatible(option.label, venue));
}

async function scanJpaucGroup(session, group, makerOption, auctionOption) {
  const url = new URL(session.listingUrl);
  url.searchParams.set("d", `'${session.date}'`);
  url.searchParams.set("m", makerOption.value);
  if (auctionOption) url.searchParams.append("a[]", auctionOption.value);
  url.searchParams.set("ys", String(minYear));
  url.searchParams.set("ye", String(new Date().getUTCFullYear()));
  url.searchParams.set("mm", "0"); url.searchParams.set("mx", "9999"); url.searchParams.set("ob", "none"); url.searchParams.set("p", "1");
  const first = await session.request(url.toString(), { headers: { referer: session.listingUrl } });
  const total = jpaucListingTotal(first.html, 0);
  const pages = Math.ceil(total / 10);
  if (!auctionOption && pages > maxFallbackPages) return { rows: [], total, pages, skipped: "fallback_page_cap" };
  const rows = parseJpaucListingRows(first.html);
  let cursor = 2;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(0, pages - 1)) }, async () => {
    while (true) {
      const page = cursor++;
      if (page > pages) return;
      const pageUrl = new URL(url); pageUrl.searchParams.set("p", String(page));
      const result = await session.request(pageUrl.toString(), { headers: { referer: url.toString() } });
      rows.push(...parseJpaucListingRows(result.html));
    }
  }));
  return { rows, total, pages };
}

function exactMatch(jpauc, evidence) {
  return soldStatus(jpauc.sourceStatus)
    && baseKey(jpauc) === baseKey(evidence)
    && venueCompatible(jpauc.location, evidence.auction)
    && compatibleCarvectorModel(jpauc.model, evidence.model)
    && normalizeCarvectorChassis(jpauc.modelCode) === evidence.chassis
    && engineCompatible(jpauc.engineCc, evidence.engineCc);
}

function joinedOffer(jpauc, evidence) {
  const now = new Date().toISOString();
  const images = jpaucPhotoVariants(jpauc.listingImage).slice(0, 3).map(remoteImage);
  const sourceTitle = [jpauc.maker, jpauc.model, jpauc.grade].filter(Boolean).join(" ");
  return {
    id: `${SOURCE_ID}:${jpauc.dataId}`, sourceId: SOURCE_ID, sourceOfferId: jpauc.dataId, market: "japan",
    offerType: "auction", status: "active", catalogKind: "auction_result", auctionResult: "sold", auctionPriceKind: "published_result",
    sourceTitle, make: jpauc.maker, model: jpauc.model, trim: jpauc.grade || evidence.modification || undefined,
    year: jpauc.year, mileageKm: jpauc.mileageKm || evidence.mileageKm || undefined, engineCc: evidence.engineCc,
    fuel: evidence.fuel || "Gasoline", powertrainKind: "combustion", transmission: jpauc.shift || evidence.transmission || undefined,
    powerHp: evidence.powerHp, powerKw: Math.round((evidence.powerHp / 1.359621617) * 10) / 10,
    powerDataConfidence: "source_exact", powerDataSource: evidence.sourceUrl, color: jpauc.color || evidence.color || undefined,
    frameNumber: evidence.chassis, auctionName: jpauc.location, auctionDate: evidence.date, lotNumber: jpauc.lot,
    auctionGrade: jpauc.auctionGrade || evidence.auctionGrade || undefined,
    sourcePrice: evidence.finalPriceJpy, sourceCurrency: "JPY", priceMode: "fixed", images,
    calculationStatus: "needs_data", firstSeenAt: now, updatedAt: now,
    operational: {
      sourceUrl: jpauc.detailUrl, sourceVenueName: jpauc.location || "JPAuc", sourcePublishedAt: evidence.date, sourceTitle,
      exactDetail: true, exactFields: true, exactPhotos: images.length >= 3, photoIdentityVerified: images.length >= 3,
      galleryVerified: images.length >= 3, galleryImageCount: images.length, gallerySafetyMode: "jpauc_aleado_lot_plus_carvector_exact_result_v1", galleryStoredAs: "json_urls", minimumImages: 3, historicalAuction: true,
      raw: {
        ...jpauc, finalPriceJpy: evidence.finalPriceJpy, listingBoundImages: images.length >= 3, photoIdentityVerified: images.length >= 3,
        recoveryExactSourceUrl: true, recoveryExactPhotoIdentity: images.length >= 3, recoveryBodySourceOnly: true,
        exactJoinVersion: 1, exactJoinFields: ["auctionDate", "auctionVenue", "lotNumber", "make", "model", "chassis", "year", "engineCc"],
        carvectorEvidenceSourceId: EVIDENCE_SOURCE_ID, carvectorEvidenceId: evidence.id, carvectorEvidenceUrl: evidence.sourceUrl,
        carvectorAuctionName: evidence.auction, carvectorAuctionDate: evidence.date, carvectorLotNumber: evidence.lot,
        carvectorChassis: evidence.chassis, carvectorFinalPriceJpy: evidence.finalPriceJpy, carvectorPowerHp: evidence.powerHp,
        carvectorExactFinalPrice: true, carvectorExactPower: true, carvectorCombustionOnly: true,
      },
    },
  };
}

async function pool(items, limit, worker) {
  const outputRows = new Array(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length || 1) }, async () => {
    while (true) { const index = cursor++; if (index >= items.length) return; outputRows[index] = await worker(items[index], index); }
  }));
  return outputRows;
}

const carvector = await collectCarvector();
console.log(`[carvector] scope=${scope} total=${carvector.total} eligible=${carvector.rows.length}`);
if (carvectorOnly) {
  await fs.writeFile(output, JSON.stringify({ evidence: carvector.rows, offers: [], report: { version: 1, mode: "carvector_evidence", scope, month: month || null, exactDate: exactDate || null, recentLimit: recentLimit || null, startOffset, carvectorTotal: carvector.total, carvectorEligible: carvector.rows.length, dates: [...new Set(carvector.rows.map((row) => row.date))], auctionAts: [...new Set(carvector.rows.map((row) => row.auctionAt))].slice(0, 20) } }, null, 2));
  process.exit(0);
}
const evidenceByDate = new Map();
for (const row of carvector.rows) {
  if (!evidenceByDate.has(row.date)) evidenceByDate.set(row.date, []);
  evidenceByDate.get(row.date).push(row);
}
const offers = [];
const scans = [];
const failures = [];
const unmappedVenues = new Map();
const jpaucAuctionOptions = new Map();
const dateEntries = [...evidenceByDate.entries()].sort();
for (const [date, dateEvidence] of (maxDates ? dateEntries.slice(0, maxDates) : dateEntries)) {
  console.log(`[jpauc] date=${date} evidence=${dateEvidence.length} session=start`);
  let session;
  try { session = await createJpaucSession(date); }
  catch (error) { failures.push({ date, error: clean(error?.message || error) }); continue; }
  jpaucAuctionOptions.set(date, session.auctionOptions.map((option) => option.label));
  const grouped = new Map();
  for (const evidence of dateEvidence) {
    const key = `${token(evidence.make)}|${venueCore(evidence.auction)}`;
    if (!grouped.has(key)) grouped.set(key, { make: evidence.make, venue: evidence.auction, evidence: [] });
    grouped.get(key).evidence.push(evidence);
  }
  const tasks = [];
  const fallbackKeys = new Set();
  const groupValues = [...grouped.values()];
  for (const group of (maxGroupsPerDate ? groupValues.slice(0, maxGroupsPerDate) : groupValues)) {
    const makerOption = optionForMake(session.makerOptions, group.make);
    if (!makerOption) { failures.push({ date, make: group.make, venue: group.venue, error: "jpauc_maker_mapping_missing" }); continue; }
    const venueOptions = optionsForVenue(session.auctionOptions, group.venue);
    if (venueOptions.length) {
      venueOptions.forEach((auctionOption) => tasks.push({ group, makerOption, auctionOption }));
    } else {
      const unmappedKey = `${date}|${group.venue}`;
      unmappedVenues.set(unmappedKey, (unmappedVenues.get(unmappedKey) || 0) + group.evidence.length);
      if (maxFallbackPages === 0) continue;
      const fallbackKey = makerOption.value;
      if (!fallbackKeys.has(fallbackKey)) {
        fallbackKeys.add(fallbackKey);
        const fallbackEvidence = dateEvidence.filter((row) => token(row.make) === token(group.make));
        tasks.push({ group: { make: group.make, venue: "", evidence: fallbackEvidence }, makerOption, auctionOption: null });
      }
    }
  }
  const results = await pool(tasks, Math.min(4, concurrency), async (task) => {
    try { return { task, ...(await scanJpaucGroup(session, task.group, task.makerOption, task.auctionOption)) }; }
    catch (error) { failures.push({ date, make: task.group.make, venue: task.group.venue, error: clean(error?.message || error) }); return { task, rows: [], total: 0, pages: 0, skipped: "request_failure" }; }
  });
  for (const result of results) {
    scans.push({ date, make: result.task.group.make, carvectorVenue: result.task.group.venue, jpaucVenue: result.task.auctionOption?.label || null, total: result.total, pages: result.pages, rows: result.rows.length, skipped: result.skipped || null });
    const lookup = new Map();
    for (const evidence of result.task.group.evidence) {
      const key = baseKey(evidence); if (!lookup.has(key)) lookup.set(key, []); lookup.get(key).push(evidence);
    }
    for (const jpauc of result.rows) {
      if (!soldStatus(jpauc.sourceStatus) || !jpauc.listingImage) continue;
      const matches = (lookup.get(baseKey(jpauc)) || []).filter((evidence) => exactMatch(jpauc, evidence));
      const uniqueEvidence = [...new Map(matches.map((row) => [row.id, row])).values()];
      if (uniqueEvidence.length !== 1) continue;
      offers.push(joinedOffer(jpauc, uniqueEvidence[0]));
    }
  }
  console.log(`[jpauc] date=${date} groups=${tasks.length} rows=${results.reduce((sum, row) => sum + row.rows.length, 0)} joined_total=${offers.length}`);
}

const uniqueOffers = [...new Map(offers.filter((offer) => offer.images.length >= 3).map((offer) => [offer.id, offer])).values()];
const report = {
  version: 1, mode: "jpauc_exact_lot_gallery_plus_carvector_exact_sold_price_power", scope, month: month || null, exactDate: exactDate || null, recentLimit: recentLimit || null, startOffset,
  carvectorTotal: carvector.total, carvectorEligible: carvector.rows.length, dates: evidenceByDate.size,
  scanCount: scans.length, jpaucRowsScanned: scans.reduce((sum, row) => sum + Number(row.rows || 0), 0),
  exactJoined: uniqueOffers.length, failureCount: failures.length, failures: failures.slice(0, 100), scans,
  unmappedVenues: [...unmappedVenues.entries()].map(([key, count]) => {
    const split = key.indexOf("|");
    return { date: key.slice(0, split), venue: key.slice(split + 1), count };
  }).sort((a, b) => b.count - a.count || a.venue.localeCompare(b.venue)),
  jpaucAuctionOptions: Object.fromEntries(jpaucAuctionOptions),
  approvedSourceIds: [SOURCE_ID, EVIDENCE_SOURCE_ID], forbiddenSourceCount: 0,
};
await fs.writeFile(output, JSON.stringify({ offers: uniqueOffers, report }, null, 2));
console.log(JSON.stringify({ ...report, scans: undefined, output }, null, 2));
if (!carvector.rows.length || !uniqueOffers.length) process.exitCode = 1;
