import assert from "node:assert/strict";
import test from "node:test";
import {
  exactVehicleGallery,
  kcarKoreaExactSource,
  KCAR_EXTERIOR_FIRST_GALLERY_MODE,
} from "../apps/web/lib/catalog/kcar-exact-source";
import { needsSourceOrderedGalleryRefresh } from "../apps/web/lib/catalog/importer-impl";

const base = "https://img.kcar.com/3dcarpicture/2026/07/081/61390500_1";

test("K Car exterior cover and representative body angles lead the detail gallery", () => {
  const close = Array.from({ length: 8 }, (_, index) => `'${base}/close/close_${index}.jpg'`).join(",");
  const details = [
    `${base}/extra/extra_0_hq.jpg`,
    "https://img.kcar.com/3dcarpicture/2026/07/081/99999999_1/extra/extra_0_hq.jpg",
    `${base}/extra/extra_1_hq.jpg`,
  ].map((url) => `'${url}'`).join(",");

  const gallery = exactVehicleGallery({
    outerPhotoList: [{ carCd: "EC61390500", elanPath: `${base}/main/main780.jpg`, sortOrdr: "1", thumbnailType: "01" }],
    photoList: [{ carCd: "EC61390500", elanPath: `${base}/main/main780.jpg`, sortOrdr: "1", thumbnailTypenm: "외관" }],
    vrVo: { v_src_close: close, v_src_show: details },
  }, "EC61390500");

  assert.deepEqual(gallery.slice(0, 5), [
    `${base}/main/main780.jpg`,
    `${base}/close/close_0.jpg`,
    `${base}/close/close_2.jpg`,
    `${base}/close/close_4.jpg`,
    `${base}/close/close_6.jpg`,
  ]);
  assert.deepEqual(gallery.slice(5), [
    `${base}/extra/extra_0_hq.jpg`,
    `${base}/extra/extra_1_hq.jpg`,
  ]);
});

test("K Car dealer credential scans are never treated as vehicle body photos", () => {
  const gallery = exactVehicleGallery({
    rvo: {
      carCd: "EC61399471",
      frontImgPath: "/ucms/202607/CM/CMBIZ11120D/front.jpeg",
      backImgPath: "/ucms/202607/CM/CMBIZ11120D/rear.jpeg",
    },
    photoList: [{ elanPath: "https://img.kcar.com/ucms/unbound-diagnostic.png" }],
  }, "EC61399471");

  assert.deepEqual(gallery, []);
});

test("old K Car galleries refresh once and the exterior-first version does not loop", () => {
  const oldOffer = { sourceId: "kcar_korea_open", operational: { raw: { gallerySafetyMode: "kcar_vrvo_v_src_show_exact_car_id_hq_v1" } } } as any;
  const currentOffer = { sourceId: "kcar_korea_open", operational: { gallerySafetyMode: KCAR_EXTERIOR_FIRST_GALLERY_MODE } } as any;
  const otherSource = { sourceId: "encar_direct", operational: {} } as any;

  assert.equal(needsSourceOrderedGalleryRefresh(oldOffer), true);
  assert.equal(needsSourceOrderedGalleryRefresh(currentOffer), false);
  assert.equal(needsSourceOrderedGalleryRefresh(otherSource), false);
});

test("an old stored K Car gallery is rebuilt from the exact detail API", async () => {
  const originalFetch = global.fetch;
  const close = Array.from({ length: 8 }, (_, index) => `'${base}/close/close_${index}.jpg'`).join(",");
  let requests = 0;
  (global as any).fetch = async () => {
    requests++;
    return new Response(JSON.stringify({
      success: true,
      data: { data: {
        rvo: { carCd: "EC61390500" },
        outerPhotoList: [{ carCd: "EC61390500", elanPath: `${base}/main/main780.jpg`, sortOrdr: "1", thumbnailType: "01" }],
        vrVo: { v_src_close: close, v_src_show: `'${base}/extra/extra_0_hq.jpg'` },
      } },
    }), { headers: { "content-type": "application/json" } });
  };
  const offer = {
    sourceId: "kcar_korea_open",
    sourceOfferId: "EC61390500",
    operational: {
      gallerySafetyMode: "kcar_vrvo_v_src_show_exact_car_id_hq_v1",
      raw: { gallerySafetyMode: "kcar_vrvo_v_src_show_exact_car_id_hq_v1", images: [`${base}/extra/extra_0_hq.jpg`] },
    },
  } as any;

  try {
    const images = await kcarKoreaExactSource.fetchImages(offer);
    assert.equal(requests, 1);
    assert.equal(images[0]?.url, `${base}/main/main780.jpg`);
    assert.equal(offer.operational.gallerySafetyMode, KCAR_EXTERIOR_FIRST_GALLERY_MODE);
    assert.equal(offer.operational.raw.gallerySafetyMode, KCAR_EXTERIOR_FIRST_GALLERY_MODE);
  } finally {
    (global as any).fetch = originalFetch;
  }
});

test("a current K Car listing without an exact exterior cover is rejected", async () => {
  const originalFetch = global.fetch;
  const previousFlag = process.env.CATALOG_GALLERY_DROP_CREDENTIAL_SCANS;
  const front = "https://img.kcar.com/ucms/202607/CM/CMBIZ11120D/front.jpeg";
  const back = "https://img.kcar.com/ucms/202607/CM/CMBIZ11120D/rear.jpeg";
  const safe = Array.from({ length: 5 }, (_, index) => `${base}/extra/extra_${index}_hq.jpg`);
  (global as any).fetch = async () => new Response(JSON.stringify({
    success: true,
    data: { data: { rvo: { carCd: "EC61390500", frontImgPath: new URL(front).pathname, backImgPath: new URL(back).pathname } } },
  }), { headers: { "content-type": "application/json" } });
  process.env.CATALOG_GALLERY_DROP_CREDENTIAL_SCANS = "true";
  const offer = {
    sourceId: "kcar_korea_open",
    sourceOfferId: "EC61390500",
    images: [front, back, ...safe].map((url) => ({ url })),
    operational: {
      gallerySafetyMode: KCAR_EXTERIOR_FIRST_GALLERY_MODE,
      raw: { gallerySafetyMode: KCAR_EXTERIOR_FIRST_GALLERY_MODE, images: [front, back, ...safe] },
    },
  } as any;

  try {
    await assert.rejects(() => kcarKoreaExactSource.fetchImages(offer), /kcar_exact_gallery_no_exterior_EC61390500/);
  } finally {
    (global as any).fetch = originalFetch;
    if (previousFlag === undefined) delete process.env.CATALOG_GALLERY_DROP_CREDENTIAL_SCANS;
    else process.env.CATALOG_GALLERY_DROP_CREDENTIAL_SCANS = previousFlag;
  }
});
