import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultShowcase,normalizeShowcase} from '../apps/web/lib/dealers/showcase-model';
import {publicDealerProfile} from '../apps/web/lib/dealers/public-profile';
import {applyBasicAccess,restrictedShowcaseChange} from '../apps/web/lib/dealers/program-model';
import {mergeShowcaseChanges} from '../apps/web/lib/dealers/showcase-merge';
test('desktop and mobile covers survive normalization independently and cross the public boundary',()=>{
 const base=defaultShowcase('dealer_topavto');
 const saved=normalizeShowcase({...base,banner:'/dealers/topavto-banner-v3.webp',bannerMobile:'/api/dealers/dealer_topavto/media/00000000-0000-0000-0000-000000000001'},base.dealerId);
 assert.equal(saved.banner,'/dealers/topavto-banner-v3.webp');assert.equal(saved.bannerMobile,'/api/dealers/dealer_topavto/media/00000000-0000-0000-0000-000000000001');
 assert.equal(publicDealerProfile(saved).bannerMobile,saved.bannerMobile);
 assert.equal(normalizeShowcase({...saved,bannerMobile:''},base.dealerId).banner,saved.banner);
 assert.equal(normalizeShowcase(base,base.dealerId).bannerMobile,'');
});
test('mobile covers follow media ownership and single-banner basic access',()=>{
 const base=defaultShowcase('dealer_other');
 assert.throws(()=>normalizeShowcase({...base,bannerMobile:'/api/dealers/dealer_topavto/media/00000000-0000-0000-0000-000000000001'},base.dealerId));
 const edited={...base,bannerMobile:'/api/dealers/dealer_other/media/00000000-0000-0000-0000-000000000001'};
 assert.equal(restrictedShowcaseChange(base,edited),false);assert.equal(applyBasicAccess(edited).bannerMobile,edited.bannerMobile);
});
test('concurrent desktop and mobile cover edits are merged without dropping either',()=>{
 const base=defaultShowcase('dealer_topavto');const merged=mergeShowcaseChanges(base,{...base,bannerMobile:'mobile'},{...base,banner:'desktop'});
 assert.deepEqual(merged.conflicts,[]);assert.equal(merged.value.banner,'desktop');assert.equal(merged.value.bannerMobile,'mobile');
});

test('up to five banner pairs, premium restriction and no invented markets',()=>{const base=defaultShowcase('dealer_other','Новая компания');assert.equal(base.profileEnabled,true);assert.deepEqual(base.catalogMarkets,[]);const url='/api/dealers/dealer_other/media/00000000-0000-0000-0000-000000000001';const next=normalizeShowcase({...base,extraBanners:Array.from({length:6},(_,i)=>({id:String(i),desktop:url,mobile:url}))},base.dealerId);assert.equal(next.extraBanners?.length,4);assert.equal(publicDealerProfile(next).extraBanners?.length,4);assert.equal(restrictedShowcaseChange(base,next),true);assert.deepEqual(applyBasicAccess(next).extraBanners,[]);assert.equal(normalizeShowcase({...base,profileEnabled:false},base.dealerId).profileEnabled,false);assert.throws(()=>normalizeShowcase({...base,extraBanners:[{id:'1',desktop:'/api/dealers/another/media/00000000-0000-0000-0000-000000000001'}]},base.dealerId));});
