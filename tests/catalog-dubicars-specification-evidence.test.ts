import assert from "node:assert/strict";
import test from "node:test";
import {
  DubicarsCurrentAdapter,
  dubicarsSpecificationEvidence,
  parseDubicarsCurrentListing,
} from "../apps/web/lib/catalog/dubicars-current-source";
import { classifySpecificationEvidence } from "../apps/web/lib/catalog/specification-evidence-audit";

const source = new DubicarsCurrentAdapter();
const url = "https://www.dubicars.com/2024-toyota-camry-v6-1000265.html";
const gallery = Array.from({ length: 5 }, (_, index) =>
  `<img src="https://cdn.dubicars.com/images/abcdef/w_1200x800/vehicle/${index + 1}2345678-abcd-1234-abcd-123456789abc.jpg" />`,
).join("\n");

test('DubiCars reads a listing-bound structured price when the title bar uses a currency icon', () => {
  const structured = (target = url, value = '15803', currency = 'USD') => `<script type="application/ld+json">${JSON.stringify({ '@graph': [{
    '@type': ['Product', 'Car'], '@id': `${target}#car`, url: target,
    offers: { '@type': 'Offer', '@id': `${target}#offer`, price: value, priceCurrency: currency },
  }] })}</script>`;
  const page = '<section id="title-bar"><h1>Toyota Camry V6</h1><span>15,803</span></section><div>Model year 2024</div>' + gallery;
  assert.equal(parseDubicarsCurrentListing(page + structured(), url)?.price, 15803);
  assert.equal(parseDubicarsCurrentListing(page + structured(), url)?.currency, 'USD');
  assert.equal(parseDubicarsCurrentListing(page + structured('https://www.dubicars.com/other.html'), url)?.price, undefined);
  assert.equal(parseDubicarsCurrentListing(page + structured(url, '0'), url)?.price, undefined);
  assert.equal(parseDubicarsCurrentListing(page + structured(url, '15803', 'UNKNOWN'), url)?.price, undefined);
  assert.equal(parseDubicarsCurrentListing(page + structured() + structured(url, '18000'), url)?.price, undefined);
  assert.equal(parseDubicarsCurrentListing(page.replace('15,803', 'Price on request') + structured(), url)?.price, undefined);
});

function detail(specifications: string, after = "") {
  return `<h1>Toyota Camry V6 3.5L</h1>
    <div>AED 145,000</div>
    <section>Model year 2024 ${specifications}
      Make Toyota Model Camry Trim V6 Transmission Automatic Drive type Front Wheel Drive
      Vehicle type Sedan Color White Service history Yes</section>
    ${after}
    ${gallery}`;
}

test('DubiCars attests only the canonical detail page primary gallery', () => {
  const outside = '<img src="https://cdn.dubicars.com/images/ffffff/w_1200x800/vehicle/ffffffff-abcd-1234-abcd-123456789abc.jpg">';
  const markup = `<link rel="canonical" href="${url}"><h1>Toyota Camry V6</h1><div>Model year 2024 AED 145000</div><section id="car-images-slider">${gallery}</section><section id="similar-cars">${outside}</section>`;
  const row = parseDubicarsCurrentListing(markup, url)!;
  assert.equal(row.photoIdentityVerified, true);
  assert.equal(row.images.length, 5);
  assert.ok(row.images.every(image => !image.includes('/ffffff/')));
  assert.equal(source.normalizeOffer(row)?.operational?.photoIdentityVerified, true);
  assert.equal(parseDubicarsCurrentListing(markup.replace(`href="${url}"`, 'href="https://www.dubicars.com/other-123456.html"'), url)?.photoIdentityVerified, false);
  assert.equal(parseDubicarsCurrentListing(detail('Fuel Type Petrol'), url)?.photoIdentityVerified, false);
});

test("DubiCars promotes exact values only from the bounded specification block", () => {
  const row = parseDubicarsCurrentListing(
    detail(
      "Kilometers 12,000 Km Engine capacity 3456 cc Horsepower 301 HP Fuel Type Petrol",
      "<h2>Similar cars</h2><div>Engine capacity 5.6 L Horsepower 400 HP Fuel Type Diesel</div>",
    ),
    url,
  );
  assert.ok(row);
  assert.equal(row.engineCc, 3456);
  assert.equal(row.powerHp, 301);
  assert.equal(row.fuel, "petrol");
  assert.equal(row.semanticEvidence?.year.status, "exact");
  assert.equal(row.semanticEvidence?.engineCc.status, "exact");
  assert.equal(row.semanticEvidence?.powerHp.status, "exact");
  assert.equal(row.semanticEvidence?.fuel.status, "exact");

  const offer = source.normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer.calculationStatus, "needs_data");
  assert.equal(offer.powerDataConfidence, "source_exact");
  assert.equal(classifySpecificationEvidence(offer, "fuelPowertrain").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "engineCc").state, "exact");
  assert.equal(classifySpecificationEvidence(offer, "powerHp").state, "exact");
});

test("DubiCars ranges, unknown fuel, and implausible power stay non-exact", () => {
  const evidence = dubicarsSpecificationEvidence({
    pageYear: 2024,
    urlYear: 2024,
    fuel: "Other / unknown",
    engine: "1.5 - 2.0 L",
    power: "1,997 HP",
  });
  assert.equal(evidence.fuel.status, "ambiguous");
  assert.equal(evidence.engineCc.status, "ambiguous");
  assert.equal(evidence.powerHp.status, "ambiguous");
  assert.equal(evidence.engineCc.value, undefined);
  assert.equal(evidence.powerHp.value, undefined);
});

test("DubiCars detects conflicting repeated named values", () => {
  const evidence = dubicarsSpecificationEvidence({
    pageYear: 2024,
    urlYear: 2024,
    fuel: ["Petrol", "Diesel"],
    engine: ["1998 cc", "2498 cc"],
    power: ["200 HP", "250 HP"],
  });
  assert.equal(evidence.fuel.status, "conflict");
  assert.equal(evidence.engineCc.status, "conflict");
  assert.equal(evidence.powerHp.status, "conflict");
});

test("DubiCars title numbers cannot reappear through generic normalization", () => {
  const row = parseDubicarsCurrentListing(`<h1>Toyota Highlander 2.5L AWD 248 HP</h1><div>AED 148,000</div>${gallery}`,
    "https://www.dubicars.com/2023-toyota-highlander-25l-awd-855685.html");
  assert.ok(row);
  assert.equal(row.engineCc, undefined);
  assert.equal(row.powerHp, undefined);
  const offer = source.normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer.engineCc, undefined);
  assert.equal(offer.powerHp, undefined);
  assert.equal(offer.powerKw, undefined);
  assert.equal(offer.powerDataConfidence, undefined);
  assert.equal((offer.operational as any).semanticEvidence.engineCc.status, "missing");
  assert.equal((offer.operational as any).semanticEvidence.powerHp.status, "missing");
});

test("DubiCars electric fuel conflicts with non-zero displacement", () => {
  const evidence = dubicarsSpecificationEvidence({ fuel: "Electric", engine: "1998 cc" });
  assert.equal(evidence.fuel.status, "exact");
  assert.equal(evidence.fuel.value, "electric");
  assert.equal(evidence.engineCc.status, "conflict");
  assert.equal(evidence.engineCc.value, undefined);
});

test("DubiCars keeps an identity-bound EREV as a series hybrid", () => {
  const row = parseDubicarsCurrentListing(
    detail("Engine capacity 1.5 L Horsepower 490 HP Fuel Type Hybrid")
      .replace("Toyota Camry V6 3.5L", "Voyah Free EREV")
      .replace("Make Toyota Model Camry", "Make Voyah Model Free"),
    "https://www.dubicars.com/2024-voyah-free-erev-1000265.html",
  );
  assert.ok(row);
  const offer = source.normalizeOffer(row);
  assert.ok(offer);
  assert.equal(offer.powertrainKind, "series_hybrid");
  assert.equal(offer.fuel, "hybrid");
});


test("DubiCars rejects rounded litres and accept explicit mL", () => {
  assert.equal(dubicarsSpecificationEvidence({ engine: "3.5 L" }).engineCc.status, "ambiguous");
  assert.equal(dubicarsSpecificationEvidence({ engine: "3456 mL" }).engineCc.value, 3456);
});


test("DubiCars reads the current specifications section after description and never borrows a price", () => {
  const row = parseDubicarsCurrentListing(`<h1>Toyota Camry</h1>
    <section id="title-bar">Price on request</section>
    <div>Model year 2024 Kilometers 12000 Km Specs GCC Description Seller comments</div>
    <section id="item-specifications">Make Toyota Model Camry Engine capacity 2494 cc Horsepower 181 HP Fuel Type Petrol Service history Yes</section>
    <section>Similar cars AED 99000</section>${gallery}`, url);
  assert.ok(row);
  assert.equal(row.price, undefined);
  assert.equal(row.currency, undefined);
  assert.equal(row.engineCc, 2494);
  assert.equal(row.powerHp, 181);
  assert.equal(row.fuel, "petrol");
});

test("DubiCars source URL mode returns the gallery without image requests", async () => {
  const previous = process.env.CATALOG_IMAGE_STORAGE_MODE;
  process.env.CATALOG_IMAGE_STORAGE_MODE = "source_urls_only";
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("unexpected_image_download"); };
  try {
    const row = parseDubicarsCurrentListing(detail("Engine capacity 3456 cc Horsepower 301 HP Fuel Type Petrol"),url);
    const offer = source.normalizeOffer(row)!;
    const photos = await source.fetchImages(offer);
    assert.equal(photos.length,5);
    assert.equal(photos[0].size,0);
    assert.match(photos[0].url,/cdn.dubicars.com/);
  } finally { globalThis.fetch = fetchOriginal; if (previous === undefined) delete process.env.CATALOG_IMAGE_STORAGE_MODE; else process.env.CATALOG_IMAGE_STORAGE_MODE = previous; }
});
