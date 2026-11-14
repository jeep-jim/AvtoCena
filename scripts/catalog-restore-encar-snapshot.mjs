import fs from 'node:fs/promises';
import path from 'node:path';
import { getJsonStorage } from '../apps/web/lib/data.ts';
import { EncarDirectAdapter } from '../apps/web/lib/catalog/adapters.ts';
import { isEncarNonCashContract } from '../apps/web/lib/catalog/encar-sale-contract.ts';
import { observationShardWriter } from './lib/catalog-intake-checkpoint.mjs';

const run = process.env.ENCAR_SNAPSHOT_RUN;
const attempt = process.env.ENCAR_SNAPSHOT_ATTEMPT;
if (!/^\d+$/.test(run || '') || !/^\d+$/.test(attempt || '')) throw Error('Invalid snapshot identity');
const prefix = 'catalog/intake-staging/encar/' + run + '/' + attempt;
const storage = getJsonStorage();
const snapshot = await storage.readJson(prefix + '/complete.json', null);
if (!Number.isSafeInteger(snapshot?.pages) || snapshot.pages < 1 ||
    !Number.isSafeInteger(snapshot.count) || snapshot.count < 1 ||
    !Number.isFinite(Date.parse(snapshot.completedAt))) throw Error('Missing complete Encar snapshot');
const output = path.resolve(process.env.CATALOG_INTAKE_DIR || 'catalog-intake-korea');
await fs.mkdir(output, {recursive:true});
if ((await fs.readdir(output)).length) throw Error('Intake directory must be empty');
const adapter = new EncarDirectAdapter();
const write = observationShardWriter(output, adapter.sourceId);
const seen = new Set();
let count = 0;
let excluded = 0;
let observations = 0;
for (let page = 1; page <= snapshot.pages; page++) {
  const rows = await storage.readJson(prefix + '/pages/' + page + '.json', null);
  if (!Array.isArray(rows) || !rows.length) throw Error('Missing saved Encar page ' + page);
  for (const row of rows) {
    count++;
    const d = row.data;
    const id = String(row.inner_id);
    if (!/^\d+$/.test(id) || String(d?.inner_id) !== id) throw Error('Encar identity mismatch');
    if (d.advertisement_type !== 'Продажа' || d.sales_status !== 'Доступно' ||
        isEncarNonCashContract(d) || Number(d.price) <= 0 || d.is_duplicate === true) { excluded++; continue; }
    const price = Number(d.price);
    if (d.currency !== 'KRW' || !Number.isSafeInteger(price)) throw Error('Invalid Encar cash price');
    const offer = adapter.normalizeOffer({Id:id, Manufacturer:d.mark, Model:d.model, FormYear:d.year,
      Price:price, Badge:d.configuration, BadgeDetail:d.complectation, Mileage:d.km_age,
      FuelType:d.engine_type, Transmission:d.transmission_type, DriveType:d.drive_type,
      Category:d.body_type, Displacement:d.displacement_cc, Color:d.color, UpdatedDate:snapshot.completedAt});
    if (!offer) throw Error('Invalid listing identity for Encar ' + id);
    offer.sourcePrice = price;
    offer.images = [...new Set(Array.isArray(d.photos) ? d.photos : [])].filter(value => {
      try {
        const url = new URL(value);
        return url.origin === 'https://ci.encar.com' && !url.username && !url.password &&
          url.pathname.split('/').pop().startsWith(id + '_');
      } catch { return false; }
    }).map(url => ({id:'',url,objectKey:'',checksum:'',size:0,mimeType:'image/jpeg'}));
    Object.assign(offer.operational, {provider:'auto_api_encar', exactDetail:true,
      detailIdentityVerified:true, exactPhotos:offer.images.length>0, galleryImageCount:offer.images.length});
    await write({stage:'detail', observedAt:snapshot.completedAt, offer});
    seen.add(offer.id);
    observations++;
  }
}
if (count !== snapshot.count || observations + excluded !== count || !seen.size) throw Error('Encar snapshot totals mismatch');
const report = {version:1,market:'korea',provider:'auto_api_encar',completed:true,completedAt:snapshot.completedAt,
  snapshotRun:run,snapshotAttempt:attempt,requiredSourceIds:[adapter.sourceId],confirmedWithdrawals:[],
  sources:[{sourceId:adapter.sourceId,provider:'auto_api_encar',observations,uniqueOffers:seen.size,
    stopReason:'source_finished',syncMode:'snapshot',pages:snapshot.pages,excluded}]};
await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report));
console.log(JSON.stringify({count,excluded,observations,uniqueOffers:seen.size}));
