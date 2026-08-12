import assert from "node:assert/strict";
import test from "node:test";
import { parseAutoPapaGeorgiaListing } from "../apps/web/lib/catalog/autopapa-georgia-source";

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
  assert.equal(levante.engineCc, 3_000);

  assert.equal(rows.some((row) => row.id === "954330"), false);
});
