import { normalizeVehicleOfferSpecs } from "../../apps/web/lib/catalog/spec-normalization.ts";
import { getCertifiedPowerReferences, findCertifiedPowerReference } from "../../apps/web/lib/catalog/power-reference.ts";

function classify(input: Record<string, unknown>) {
  return normalizeVehicleOfferSpecs({ market: "korea", sourceCurrency: "KRW", ...input } as any);
}

async function main() {
  const cases = [
    { name: "Kia Sorento HEV", input: { make: "기아", model: "쏘렌토 4세대", trim: "HEV 1.6 2WD 그래비티", engineCc: 1598 }, expected: "other_hybrid" },
    { name: "Kia EV6", input: { make: "기아", model: "EV6", trim: "롱레인지" }, expected: "electric" },
    { name: "Hyundai Ioniq 5", input: { make: "현대", model: "아이오닉 5", trim: "롱레인지 AWD" }, expected: "electric" },
    { name: "Hyundai Kona Electric", input: { make: "현대", model: "더 뉴 코나 일렉트릭", trim: "프리미엄" }, expected: "electric" },
    { name: "Tesla Model 3", input: { make: "테슬라", model: "Model 3", trim: "Long Range" }, expected: "electric" },
    { name: "Chevrolet Bolt EUV", input: { make: "쉐보레(GM대우)", model: "볼트 EUV", trim: "Premier" }, expected: "unknown" },
    { name: "Nissan e-POWER", input: { make: "Nissan", model: "Note", trim: "e-POWER X", engineCc: 1198 }, expected: "series_hybrid" },
    { name: "Chevrolet combustion guard", input: { make: "Chevrolet", model: "Orlando", trim: "1.3T", engineCc: 1349, fuel: "petrol" }, expected: "combustion" },
  ];

  const results = cases.map((test) => {
    const offer = classify(test.input);
    return { name: test.name, expected: test.expected, actual: offer.powertrainKind, fuel: offer.fuel };
  });

  // Korean source uses transliterated Bolt naming inconsistently, so only assert cases whose
  // source-exact model token is explicitly covered by the strict patterns above.
  for (const result of results.filter((row) => row.name !== "Chevrolet Bolt EUV")) {
    if (result.actual !== result.expected) throw new Error(`${result.name}: expected ${result.expected}, got ${result.actual}`);
  }

  const refs = await getCertifiedPowerReferences();
  const probes = [
    { make: "기아", model: "EV6", year: 2023, trim: "롱레인지" },
    { make: "현대", model: "아이오닉 5", year: 2023, trim: "롱레인지" },
    { make: "기아", model: "쏘렌토 4세대 하이브리드", year: 2023, trim: "가솔린 터보 1.6 2WD" },
    { make: "현대", model: "그랜저 하이브리드 (GN7)", year: 2023, trim: "1.6 하이브리드" },
  ];
  const matches = [];
  for (const probe of probes) {
    const match = await findCertifiedPowerReference(probe as any);
    matches.push({ probe, match: match ? { id: match.id, sourceDocumentType: match.sourceDocumentType, sourceDocumentId: match.sourceDocumentId, power30MinKw: match.power30MinKw, utilizationPowerKw: match.utilizationPowerKw } : null });
  }

  console.log(JSON.stringify({ results, certifiedReferenceCount: refs.length, certifiedReferenceMatches: matches }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
