import fs from 'node:fs/promises';
import path from 'node:path';
import { publishedIntakeCheckpoint } from './lib/catalog-intake-checkpoint.mjs';
import {attachIntakeArchiveReceipt, INTAKE_ARCHIVE_RECEIPT} from './lib/nonjp-intake-archive.mjs';
import {commitCoordinatedIntakeCursor} from './lib/catalog-raw-cursor.mjs';
const market=process.env.CATALOG_REBUILD_MARKETS;
if (!['korea','china','uae','europe','georgia','japan'].includes(market)) throw Error('invalid_cursor_market');
const root=process.env.CATALOG_INTAKE_INPUT_DIR || 'catalog-intake-input';
let intake=JSON.parse(await fs.readFile(path.join(root,`catalog-intake-${market}`,'report.json'),'utf8'));
if(market!=='japan') {
  try { const receipt=JSON.parse(await fs.readFile(path.join(root,`catalog-intake-${market}`,INTAKE_ARCHIVE_RECEIPT),'utf8'));
    intake=attachIntakeArchiveReceipt(intake,receipt);
  } catch(error) { if(error?.code!=='ENOENT')throw error; }
}
const publication=JSON.parse(await fs.readFile(process.env.CATALOG_REBUILD_PUBLISH_REPORT,'utf8'));
const checkpoint=publishedIntakeCheckpoint(intake,publication);
const {getJsonStorage}=await import('../apps/web/lib/data.ts');
const outcome=await commitCoordinatedIntakeCursor({storage:getJsonStorage(),intake,publication,checkpoint});
if(publication.rawCoordination){
  publication.rawPinRelease=outcome.rawPinRelease;
  await fs.writeFile(process.env.CATALOG_REBUILD_PUBLISH_REPORT,JSON.stringify(publication,null,2));
}
console.log(JSON.stringify({market,generationId:checkpoint.generationId,...outcome}));
