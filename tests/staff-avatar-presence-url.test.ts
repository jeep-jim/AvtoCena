import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {normalizeStaffAvatar,MAX_AVATAR_BYTES} from '../apps/web/lib/staff-avatar';
import {staffIsOnline} from '../apps/web/lib/staff-presence';
import {offerPath,offerRouteId} from '../apps/web/lib/catalog/offer-url';
test('descriptive offer links keep unique identity across markets and punctuation',()=>{
 const offer={id:'green-707750',make:'Honda',model:'Freed',trim:'AIR EX',year:2026};
 assert.equal(offerPath(offer),'/cars/offer/honda-freed-air-ex-2026--green-707750');
 assert.equal(offerRouteId(offerPath(offer).split('/').pop()!),offer.id);
 assert.notEqual(offerPath(offer),offerPath({...offer,id:'japan-123'}));
 assert.equal(offerRouteId('legacy-123'),'legacy-123');
 assert.match(offerPath({id:'a',make:'Лада',model:'Веста'}),/lada-vesta--a$/);
 assert.doesNotMatch(offerPath({...offer,trim:'../../ <script>'}),/[<>]/);
});
test('presence expires and rejects future or invalid timestamps',()=>{
 const now=Date.now();assert.equal(staffIsOnline(new Date(now-60000).toISOString(),now),true);
 for(const at of [undefined,'invalid',new Date(now+1).toISOString(),new Date(now-120000).toISOString()])assert.equal(staffIsOnline(at,now),false);
});
test('avatar accepts raster content, normalizes dimensions, rejects SVG, corruption and size overflow',async()=>{
 for(const format of ['jpeg','png','webp','gif','avif','tiff'] as const){
 const input=await sharp({create:{width:600,height:800,channels:3,background:'green'}}).toFormat(format).toBuffer();
 const output=await normalizeStaffAvatar(input),meta=await sharp(output).metadata();
 assert.equal(meta.format,'webp');assert.equal(meta.width,512);assert.equal(meta.height,512);assert.equal(meta.exif,undefined);
 }
 for(const input of [Buffer.from('not an image'),Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'),Buffer.alloc(MAX_AVATAR_BYTES+1)])await assert.rejects(()=>normalizeStaffAvatar(input));
});
