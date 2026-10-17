import assert from 'node:assert/strict';
import test from 'node:test';
import review from '../data/catalog/source-gallery-review-v1.json';
import { reviewedCatalogImageExclusion, reviewedCatalogGalleryHold } from '../apps/web/lib/catalog/source-gallery-review';
import { rankedCatalogImageUrls } from '../apps/web/lib/catalog/image-quality';
import { catalogSemanticEvidenceRejectionReason, isRenderablePublicCatalogOffer } from '../apps/web/lib/catalog/offer-quality';
import { exactVehicleGallery } from '../apps/web/lib/catalog/kcar-exact-source';

test('reviewed advertising is excluded at every rendition while clean source order is preserved', () => {
  const ad = review.excludedImages.find(row => row.sourceOfferId === '455124671')!;
  const small = new URL(ad.url); small.search = '?rule=mo-360';
  assert.ok(reviewedCatalogImageExclusion(small.href));
  const clean = 'https://img.classistatic.de/api/v1/mo-prod/images/98/98e5413d-9dbc-4dfa-bc00-73e29b5c843a?rule=mo-1600';
  const photo = (url: string) => ({ url, mimeType: 'image/jpeg', width: 1600, height: 1200, size: 200_000 });
  assert.deepEqual(rankedCatalogImageUrls({ images: [photo(ad.url), photo(small.href), photo(clean)] }), [clean]);
  assert.equal(reviewedCatalogImageExclusion(clean), '');
  assert.equal(reviewedCatalogImageExclusion('https://different.example' + small.pathname), '');
});

test('unresolved visual identity and advertising holds also reject previously attested projections', () => {
  for (const hold of review.heldOffers) {
    const offer = { sourceId: hold.sourceId, sourceOfferId: hold.sourceOfferId, cardProjectionVersion: 3,
      publicSpecificationVerified: true, totalRub: 2_000_000 };
    assert.equal(catalogSemanticEvidenceRejectionReason(offer), hold.reason);
    assert.equal(isRenderablePublicCatalogOffer(offer), false);
    assert.equal(reviewedCatalogGalleryHold({ ...offer, sourceId: 'different-source' }), '');
    assert.equal(reviewedCatalogGalleryHold({ ...offer, sourceOfferId: 'new-unreviewed-id' }), '');
  }
});

test('KCar retains one reviewed dashboard view, exterior cover and other source-bound photos', () => {
  const base = 'https://img.kcar.com/3dcarpicture/2026/08/173/61387808_1';
  const cover = `${base}/main/main780.jpg`;
  const urls = Array.from({ length: 7 }, (_, i) => `${base}/extra/extra_${i}_hq.jpg`);
  const gallery = exactVehicleGallery({ outerPhotoList: [{ carCd: 'EC61387808', elanPath: cover, thumbnailType: '01' }],
    vrVo: { v_src_show: urls.map(url => `'${url}'`).join(',') } } as any, 'EC61387808');
  assert.deepEqual(gallery, [cover, urls[0], ...urls.slice(4)]);
});
