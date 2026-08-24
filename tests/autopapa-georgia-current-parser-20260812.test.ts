import assert from "node:assert/strict";
import test from "node:test";
import {
  autoPapaDetailOriginalPhotoUrls,
  autoPapaDetailPowerHp,
  autoPapaDetailPriceUsd,
  autoPapaExactDetailFacts,
  enrichAutoPapaOfferFromExactDetail,
  parseAutoPapaGeorgiaListing,
} from "../apps/web/lib/catalog/autopapa-georgia-source";
import type { VehicleOffer } from "../apps/web/lib/catalog/types";

test("AutoPapa binds price, year, mileage and image to one exact listing and rejects pre-2020", () => {
  const markup = `
    <a href="/en/usd/chevrolet/captiva/932906"><img src="/system/car/photos/009/066/595/medium.jpg?1770802543"></a>
    <a href="/en/usd/chevrolet/captiva/932906">Chevrolet Captiva</a>
    <div>minivan $13 000 2023 year, Rustavi, customs not cleared 22 K. km / 14 Miles automatic 1.5 l, petrol</div>
    <img src="/system/flags/2.jpg"><img src="/images/question.png">

    <a href="/en/usd/maserati/mLevante/956987">Maserati Levante</a>
    <div>suv $29 500 2022 year, Tbilisi, customs not cleared 48 000 K. km / 30 000 Miles automatic 3.0 l, petrol</div>
    <img src="/system/car/photos/009/414/327/medium.jpg?1786349130">

    <a href="/en/usd/bmw/X6M/954330">BMW X6 M</a>
    <div>suv $25 384 2018 year, Batumi, customs cleared 122 000 K. km / 76 250 Miles automatic 3.0 l, petrol</div>
    <img src="/system/car/photos/009/378/143/medium.jpg?1784737205">
  `;

  const rows = parseAutoPapaGeorgiaListing(markup);
  assert.equal(rows.length, 2);

  const captiva = rows[0];
  assert.equal(captiva.id, "932906");
  assert.equal(captiva.detailUrl, "https://autopapa.ge/en/usd/chevrolet/captiva/932906");
  assert.equal(captiva.title, "Chevrolet Captiva");
  assert.equal(captiva.make, "Chevrolet");
  assert.equal(captiva.model, "Captiva");
  assert.equal(captiva.year, 2023);
  assert.equal(captiva.price, 13_000);
  assert.equal(captiva.mileageKm, 22_000);
  assert.equal(captiva.engineCc, 1_500);
  assert.equal(captiva.fuel?.toLowerCase(), "petrol");
  assert.equal(captiva.transmission?.toLowerCase(), "automatic");
  assert.equal(captiva.bodyType?.toLowerCase(), "minivan");
  assert.equal(captiva.location, "Rustavi");
  assert.deepEqual(captiva.images, ["https://autopapa.ge/system/car/photos/009/066/595/medium.jpg?1770802543"]);

  const levante = rows[1];
  assert.equal(levante.id, "956987");
  assert.equal(levante.make, "Maserati");
  assert.equal(levante.model, "Levante");
  assert.equal(levante.year, 2022);
  assert.equal(levante.price, 29_500);
  assert.equal(levante.mileageKm, 48_000);

  assert.equal(rows.some((row) => row.id === "954330"), false);
});

test("AutoPapa rejects personal watercraft that look like ordinary current listings", () => {
  const markup = `
    <a href="/en/usd/yamaha/super-jet/959999">Yamaha Super Jet</a>
    <div>$12 500 2026 year, Batumi, automatic 1.8 l, petrol</div>
    <img src="/system/car/photos/009/999/999/medium.jpg">
  `;
  assert.deepEqual(parseAutoPapaGeorgiaListing(markup), []);
});

test("AutoPapa exact detail gallery keeps only direct full-size originals in source order", () => {
  const markup = `
    <img src="https://autopapa.ge/system/car/photos/009/066/595/labels1.jpg">
    <img src="https://autopapa.ge/system/car/photos/009/066/595/small.jpg?1770802543">
    <a href="https://autopapa.ge/system/car/photos/009/066/596/original.jpg?1770802545">full</a>
    <img data-src="https://autopapa.ge/system/car/photos/009/066/597/original.jpg?1770802546">
    <img src="https://autopapa.ge/system/car/photos/009/066/597/small.jpg?1770802546">
    <img src="https://autopapa.ge/system/car/photos/009/411/399/thumb.jpg?1786202604">
    <script>const duplicate = "https:\/\/autopapa.ge\/system\/car\/photos\/009\/066\/596\/original.jpg?1770802545";</script>
  `;

  assert.deepEqual(autoPapaDetailOriginalPhotoUrls(markup), [
    "https://autopapa.ge/system/car/photos/009/066/596/original.jpg?1770802545",
    "https://autopapa.ge/system/car/photos/009/066/597/original.jpg?1770802546",
  ]);
});

test("AutoPapa exact detail power comes only from the primary facts block", () => {
  const markup = `
    <div>Year: 2024 Body Type: sedan State: good Engine Type: petrol Power: 147 hp Engine Vol: 2.0 l Mileage: 19 000 K. km Drive: front-wheel drive</div>
    <div>Car description</div>
    <div>Others also watch Example SUV Power: 999 hp</div>
  `;
  assert.equal(autoPapaDetailPowerHp(markup), 147);
});

test("AutoPapa blank primary power stays unknown and cannot borrow a recommendation power", () => {
  const markup = `
    <div>Year: 2025 Body Type: suv State: good Engine Type: petrol Power: Engine Vol: 2.0 l Mileage: 1 440 K. km Drive: front-wheel drive</div>
    <div>Car description</div>
    <div>Others also watch Example SUV Power: 250 hp</div>
  `;
  assert.equal(autoPapaDetailPowerHp(markup), undefined);
});

