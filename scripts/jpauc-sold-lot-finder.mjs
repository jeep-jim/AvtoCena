import fs from 'node:fs/promises';

const BASE = 'https://jpauc.com';
const PAST = `${BASE}/auction/past`;
const HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
  'accept-language': 'en-US,en;q=0.9,ja;q=0.8',
  'cache-control': 'no-cache', pragma: 'no-cache',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
};
let cookie = '';
function clean(value) { return String(value ?? '').replace(/&quot;/gi, '"').replace(/&#039;|&apos;/gi, "'").replace(/&amp;/gi, '&').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(); }
function checkbox(html, name) { const e = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); return [...html.matchAll(new RegExp(`name=["']${e}["'][^>]*value=["']([^"']+)["']`, 'gi'))].map(m => m[1]); }
async function request(url, options = {}) {
  const res = await fetch(url, { method: options.method || 'GET', body: options.body, redirect: 'follow', headers: { ...HEADERS, ...(cookie ? { cookie } : {}), ...(options.referer ? { referer: options.referer } : {}), ...(options.accept ? { accept: options.accept } : {}), ...(options.method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded', origin: BASE } : {}) }, signal: AbortSignal.timeout(30_000) });
  const body = await res.text();
  if (!cookie) cookie = String(res.headers.get('set-cookie') || '').split(';')[0];
  if (!res.ok) throw new Error(`jpauc_http_${res.status}:${url}`);
  return { res, body };
}
function parseMoney(text) {
  const value = clean(text);
  const match = value.match(/(?:¥|JPY)\s*([0-9][0-9,]*)/i) || value.match(/([0-9][0-9,]*)\s*(?:JPY|円)/i) || value.match(/^([0-9][0-9,]*)$/);
  return match ? Number(match[1].replace(/,/g, '')) : 0;
}
function listingRows(html, limit = 60) {
  return [...html.matchAll(/<tr\b([^>]*)data-id=["'](\d+)["']([^>]*)>([\s\S]*?)<\/tr>/gi)].slice(0, limit).map((m, index) => {
    const attrs = `${m[1]} data-id="${m[2]}" ${m[3]}`;
    const cells = [...m[0].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(c => clean(c[1]));
    const text = cells.join(' | ');
    const status = text.match(/Status:\s*([^|]+)/i)?.[1]?.trim() || '';
    const start = text.match(/Start:\s*([^|]+)/i)?.[1]?.trim() || '';
    const end = text.match(/End(?: Price)?:\s*([^|]+)/i)?.[1]?.trim() || '';
    return {
      index: index + 1,
      dataId: m[2],
      r: attrs.match(/data-r=["']([^"']+)["']/i)?.[1] || String(index + 1),
      rtotal: attrs.match(/data-r-total=["']([^"']+)["']/i)?.[1] || '',
      date: cells.find((cell) => /^20\d{2}-\d{2}-\d{2}$/.test(cell)) || '',
      locationLot: cells.find((cell) => /\|\s*\d{2,}/.test(cell)) || '',
      title: cells.find((cell) => /^[A-Z0-9][A-Z0-9 .&+\-/]{3,}$/.test(cell) && !/^(?:FA|IA|FAT|AT|MT)\b/.test(cell)) || '',
      status,
      start,
      startPrice: parseMoney(start),
      end,
      endPrice: parseMoney(end),
      cells,
      rawHtml: m[0].slice(0, 12000),
    };
  });
}
function frameFromDetail(html) {
  const text = clean(html);
  return text.match(/(?:Frame|Chassis|VIN)\s*:\s*([A-Z0-9-]{5,30})/i)?.[1]?.trim()
    || html.match(/data-(?:vin|frame|chassis)\s*=\s*["']([^"']{5,40})["']/i)?.[1]?.trim()
    || '';
}
function detailFields(html) {
  const text = clean(html);
  const endRaw = text.match(/End Price:\s*([^|]{0,80}?)(?=\s+(?:\d+\/\s*\d+|Auction History|Last 3 Weeks|Click Here|Auction Sheet|Print|Inquiry|Bid Request|$))/i)?.[1]?.trim()
    || text.match(/End Price:\s*(N\/?A|¥\s*[0-9,]+)/i)?.[1]?.trim() || '';
  const startRaw = text.match(/Start Price:\s*(¥\s*[0-9,]+|N\/?A)/i)?.[1]?.trim() || '';
  const status = text.match(/Status:\s*([A-Za-z _-]+)/i)?.[1]?.trim() || '';
  const images = [...new Set([...html.matchAll(/https?:\/\/p3\.aleado\.com\/pic\/\?[^"'<>\s]+/gi)].map(m => m[0].replace(/&amp;/g, '&')))];
  const params = images[0] ? Object.fromEntries(new URL(images[0]).searchParams.entries()) : {};
  return { status, frame: frameFromDetail(html), startRaw, startPrice: parseMoney(startRaw), endRaw, endPrice: parseMoney(endRaw), imageCount: images.length, imageSample: images.slice(0, 8), aleadoIdentity: params };
}
function parseHistory(body) {
  let json = null;
  try { json = JSON.parse(body); } catch { return { validJson: false, rows: [] }; }
  const rows = Array.isArray(json) ? json : Array.isArray(json?.result) ? json.result : Array.isArray(json?.data) ? json.data : [];
  return {
    validJson: true,
    topKeys: json && typeof json === 'object' && !Array.isArray(json) ? Object.keys(json) : [],
    rows: rows.map(item => ({
      raw: item,
      lotDate: clean(item?.lot_date ?? item?.date ?? item?.auction_date),
      auctionName: clean(item?.auction_name ?? item?.auction ?? item?.venue),
      auctionRef: clean(item?.auct_system_ref ?? item?.auction_ref ?? item?.system_ref),
      lotNo: clean(item?.lot_no ?? item?.lot_number ?? item?.bid ?? item?.lot),
      result: clean(item?.result_en ?? item?.result ?? item?.status),
      endPriceRaw: clean(item?.end_price_en ?? item?.end_price ?? item?.final_price ?? item?.sold_price),
      endPrice: parseMoney(item?.end_price_en ?? item?.end_price ?? item?.final_price ?? item?.sold_price),
      frame: clean(item?.vin ?? item?.frame ?? item?.chassis),
      model: clean(item?.model ?? item?.model_name),
      grade: clean(item?.grade_en ?? item?.grade),
      mileage: clean(item?.mileage ?? item?.km),
    })),
  };
}
function historyMatchesLot(historyRows, row, detail) {
  const lot = row.locationLot.split('|').pop()?.trim() || '';
  const venue = row.locationLot.split('|')[0]?.trim() || '';
  return historyRows.filter(item => {
    const dateOk = !item.lotDate || item.lotDate.includes(row.date);
    const lotOk = !item.lotNo || item.lotNo === lot;
    const venueOk = !item.auctionName || !venue || item.auctionName.toLowerCase().includes(venue.toLowerCase()) || venue.toLowerCase().includes(item.auctionName.toLowerCase());
    const frameOk = !item.frame || !detail.frame || item.frame.replace(/\s/g, '').toUpperCase() === detail.frame.replace(/\s/g, '').toUpperCase();
    return dateOk && lotOk && venueOk && frameOk;
  });
}
async function buildListingForDate(date) {
  const step1 = await request(PAST, { method: 'POST', body: new URLSearchParams([['checkdate[]', date], ['submit', 'submitauction']]).toString(), referer: PAST });
  const makers = checkbox(step1.body, 'mk[]');
  if (!makers.length) return { date, error: 'no_makers' };
  const makerBody = new URLSearchParams(); makers.forEach(v => makerBody.append('mk[]', v));
  const step2 = await request(step1.res.url, { method: 'POST', body: makerBody.toString(), referer: step1.res.url });
  const models = checkbox(step2.body, 'md[]');
  if (!models.length) return { date, error: 'no_models' };
  const modelBody = new URLSearchParams(); models.forEach(v => modelBody.append('md[]', v));
  const listing = await request(step2.res.url, { method: 'POST', body: modelBody.toString(), referer: step2.res.url });
  const rows = listingRows(listing.body);
  return { date, listingUrl: listing.res.url, bytes: listing.body.length, makers: makers.length, models: models.length, rows };
}

const initial = await request(PAST, { referer: `${BASE}/auction` });
const allDates = [...new Set(checkbox(initial.body, 'checkdate[]'))];
const dateIndexes = [...new Set([0, 1, 2, 3, 4, 5, 7, 10, 14, Math.floor(allDates.length / 2), allDates.length - 1].filter(i => i >= 0 && i < allDates.length))];
const selectedDates = dateIndexes.map(i => allDates[i]);
const output = { generatedAt: new Date().toISOString(), allDateCount: allDates.length, firstDates: allDates.slice(0, 20), selectedDates, scans: [], soldCandidates: [] };

for (const date of selectedDates) {
  try {
    const scan = await buildListingForDate(date);
    if (scan.error) { output.scans.push(scan); continue; }
    const candidates = scan.rows.filter(row => row.endPrice > 0 || /sold|sale|success|成約|落札|売切/i.test(row.status));
    output.scans.push({ date, listingUrl: scan.listingUrl, bytes: scan.bytes, makers: scan.makers, models: scan.models, rowCount: scan.rows.length, statusCounts: Object.fromEntries([...new Set(scan.rows.map(r => r.status || 'empty'))].map(s => [s, scan.rows.filter(r => (r.status || 'empty') === s).length])), candidateCount: candidates.length, rowSamples: scan.rows.slice(0, 8).map(({ rawHtml, ...rest }) => rest) });
    for (const row of candidates.slice(0, 8)) {
      const detailUrl = `${PAST}/detail/${row.dataId}?&ys=1900&ye=2100&mm=0&mx=9999&p=1&ob=none&r=0&r=${encodeURIComponent(row.r)}&rtotal=${encodeURIComponent(row.rtotal || '1')}`;
      const detailResponse = await request(detailUrl, { referer: scan.listingUrl });
      const detail = detailFields(detailResponse.body);
      let history = { requested: false, rows: [], matches: [] };
      if (detail.frame) {
        const historyUrl = `${BASE}/API/auction/history/${encodeURIComponent(detail.frame)}`;
        try {
          const response = await request(historyUrl, { referer: detailUrl, accept: 'application/json,text/plain,*/*' });
          const parsed = parseHistory(response.body);
          history = { requested: true, url: historyUrl, status: response.res.status, contentType: response.res.headers.get('content-type') || '', bytes: response.body.length, validJson: parsed.validJson, topKeys: parsed.topKeys, rows: parsed.rows, matches: historyMatchesLot(parsed.rows, row, detail) };
        } catch (error) {
          history = { requested: true, url: historyUrl, error: String(error?.message || error), rows: [], matches: [] };
        }
      }
      output.soldCandidates.push({ date, row: Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'rawHtml')), detailUrl, detail, history });
    }
  } catch (error) {
    output.scans.push({ date, error: String(error?.message || error) });
  }
}

await fs.writeFile('jpauc-sold-lot-finder.json', JSON.stringify(output, null, 2));
console.log(JSON.stringify({ generatedAt: output.generatedAt, allDateCount: output.allDateCount, selectedDates: output.selectedDates, scans: output.scans, soldCandidates: output.soldCandidates.map(item => ({ date: item.date, dataId: item.row.dataId, lot: item.row.locationLot, status: item.row.status, detail: item.detail, history: { requested: item.history.requested, status: item.history.status, bytes: item.history.bytes, error: item.history.error, matchCount: item.history.matches?.length, matches: item.history.matches } })) }, null, 2));
