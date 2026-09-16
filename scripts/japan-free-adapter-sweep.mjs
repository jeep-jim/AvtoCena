import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Research artifacts only. Never route requests through the production site.
process.env.PRESTIGE_JAPAN_DISABLE_EGRESS = '1';
process.env.CATALOG_KNOWLEDGE_DISABLED = '1';
process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS = '25000';
process.env.PRESTIGE_JAPAN_REQUEST_ATTEMPTS = '1';
process.env.PRESTIGE_JAPAN_SEARCH_PAGES_PER_FETCH = '1';
process.env.PRESTIGE_JAPAN_DETAIL_CONCURRENCY = '2';
const name = process.argv[2];
const adapters = {
  prestige: ['../apps/web/lib/catalog/prestige-japan-exact-source.ts', 'prestigeJapanExactSource'],
  carvector: ['../apps/web/lib/catalog/carvector-current-source.ts', 'carvectorJapanCurrentSource'],
  jpauc: ['../apps/web/lib/catalog/jpauc-past-source.ts', 'jpaucPastSource'],
};
if (!adapters[name]) throw new Error('Unknown source');
const source = (await import(adapters[name][0]))[adapters[name][1]];
if (name === 'carvector') {
  // The legacy adapter defaults to Toyota Corolla. This run must cover all makes.
  const { parseCarvectorNgState } = await import(adapters.carvector[0]);
  source.fetchPage = async cursor => {
    const page = Number(cursor || 1);
    const url = new URL('https://carvector.com/stat/');
    for (const [key,value] of Object.entries({minYear:'2010',minPrice:'1',pageSize:'50',sortBy:'AUCTION_AT_DESC',page:String(page)})) url.searchParams.set(key,value);
    const r = await fetch(url,{headers:{'user-agent':'AvtoCena catalog research/1.0',accept:'text/html'},signal:AbortSignal.timeout(25000)});
    if(!r.ok) throw new Error(`carvector_http_${r.status}`);
    const result=parseCarvectorNgState(await r.text());
    const finished=!result.offers.length || page*50>=result.total;
    return {items:result.offers.map(row=>({...row,_carvectorListUrl:String(url)})),finished,nextCursor:finished?null:String(page+1),health:{total:result.total,page}};
  };
}
const root = `japan-free-results/${name}`;
await fs.mkdir(root, { recursive: true });
const deadline = Date.now() + Number(process.env.SWEEP_SECONDS || 10800) * 1000;
const cutoff = new Date(Date.now() - 92 * 86400000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);
const seen = new Set();
const pageHashes = new Set();
let cursor = undefined, buffer = [], part = 0;
const report = { source: name, startedAt: new Date().toISOString(), pages: 0, rows: 0, accepted: 0, review: 0, duplicates: 0, errors: [], stopReason: '' };
async function save() {
  if (buffer.length) {
    await fs.writeFile(`${root}/part-${String(++part).padStart(6,'0')}.json`, JSON.stringify(buffer));
    buffer = [];
  }
  await fs.writeFile(`${root}/summary.json`, JSON.stringify({...report,cursor,unique:seen.size},null,2));
}
const clean = s => String(s || '').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').trim();
try {
  while (Date.now() < deadline) {
    const page = await source.fetchPage(cursor);
    report.pages++;
    const rows = page.items || [];
    const signature = crypto.createHash('sha256').update(JSON.stringify(rows.map(r=>r.carId || r.id || r.dataId))).digest('hex');
    if (rows.length && pageHashes.has(signature)) { report.stopReason='repeated_page'; break; }
    if (rows.length) pageHashes.add(signature);
    for (const raw of rows) {
      const id = String(raw.carId || raw.id || raw.dataId || '');
      report.rows++;
      if (!id) continue;
      if (seen.has(id)) { report.duplicates++; continue; }
      seen.add(id);
      let row = {source:name,sourceId:id,raw,publicationReady:false,qualifiedSoldCandidate:false};
      if (name === 'prestige') {
        row = {...row,sourceUrl:raw.sourceUrl,make:raw.make,model:raw.model,year:raw.year,auctionDate:raw.auctionDate,
          auctionName:raw.auctionName,lotNumber:raw.lotNumber,priceJpy:raw.finalPrice,statusRaw:raw.currentStatus,
          imageUrls:raw.images,imagesVerified:false};
        row.qualifiedSoldCandidate=raw.currentStatus==='Sold' && raw.finalPrice>0 && raw.auctionDate>=cutoff && raw.auctionDate.slice(0,10)<=today;
      } else if (name === 'carvector') {
        // Ended/finishPrice does not alone prove a sale. Preserve evidence for exact joining.
        row.sourceUrl=raw.urlPage?.fullUrl || raw._carvectorListUrl;
        row.priceJpy=raw.finishPrice?.JPY;
        row.auctionDate=raw.auctionAt;
        row.reviewReason='explicit_sold_status_and_gallery_not_verified';
      } else {
        row.sourceUrl=raw.detailUrl;
        try {
          // Adapter's own anonymous cookie session, no user credentials.
          const detail=await source.request(raw.detailUrl,{referer:'https://jpauc.com/auction/past'});
          const text=clean(detail.html);
          const status=text.match(/Status:\s*(Sold|Not Sold|Unsold|Available|Cancelled|Removed)\b/i)?.[1] || '';
          const value=text.match(/End Price:\s*¥\s*([0-9,]+)/i)?.[1];
          row.statusRaw=status;row.priceJpy=value?Number(value.replace(/,/g,'')):null;
          row.detailEvidence=text.slice(0,18000);
          row.imageUrls=[...new Set([...detail.html.matchAll(/https?:\/\/p3\.aleado\.com\/pic\/\?[^"'<>\s]+/gi)].map(m=>m[0].replace(/&amp;/g,'&')))];
          row.reviewReason='auction_date_and_photo_roles_require_review';
        } catch(e) {row.detailError=String(e.message || e);}
      }
      report[row.qualifiedSoldCandidate?'accepted':'review']++;
      buffer.push(row);
      if(buffer.length>=250)await save();
    }
    const next=page.nextCursor;
    if(page.finished || !next) { report.stopReason='source_exhausted'; await save(); break; }
    if(next===cursor) {report.stopReason='cursor_stalled';await save();break;}
    cursor=next;
    await save();
    console.log(JSON.stringify({...report,cursor,health:page.health}));
    await new Promise(r=>setTimeout(r,1000));
  }
  report.stopReason ||= 'time_budget_checkpointed';
} catch(e) {
  report.stopReason='source_error'; report.errors.push(String(e.stack || e));
} finally {
  report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify(report));
}