test("AutoPapa seller power below the catalog plausibility floor stays unknown", () => {
  const oneHp = `<div>Body Type: suv Power: 1 hp Engine Vol: 1.5 l</div><div>Car description</div>`;
  const twoHp = `<div>Body Type: sedan Power: 2 hp Engine Vol: 2.0 l</div><div>Car description</div>`;
  const boundary = `<div>Body Type: hatchback Power: 20 hp Engine Vol: 1.0 l</div><div>Car description</div>`;
  assert.equal(autoPapaDetailPowerHp(oneHp), undefined);
  assert.equal(autoPapaDetailPowerHp(twoHp), undefined);
  assert.equal(autoPapaDetailPowerHp(boundary), 20);
});

function exactOffer(powertrainKind: VehicleOffer["powertrainKind"] = "combustion") {
  return {
    sourceId: "autopapa_georgia_open",
    sourceOfferId: "932906",
    powertrainKind,
    operational: { sourceUrl: "https://autopapa.ge/en/usd/chevrolet/captiva/932906", raw: {} },
  } as VehicleOffer;
}

test("AutoPapa exact detail facts require both requested and redirected URLs to match the listing ID", () => {
  const markup = `
    <div>Body Type: suv Power: 147 hp Engine Vol: 1.5 l</div><div>Car description</div>
    <a href="https://autopapa.ge/system/car/photos/009/066/596/original.jpg?1770802545">full</a>
  `;
  const exact = autoPapaExactDetailFacts(exactOffer(), markup, "https://autopapa.ge/en/usd/chevrolet/captiva/932906");
  assert.deepEqual(exact, {
    sourceOfferId: "932906",
    originals: ["https://autopapa.ge/system/car/photos/009/066/596/original.jpg?1770802545"],
    powerHp: 147,
  });
  assert.equal(autoPapaExactDetailFacts(exactOffer(), markup, "https://autopapa.ge/en/usd/toyota/camry/953315"), null);
});

test("AutoPapa importer enriches exact combustion power before customs calculation", () => {
  const offer = exactOffer();
  const markup = `<div>Body Type: suv Power: 147 hp Engine Vol: 1.5 l</div><div>Car description</div>`;
  const facts = enrichAutoPapaOfferFromExactDetail(offer, markup, "https://autopapa.ge/en/usd/chevrolet/captiva/932906");
  assert.equal(facts?.powerHp, 147);
  assert.equal(offer.powerHp, 147);
  assert.equal(offer.powerKw, 108.12);
  assert.equal(offer.powerDataConfidence, "source_exact");
  assert.equal(offer.powerDataSource, "autopapa-detail:932906:Power");
  assert.equal((offer.operational.raw as Record<string, unknown>).autoPapaDetailIdentityVerified, true);
});

test("AutoPapa seller peak power is not promoted to EV or hybrid utilization power", () => {
  const markup = `<div>Body Type: suv Power: 250 hp Engine Vol: 2.0 l</div><div>Car description</div>`;
  for (const kind of ["electric", "other_hybrid", "series_hybrid"] as const) {
    const offer = exactOffer(kind);
    const facts = enrichAutoPapaOfferFromExactDetail(offer, markup, "https://autopapa.ge/en/usd/chevrolet/captiva/932906");
    assert.equal(facts?.powerHp, undefined);
    assert.equal(offer.powerHp, undefined);
    assert.equal(offer.powerDataSource, undefined);
  }
});


test("AutoPapa exact detail price ignores customs helper prices and stale seller text", () => {
  const markup = `
    <header><h1>Hyundai Kona</h1><strong class="price">$4 938</strong></header>
    <section>STARTING PRICE AT A REDUCTION IN GEORGIA, INCLUDING CUSTOMS CLEARANCE (BARGAINING) $6 314</section>
    <section>STARTING PRICE IN GEORGIA INCLUDING CUSTOMS CLEARANCE $6 130</section>
    <div>Body Type: SUV Power: Engine Vol: 2.0 l Mileage: 27 000 K. km</div>
    <div>Car description</div>
    <div>More details VIN: KM8K22AB4PU044726 Cena : 12900 $, 2023 god 4 mesac</div>
    <aside>Top listings Hyundai Kona $12 700</aside>
  `;
  assert.equal(autoPapaDetailPriceUsd(markup), 4_938);
});

test("AutoPapa exact detail facts promote only the identity-bound primary asking price", () => {
  const offer = exactOffer();
  offer.sourceOfferId = "958003";
  offer.operational.sourceUrl = "https://autopapa.ge/en/usd/hyundai/kona/958003";
  offer.sourcePrice = 3_608;
  offer.sourceCurrency = "USD";
  const markup = `
    <header><h1>Hyundai Kona</h1><span>$4 938</span></header>
    <div>STARTING PRICE AT A REDUCTION IN GEORGIA $6 314</div>
    <div>Body Type: SUV Power: Engine Vol: 2.0 l</div><div>Car description</div>
    <div>More details Cena : 12900 $</div>
  `;
  const facts = enrichAutoPapaOfferFromExactDetail(offer, markup, "https://autopapa.ge/en/usd/hyundai/kona/958003");
  assert.equal(facts?.priceUsd, 4_938);
  assert.equal(offer.sourcePrice, 4_938);
  assert.equal(offer.sourceCurrency, "USD");
  assert.equal((offer.operational.raw as any).autoPapaDetailPriceVerified, true);
  assert.equal((offer.operational.raw as any).autoPapaDetailPriceUsd, 4_938);
});
