import fs from "node:fs/promises";

const input = process.env.PRESTIGE_OFFICIAL_INPUT || "prestige-japan-exact-sold-repaired.json";
const output = process.env.PRESTIGE_OFFICIAL_OUTPUT || "prestige-japan-exact-sold-official-power.json";

// Primary manufacturer records only. Nissan combines an official recall (exact DBA chassis)
// with an official archived model specification (engine displacement and output).
const RULES = [
  ["SJ5", "SUBARU", "FORESTER", 2013, 2017, 1995, 15, 148, 109, "DBA-SJ5", ["https://ucar.subaru.jp/php/catalog/grade.php?cat_id=10085479"]],
  ["SK5", "SUBARU", "FORESTER", 2020, 2025, 1795, 15, 177, 130, "4BA-SK5", ["https://ucar.subaru.jp/php/catalog/grade.php?cat_id=10132246"]],
  ["SK9", "SUBARU", "FORESTER", 2018, 2020, 2498, 15, 184, 136, "5BA-SK9", ["https://ucar.subaru.jp/php/catalog/grade.php?cat_id=10124779"]],
  ["VM4", "SUBARU", "LEVORG", 2014, 2020, 1599, 15, 170, 125, "DBA-VM4", ["https://ucar.subaru.jp/php/catalog/grade.php?cat_id=10110615"]],
  ["GP7", "SUBARU", "XV", 2012, 2017, 1995, 15, 150, 110, "DBA-GP7", ["https://ucar.subaru.jp/php/catalog/grade.php?cat_id=10078721"]],
  ["GP2", "SUBARU", "IMPREZA", 2011, 2016, 1599, 15, 115, 85, "DBA-GP2", ["https://ucar.subaru.jp/php/catalog/grade.php?cat_id=10099957"]],
  ["GP3", "SUBARU", "IMPREZA", 2011, 2016, 1599, 15, 115, 85, "DBA-GP3", ["https://ucar.subaru.jp/php/catalog/grade.php?cat_id=10094313"]],
  ["GP7", "SUBARU", "IMPREZA", 2011, 2016, 1995, 15, 150, 110, "DBA-GP7", ["https://ucar.subaru.jp/php/catalog/grade.php?cat_id=10081807"]],
  ["ZC72S", "SUZUKI", "SWIFT", 2011, 2016, 1242, 50, 91, 67, "DBA-ZC72S", ["https://www.suzuki.co.jp/suzuki_digital_library/1_auto/swift.html"]],
  ["KSP210", "TOYOTA", "YARIS", 2020, 2025, 996, 15, 69, 51, "5BA-KSP210", ["https://toyota.jp/ucar/catalog/brand-TOYOTA/car-YARIS/202002/10127871/", "https://toyota.jp/ucar/catalog/brand-TOYOTA/car-YARIS/202208/10144259/", "https://toyota.jp/ucar/catalog/brand-TOYOTA/car-YARIS/202401/10151992/", "https://toyota.jp/ucar/catalog/brand-TOYOTA/car-YARIS/202502/10156806/"]],
  ["MXPA10", "TOYOTA", "YARIS", 2020, 2025, 1490, 15, 120, 88, "5BA-MXPA10", ["https://toyota.jp/ucar/catalog/brand-TOYOTA/car-YARIS/202002/10127869/", "https://toyota.jp/ucar/catalog/brand-TOYOTA/car-YARIS/202105/10137203/", "https://toyota.jp/ucar/catalog/brand-TOYOTA/car-YARIS/202208/10144256/", "https://toyota.jp/ucar/catalog/brand-TOYOTA/car-YARIS/202401/10151989/", "https://toyota.jp/ucar/catalog/brand-TOYOTA/car-YARIS/202502/10156802/"]],
  ["MXPA15", "TOYOTA", "YARIS", 2020, 2025, 1490, 15, 120, 88, "5BA-MXPA15", ["https://toyota.jp/ucar/catalog/brand-TOYOTA/car-YARIS/202004/10127879/", "https://toyota.jp/ucar/catalog/brand-TOYOTA/car-YARIS/202105/10137240/", "https://toyota.jp/ucar/catalog/brand-TOYOTA/car-YARIS/202208/10144268/", "https://toyota.jp/ucar/catalog/brand-TOYOTA/car-YARIS/202401/10151990/", "https://toyota.jp/ucar/catalog/brand-TOYOTA/car-YARIS/202502/10156801/"]],
  ...["C26", "NC26", "FC26", "FNC26"].map((code) => [code, "NISSAN", "SERENA", 2011, 2016, 1997, 15, 147, 108, `DBA-${code}`, ["https://www2.nissan.co.jp/RECALL/DATA/report3248.html", "https://history.nissan.co.jp/SERENA/C26/1011/c261011g01.html?gradeID=G01&model=SERENA"]]),
  ...["T32", "NT32"].map((code) => [code, "NISSAN", "X-TRAIL", 2014, 2021, 1997, 15, 147, 108, `DBA-${code}`, ["https://www.nissan.co.jp/RECALL/DATA/report3803.html", "https://history.nissan.co.jp/X-TRAIL/T32/1706/performance_safety/performance.html"]]),
].map(([chassis, make, model, yearFrom, yearTo, engineCc, tolerance, powerHp, powerKw, typeCode, sourceUrls]) => ({ chassis, make, model, yearFrom, yearTo, engineCc, tolerance, powerHp, powerKw, typeCode, sourceUrls }));

const upper = (value) => String(value || "").trim().toUpperCase();
const frame = (value) => upper(value).replace(/[^A-Z0-9-]+/g, "");
const payload = JSON.parse(await fs.readFile(input, "utf8"));
const offers = Array.isArray(payload?.offers) ? payload.offers : [];
let enriched = 0;
const byChassis = {};

for (const offer of offers) {
  if (Number(offer?.powerHp || 0) > 0) continue;
  const code = frame(offer?.frameNumber || offer?.operational?.raw?.chassis);
  const year = Number(offer?.year || 0);
  const cc = Number(offer?.engineCc || 0);
  const rule = RULES.find((candidate) => code === candidate.chassis
    && upper(offer?.make) === candidate.make
    && upper(offer?.model) === candidate.model
    && year >= candidate.yearFrom && year <= candidate.yearTo
    && cc > 0 && Math.abs(cc - candidate.engineCc) <= candidate.tolerance);
  if (!rule) continue;

  offer.engineCc = rule.engineCc;
  offer.powerHp = rule.powerHp;
  offer.powerKw = rule.powerKw;
  offer.fuel = "petrol";
  offer.powertrainKind = "combustion";
  offer.powerDataConfidence = "documented";
  offer.powerDataSource = rule.sourceUrls[0];
  offer.operational ||= {};
  offer.operational.raw = {
    ...(offer.operational.raw || {}),
    recoveryOfficialChassisPower: true,
    recoveryOfficialChassis: rule.chassis,
    recoveryOfficialTypeCode: rule.typeCode,
    recoveryOfficialEngineCc: rule.engineCc,
    recoveryOfficialPowerHp: rule.powerHp,
    recoveryOfficialPowerKw: rule.powerKw,
    recoveryOfficialSourceUrls: rule.sourceUrls,
  };
  enriched++;
  byChassis[rule.chassis] = Number(byChassis[rule.chassis] || 0) + 1;
}

payload.report = { ...(payload.report || {}), officialPowerEnrichment: { enriched, byChassis, primaryManufacturerOnly: true } };
await fs.writeFile(output, JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ inputCount: offers.length, enriched, byChassis, output }, null, 2));
if (!enriched) process.exit(1);
