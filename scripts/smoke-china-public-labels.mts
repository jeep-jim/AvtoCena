import { catalogOfferTitle, catalogTransmissionName } from "../apps/web/lib/catalog/presentation.ts";

const cases: Array<[any, string]> = [
  [{ market: "china", make: "零跑汽车", model: "零跑C16" }, "Leapmotor C16"],
  [{ market: "china", make: "智己汽车", model: "智己LS6" }, "IM Motors LS6"],
  [{ market: "china", make: "星途", model: "星纪元 ET" }, "Exeed Exlantix ET"],
  [{ market: "china", make: "丰田", model: "普拉多" }, "Toyota Prado"],
];
for (const [offer, expected] of cases) {
  const actual = catalogOfferTitle(offer);
  if (actual !== expected) throw new Error(`title mismatch: ${actual} != ${expected}`);
}
const transmission = catalogTransmissionName("8挡手自一体");
if (transmission !== "8-ступ. автомат") throw new Error(`transmission mismatch: ${transmission}`);
console.log(JSON.stringify({ passed: true, cases: cases.length, transmission }));
